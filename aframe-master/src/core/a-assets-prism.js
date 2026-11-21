/* global customElements */
import * as THREE from 'three';
import { ANode } from './a-node.js';
import { debug } from '../utils/index.js';

var fileLoader = new THREE.FileLoader();
var warn = debug('core:a-assets:warn');

// prefetch="on": a .gltf file references separate .bin and image files that
// GLTFLoader would only fetch while parsing, i.e. during the processing stage.
// Fetch them in the network stage instead, into THREE.Cache (images decoded off
// the main thread with createImageBitmap, as GLTFLoader does), under the same
// keys GLTFLoader uses, so that parsing finds them in memory.
var prefetchBufferLoader = new THREE.FileLoader().setResponseType('arraybuffer');
var prefetchImageLoader = typeof createImageBitmap !== 'undefined' ? new THREE.ImageBitmapLoader() : null;

function prefetchIntoCache (url, loader) {
  const cached = THREE.Cache.get(url);
  if (cached !== undefined) {
    return cached && cached.then ? cached.then(() => {}, () => {}) : Promise.resolve();
  }
  if (!loader) { return Promise.resolve(); }
  return new Promise((resolve) => { loader.load(url, () => resolve(), undefined, () => resolve()); });
}

function prefetchGltfDependencies (data, basePath) {
  let json;
  try {
    json = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
  } catch (e) {
    return Promise.resolve();
  }
  const jobs = [];
  (json.buffers || []).forEach((b) => {
    if (b.uri && b.uri.indexOf('data:') !== 0) {
      jobs.push(prefetchIntoCache(THREE.LoaderUtils.resolveURL(b.uri, basePath), prefetchBufferLoader));
    }
  });
  (json.images || []).forEach((img) => {
    if (img.uri && img.uri.indexOf('data:') !== 0) {
      jobs.push(prefetchIntoCache(THREE.LoaderUtils.resolveURL(img.uri, basePath), prefetchImageLoader));
    }
  });
  return Promise.all(jobs);
}
/**
 * Asset management system. Handles blocking on asset loading.
 */
class AAssets extends ANode {
  constructor () {
    super();
    this.isAssets = true;
    this.fileLoader = fileLoader;
    this.timeout = null;
    this.priorityQueues = {1: [], 2: [], 3: [], 4: []};
    this.renderFirstFrame = true;
    this.frameTimeBudget = 16.7;
    this.safeMargin = this.frameTimeBudget * 0.3; // 30% of budget; effectiveBudget = frameTimeBudget - safeMargin
    this.networkQueues = {1: [], 2: [], 3: [], 4: []};
    this.sceneQueues = { 1: [],2: [], 3: [], 4: []};
    this.sceneTaskCount = { 1: 0, 2: 0, 3: 0, 4: 0};
    // Highest priority level in use (at least 3); level 4 is only used by the
    // priority-granularity experiment, so 3-level pages behave exactly as before.
    this.maxPriority = 3;
    this.currentPriority = 1;
    this.currentStage = 0;
    this.allTasksDone = false;
    // gpu-prepare="on": after a model is added to the scene, upload its textures and
    // compile its shaders as budgeted tasks, instead of during the first frame in
    // which the model becomes visible (three.js does this lazily at first draw).
    this.gpuPrepare = false;
    this.gpuQueue = [];
    this.p1Models = [];
    this.firstPriorityDone = false;
    this.allLoadedEmitted = false;
    // task-log="on" (experiments): record every scheduler task in window.__prismTaskLog
    this.taskLog = null;
    this.activeLoops = 0;
    this.sceneTaskDone=0;
    // 新增：分块相关状态管理
    this.chunkData = {}; // 存储下载的分块数据
    this.loadedChunks = {}; // 存储已加载的分块模型
    this.chunkPromises = {}; // 存储每个分块的Promise
    this.chunkResolvers = {}; // 存储Promise的resolve函数
  }

  async doConnectedCallback () {
    var self = this;
    var i;
    var loaded = [];
    var mediaEl;
    var mediaEls;
    var imgEl;
    var imgEls;
    var timeout;
    var children;

    super.doConnectedCallback();

    if (!this.parentNode.isScene) {
      throw new Error('<a-assets> must be a child of a <a-scene>.');
    }
    await customElements.whenDefined('a-asset-item');
    await Promise.resolve(); 
    this.collectResources();
    // console.log('debug:queue', this.priorityQueues);
    this.load();
    // await this.loadGroup(1);//network trasfer
    // await this.doGroupSceneTask(1);//scene
    this.gpuPrepare = this.getAttribute('gpu-prepare') === 'on';
    if (this.getAttribute('task-log') === 'on') { this.taskLog = window.__prismTaskLog = []; }
    await this.loadFirstPriority();
    // Some P1 models are not drawn in the first frame (outside the initial view
    // or hidden at start), so their GPU work would hit a later frame; prepare all
    // P1 models before the first frame, while the loading screen is still shown.
    if (this.gpuPrepare) {
      this.p1Models.forEach((model) => this.prepareNow(model));
    }
    this.firstPriorityDone = true;
    this.parentNode.emit('firstloaded');
    // frame-budget="off" (ablation): a single loop that processes every task as
    // soon as it is ready, without the per-frame time budget.
    const budgetOff = this.getAttribute('frame-budget') === 'off';
    this.parentNode.addEventListener('render', async function (event) {
      const startTime = event.detail;
      if(!self.allTasksDone || self.gpuQueue.length){
        if (budgetOff) {
          if (!self.unbudgetedLoopStarted) {
            self.unbudgetedLoopStarted = true;
            self.doTasks(startTime, Infinity);
          }
        } else {
          self.doTasks(startTime);
        }
      }
    });
  }

  disconnectedCallback () {
    super.disconnectedCallback();
    if (this.timeout) { clearTimeout(this.timeout); }
  }

  load () {
    // Filter out all children, as waiting already took place in doConnectedCallback.
    super.load.call(this, null, function () { return false; });
  }
  

  collectResources () {
    const elements = this.getChildren();
    elements.forEach(el => {
      const priority = this.getPriority(el);
      this.maxPriority = Math.max(this.maxPriority, priority);
      this.priorityQueues[priority].push(el);
      
      // Check if this is a chunked model
      if (this.isChunkedModel(el)) {
        const src = el.getAttribute('src');
        // console.log('🔍 [ASSETS] Chunked model detected, creating chunk tasks:', src);
        
        // 为每个分块创建网络任务
        const chunkCount = this.getChunkCount(el);
        for (let i = 1; i <= chunkCount; i++) {
          const chunkTask = {
            type: 'chunk',
            originalAssetEl: el,
            chunkIndex: i,
            chunkSrc: this.getChunkSrc(el, i),
            baseSrc: src,
            modelId: el.getAttribute('id'),
            priority: priority
          };
          this.networkQueues[priority].push(chunkTask);
          
          // 为每个分块创建Promise
          this.createChunkPromise(src, i);
          
          // console.log('🔍 [ASSETS] Created chunk task:', chunkTask.chunkSrc);
        }
      } else {
        // Non-chunked model, add to networkQueues as usual
        this.networkQueues[priority].push(el);
      }
    });
  }

  getPriority (el) {
    if (el.hasAttribute('priority')) return parseInt(el.getAttribute('priority'));
    return 3; 
  }
  async loadPriorityGroups(groups) {
    for (let priority of groups) {
      // console.log('debug: loading group', priority);
      await this.loadGroup(priority);

    }
  }
  async loadFirstPriority() {
    // console.log('debug: loading first priority group', this.currentPriority);
    const group = this.networkQueues[1];
    // console.log('debug: network transfering group',1, group);
    if (!group.length) return;
    
    // 处理网络传输任务（支持分块任务）
    group.map(item => {
      if (item.type === 'chunk') {
        // 分块任务：使用已实现的 loadChunk 方法
        this.loadChunk(item);
      } else if (item.tagName === 'A-ASSET-ITEM') {
        // 普通资源任务
        // console.log('debug: loading asset item', item);
        this.loadAssetItem(item);
      }
    });
    // console.log('debug: scene queues', this.sceneQueues);
    // 等待场景任务完成
    while(true){
      // console.log('debug: scene queues', this.sceneQueues,this.sceneQueues[this.currentPriority].length);
      if(this.sceneQueues[this.currentPriority].length !== 0){
          await this.doSceneTask();
          this.sceneTaskDone++;
        }else{
          await this.delay(2);
        }
        if(this.sceneTaskDone === this.sceneTaskCount[this.currentPriority]){
          this.currentStage = 0;
          this.sceneTaskDone = 0;
          this.currentPriority++;
          break;
        }
    }
  }
  async loadGroup(priority) {
    const group = this.networkQueues[priority];
    // console.log('debug: network transfering group', priority, group);
    if (!group.length) return;
    await Promise.all(
      group.map(item => {
        if (item.type === 'chunk') {
          // 分块任务：使用已实现的 loadChunk 方法
          return this.loadChunk(item);
        } else if (item.tagName === 'A-ASSET-ITEM') {
          return this.loadAssetItem(item);
        } else if (item.tagName === 'AUDIO') {
          return this.loadAudio(item);
        } 
      })
    );
    // console.log('debug: netword transfered group', priority,this.sceneQueues);
  }
  delay (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  async doGroupSceneTask(priority) {
    while(this.sceneQueues[this.currentPriority].length  < this.priorityQueues[priority].length){
      await this.delay(2);
      // console.log('debug: waiting for scene task', this.sceneQueues[this.currentPriority].length, this.priorityQueues[priority].length);
    }
    const group = this.sceneQueues[priority];
    // console.log('debug: loading group', priority, group);
    if (!group.length) return;
    await Promise.all(
      group.map(item => {
        if (item.type=== 'gltf-model') {
          return this.doGLTFTask(item);
        } else if (item.type === 'sound') {
          return this.doSoundTask(item);
        } 
      })
    );
  }
  async loadAssetItem(item) {
    return item.load();
  }
  async loadAudio(audioEl) {
    return new Promise((resolve, reject) => {
      const onSuccess = () => {
        audioEl.removeEventListener('canplaythrough', onSuccess);
        audioEl.removeEventListener('error', onError);
        resolve();
      };
      const onError = (err) => {
        audioEl.removeEventListener('canplaythrough', onSuccess);
        audioEl.removeEventListener('error', onError);
        reject(err);
      };
      audioEl.addEventListener('canplaythrough', onSuccess);
      audioEl.addEventListener('error', onError);
      audioEl.setAttribute('crossorigin', 'anonymous');
      audioEl.load();
    });
  }
  addSceneTaskCount (task) {
    this.sceneTaskCount[task.priority] +=1;
  }
  registerSceneTask (task) {
    this.sceneQueues[task.priority].push(task);
  }
  logTask (frame, kind, id, t0, tSync, t1) {
    if (this.taskLog) {
      this.taskLog.push({ frame: frame, kind: kind, id: id, t0: t0, sync: tSync - t0, wall: t1 - t0, loops: this.activeLoops });
    }
  }

  async doTasks (startTime, budgetOverride) {
    this.activeLoops++;
    try {
      await this.runTaskLoop(startTime, budgetOverride);
    } finally {
      this.activeLoops--;
    }
  }

  async runTaskLoop (startTime, budgetOverride) {
    const effectiveBudget = budgetOverride !== undefined ? budgetOverride : this.frameTimeBudget - this.safeMargin;
    while ( performance.now()-startTime < effectiveBudget && (!this.allTasksDone || this.gpuQueue.length)) {
      if (this.gpuQueue.length) {
        const g = this.gpuQueue[0];
        const t0 = performance.now();
        this.doGpuTask();
        const t1 = performance.now();
        this.logTask(startTime, 'gpu-' + g.type, g.type === 'texture' ? (g.texture.name || g.texture.uuid.slice(0, 8)) : (g.model.name || ''), t0, t1, t1);
        continue;
      }
      if (this.allTasksDone) { break; }
      if (this.currentStage === 0){
        if(this.networkQueues[this.currentPriority].length > 0){
          const n = this.networkQueues[this.currentPriority][0];
          const t0 = performance.now();
          this.doNetworkTask();
          const t1 = performance.now();
          this.logTask(startTime, 'request', n.chunkSrc || (n.getAttribute && n.getAttribute('src')) || '', t0, t1, t1);
        } else {
          this.currentStage = 1;
          // console.log('debug: network queue empty, switch to scene task', this.currentPriority);
        }
      }else if (this.currentStage === 1){
        if(this.sceneQueues[this.currentPriority].length !== 0){
          const sTask = this.sceneQueues[this.currentPriority][0];
          const t0 = performance.now();
          const pending = this.doSceneTask();
          const tSync = performance.now();
          await pending;
          this.logTask(startTime, sTask.type, (sTask.baseSrc || sTask.src || '') + (sTask.chunkIndex ? '#' + sTask.chunkIndex : ''), t0, tSync, performance.now());
          this.sceneTaskDone++;
        
        }else{
          await this.delay(2);
        }
        if(this.sceneTaskDone === this.sceneTaskCount[this.currentPriority]){
          this.currentStage = 0;
          this.sceneTaskDone = 0;
          this.currentPriority++;
          // console.log('debug: scene task done, switch to next priority', this.currentPriority);
          if(this.currentPriority > this.maxPriority){
            this.allTasksDone = true;
            this.emitAllLoadedIfReady();
          }
        }
      }
    }
  }
  doNetworkTask () {
    const task = this.networkQueues[this.currentPriority].shift();
    
    if (task.type === 'chunk') {
      return this.loadChunk(task);
    } else {
      return task.load();
    }
  }

  // 新增：加载单个分块
  loadChunk (chunkTask) {
    // console.log('debug: [START] chunk network transfer:', chunkTask.chunkSrc);
    
    return new Promise((resolve, reject) => {
      fileLoader.setResponseType('arraybuffer');
      fileLoader.load(chunkTask.chunkSrc,
        response => {
          const done = () => {
            // 存储分块数据
            this.storeChunkData(chunkTask.baseSrc, chunkTask.chunkIndex, response);
            // 解决对应的Promise
            this.resolveChunkPromise(chunkTask.baseSrc, chunkTask.chunkIndex);
            resolve();
          };
          if (this.getAttribute('prefetch') === 'on' && /\.gltf$/i.test(chunkTask.chunkSrc)) {
            const base = chunkTask.chunkSrc.substring(0, chunkTask.chunkSrc.lastIndexOf('/') + 1);
            prefetchGltfDependencies(response, base).then(done);
          } else {
            done();
          }
        },
        undefined,
        error => {
          // console.log('debug: [ERROR] chunk network transfer:', chunkTask.chunkSrc, error);
          reject(error);
        }
      );
    });
  }

  // 新增：存储分块数据
  storeChunkData (baseSrc, chunkIndex, data) {
    if (!this.chunkData[baseSrc]) {
      this.chunkData[baseSrc] = {};
    }
    this.chunkData[baseSrc][chunkIndex] = data;
    // console.log('debug: [CHUNK DATA STORED]', baseSrc, 'chunk:', chunkIndex);
  }

  // 新增：检查分块数据是否准备好
  isChunkDataReady (baseSrc, chunkIndex) {
    return this.chunkData[baseSrc] && this.chunkData[baseSrc][chunkIndex];
  }

  // 新增：获取分块数据
  getChunkData (baseSrc, chunkIndex) {
    return this.chunkData[baseSrc] && this.chunkData[baseSrc][chunkIndex];
  }

  // 新增：创建分块Promise
  createChunkPromise (baseSrc, chunkIndex) {
    if (!this.chunkPromises[baseSrc]) {
      this.chunkPromises[baseSrc] = {};
    }
    if (!this.chunkResolvers[baseSrc]) {
      this.chunkResolvers[baseSrc] = {};
    }
    
    this.chunkPromises[baseSrc][chunkIndex] = new Promise((resolve) => {
      this.chunkResolvers[baseSrc][chunkIndex] = resolve;
    });
    
    // console.log('debug: [CHUNK PROMISE CREATED]', baseSrc, 'chunk:', chunkIndex);
  }

  // 新增：获取分块Promise
  getChunkPromise (baseSrc, chunkIndex) {
    return this.chunkPromises[baseSrc] && this.chunkPromises[baseSrc][chunkIndex];
  }

  // 新增：解决分块Promise
  resolveChunkPromise (baseSrc, chunkIndex) {
    if (this.chunkResolvers[baseSrc] && this.chunkResolvers[baseSrc][chunkIndex]) {
      this.chunkResolvers[baseSrc][chunkIndex]();
      // console.log('debug: [CHUNK PROMISE RESOLVED]', baseSrc, 'chunk:', chunkIndex);
    }
  }
  doGLTFTask (task) {
    return this.doNormalGLTFTask(task);
  }

  doNormalGLTFTask (task) {
    const self = this;
    return new Promise((resolve, reject) => {
      task.loader.load(task.src, function gltfLoaded (gltfModel) {
        task.theself.model = gltfModel.scene || gltfModel.scenes[0];
        task.theself.model.animations = gltfModel.animations;
        task.el.setObject3D('mesh', task.theself.model);
        self.queueGpuPrepare(task.theself.model);
        task.el.emit('model-loaded', {format: 'gltf', model: task.theself.model});
        resolve();
      }, undefined /* onProgress */, function gltfFailed (error) {
        var message = (error && error.message) ? error.message : 'Failed to load glTF model';
        warn(message);
        task.el.emit('model-error', {format: 'gltf', src: task.src});
        reject(error);
      });
    });
  }

  
  doSoundTask (task) {
    return new Promise((resolve, reject) => {
      task.loader.load(task.src, function (buffer) {
        for (var i = 0; i < task.theself.pool.children.length; i++) {
          task.sound = task.theself.pool.children[i];
          task.sound.setBuffer(buffer);
        }
        task.theself.loaded = true;

        // Remove this key from cache, otherwise we can't play it again
        THREE.Cache.remove(task.src);
        if (task.theself.data.autoplay || task.theself.mustPlay) { task.theself.playSound(task.theself.processSound); }
        task.theself.el.emit('sound-loaded', task.theself.evtDetail, false);
        resolve();
      }, undefined /* onProgress */, function (error) {
        reject(error);
      });
    });
  }
  async doSceneTask () {
    const task = this.sceneQueues[this.currentPriority].shift();
    if(task.type === 'chunk-gltf'){
      await this.doChunkGLTFTask(task);
    }else if(task.type === 'gltf-model'){
      await this.doGLTFTask(task);
    }else if (task.type === 'sound'){
      await this.doSoundTask(task);
    }
  }

  // 新增：处理单个分块的GLTF加载
  doChunkGLTFTask (task) {
    return new Promise((resolve, reject) => {
      const chunkData = this.getChunkData(task.baseSrc, task.chunkIndex);
      
      if (!chunkData) {
        const error = new Error('Chunk data not available for ' + task.baseSrc + ' chunk ' + task.chunkIndex);
        console.error('debug: [ERROR] chunk data missing:', task.baseSrc, task.chunkIndex);
        reject(error);
        return;
      }
      
      const resourcePath = task.chunkBasePath || '';
      task.loader.parse(chunkData, resourcePath, (gltfModel) => {
        // 存储加载的分块模型
        this.storeLoadedChunk(task.baseSrc, task.chunkIndex, gltfModel);
        
        // 检查是否所有分块都加载完成
        if (this.areAllChunksLoaded(task.baseSrc, task.totalChunks)) {
          // 组装完整模型
          const combinedModel = this.combineChunks(task.baseSrc, task.totalChunks);
          
          // 设置到元素上（只在最后一个分块完成时）
          task.theself.model = combinedModel;
          task.el.setObject3D('mesh', combinedModel);
          this.queueGpuPrepare(combinedModel);
          task.el.emit('model-loaded', {format: 'gltf', model: combinedModel, isChunked: true});
        }
        
        resolve();
      }, (error) => {
        reject(error);
      });
    });
  }

  // 新增：存储已加载的分块模型
  storeLoadedChunk (baseSrc, chunkIndex, gltfModel) {
    if (!this.loadedChunks[baseSrc]) {
      this.loadedChunks[baseSrc] = {};
    }
    this.loadedChunks[baseSrc][chunkIndex] = gltfModel;
    // console.log('debug: [CHUNK MODEL STORED]', baseSrc, 'chunk:', chunkIndex);
  }

  // 新增：检查所有分块是否都加载完成
  areAllChunksLoaded (baseSrc, totalChunks) {
    if (!this.loadedChunks[baseSrc]) return false;
    
    for (let i = 1; i <= totalChunks; i++) {
      if (!this.loadedChunks[baseSrc][i]) {
        return false;
      }
    }
    return true;
  }

  // 新增：组合所有分块
  combineChunks (baseSrc, totalChunks) {
    // console.log('debug: [COMBINING CHUNKS]', baseSrc, totalChunks, 'chunks');
    
    const chunks = this.loadedChunks[baseSrc];
    
    // 使用第一个分块作为基础场景
    const firstChunk = chunks[1];
    const combinedScene = firstChunk.scene || firstChunk.scenes[0];
    
    // 将其他分块的内容添加到基础场景中（移动节点而非 clone，以保留 SkinnedMesh 与骨骼的引用，避免 matrixWorld 未更新导致 applyBoneTransform 报错）
    for (let i = 2; i <= totalChunks; i++) {
      const chunk = chunks[i];
      const chunkScene = chunk.scene || chunk.scenes[0];
      
      if (chunkScene) {
        while (chunkScene.children.length > 0) {
          combinedScene.add(chunkScene.children[0]);
        }
      }
    }
    
    // 保留第一个分块的动画（如果有的话）
    combinedScene.animations = firstChunk.animations || [];

    // Chunks of one model reference the same image files; each chunk is parsed
    // separately and gets its own THREE.Texture, so without this the same image
    // would be uploaded to the GPU once per chunk when the model is first drawn.
    this.shareChunkTextures(chunks, totalChunks, combinedScene);
    
    // console.log('debug: [COMBINE COMPLETE]', baseSrc, 'total children:', combinedScene.children.length);
    
    return combinedScene;
  }

  emitAllLoadedIfReady () {
    if (this.allTasksDone && !this.gpuQueue.length && !this.allLoadedEmitted) {
      this.allLoadedEmitted = true;
      this.parentNode.emit('all-assets-loaded');
    }
  }

  // One task per texture (GPU upload) and one per model (shader compilation).
  queueGpuPrepare (model) {
    if (!this.gpuPrepare || !model) { return; }
    if (!this.firstPriorityDone) { this.p1Models.push(model); return; }
    this.modelTextures(model).forEach((texture) => this.gpuQueue.push({ type: 'texture', texture }));
    this.gpuQueue.push({ type: 'compile', model });
  }

  prepareNow (model) {
    const scene = this.parentNode;
    const t0 = performance.now();
    try {
      this.modelTextures(model).forEach((texture) => scene.renderer.initTexture(texture));
      if (scene.camera) { scene.renderer.compile(model, scene.camera, scene.object3D); }
    } catch (error) {
      warn('gpu prepare failed: ' + (error && error.message));
    }
    const t1 = performance.now();
    this.logTask(-1, 'gpu-p1', model.name || '', t0, t1, t1);
  }

  modelTextures (model) {
    const textures = new Set();
    model.traverse((node) => {
      if (!node.material) { return; }
      (Array.isArray(node.material) ? node.material : [node.material]).forEach((material) => {
        Object.keys(material).forEach((prop) => {
          if (material[prop] && material[prop].isTexture) { textures.add(material[prop]); }
        });
      });
    });
    return textures;
  }

  doGpuTask () {
    const task = this.gpuQueue.shift();
    const scene = this.parentNode;
    try {
      if (task.type === 'texture') {
        scene.renderer.initTexture(task.texture);
      } else if (scene.camera) {
        scene.renderer.compile(task.model, scene.camera, scene.object3D);
      }
    } catch (error) {
      warn('gpu prepare failed: ' + (error && error.message));
    }
    this.emitAllLoadedIfReady();
  }

  // Replace textures that come from the same image (and have the same sampling
  // settings) by a single THREE.Texture shared by all chunks, so that the merged
  // model uploads each image once, like the original unchunked model.
  shareChunkTextures (chunks, totalChunks, combinedScene) {
    const textureKey = new Map();
    for (let i = 1; i <= totalChunks; i++) {
      const parser = chunks[i] && chunks[i].parser;
      if (!parser || !parser.json) { continue; }
      parser.associations.forEach((ref, obj) => {
        if (!obj || !obj.isTexture || !ref || ref.textures === undefined) { return; }
        const texDef = parser.json.textures && parser.json.textures[ref.textures];
        const imgDef = texDef && parser.json.images && parser.json.images[texDef.source];
        if (!imgDef || !imgDef.uri) { return; }
        textureKey.set(obj, [imgDef.uri, obj.wrapS, obj.wrapT, obj.magFilter, obj.minFilter,
          obj.flipY, obj.colorSpace, obj.channel].join('|'));
      });
    }
    const canonical = new Map();
    const replaced = new Set();
    combinedScene.traverse((node) => {
      if (!node.material) { return; }
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => {
        Object.keys(material).forEach((prop) => {
          const tex = material[prop];
          if (!tex || !tex.isTexture || !textureKey.has(tex)) { return; }
          const key = textureKey.get(tex);
          const shared = canonical.get(key);
          if (!shared) { canonical.set(key, tex); return; }
          if (shared !== tex) {
            material[prop] = shared;
            material.needsUpdate = true;
            replaced.add(tex);
          }
        });
      });
    });
    // The image data may be shared (THREE.Cache), so only the texture objects are disposed.
    replaced.forEach((tex) => tex.dispose());
  }

  /**
   * Check if a model is chunked based on HTML attributes
   * @param {Element} element - The a-asset-item element
   * @returns {boolean} - True if the model is chunked
   */
  isChunkedModel (element) {
    if (!element || !element.getAttribute) return false;
    
    const chunked = element.getAttribute('chunked');
    const isChunked = chunked === 'true';
    
    // Debug logging
    // console.log('🔍 [CHUNK DETECTION]', {
    //   id: element.getAttribute('id'),
    //   src: element.getAttribute('src'),
    //   chunked: chunked,
    //   isChunked: isChunked
    // });
    
    return isChunked;
  }

  /**
   * Get the number of chunks for a chunked model from HTML attributes
   * @param {Element} element - The a-asset-item element
   * @returns {number} - The number of chunks, or 0 if not chunked
   */
  getChunkCount (element) {
    if (!this.isChunkedModel(element)) return 0;
    
    const chunkCountAttr = element.getAttribute('chunk-count');
    const chunkCount = parseInt(chunkCountAttr, 10);
    
    if (isNaN(chunkCount) || chunkCount <= 0) {
      // console.warn('⚠️ [CHUNK COUNT] Invalid chunk-count attribute:', chunkCountAttr, 'for element:', element.getAttribute('id'));
      return 0;
    }
    
    // console.log('✅ [CHUNK COUNT]', {
    //   id: element.getAttribute('id'),
    //   src: element.getAttribute('src'),
    //   chunkCount: chunkCount
    // });
    
    return chunkCount;
  }

  /**
   * Get the source path for a specific chunk.
   * If <a-assets> has chunk-profile, use scheme A: basePath_split_<profile>_<N>chunks/model_chunk_<i>.gltf
   * Otherwise legacy: basePath_split_<N>chunks/model_chunk_<i>.gltf
   * @param {Element} element - The a-asset-item element
   * @param {number} chunkIndex - The chunk index (1-based)
   * @returns {string} - The chunk source path
   */
  getChunkSrc (element, chunkIndex) {
    const basePath = element.getAttribute('src');
    const chunkCount = this.getChunkCount(element);
    const assetsEl = element.parentNode && element.parentNode.tagName && element.parentNode.tagName.toLowerCase() === 'a-assets'
      ? element.parentNode
      : (element.closest && element.closest('a-assets'));
    const profile = assetsEl && assetsEl.getAttribute && assetsEl.getAttribute('chunk-profile');
    if (profile) {
      return `${basePath}_split_${profile}_${chunkCount}chunks/model_chunk_${chunkIndex}.gltf`;
    }
    return `${basePath}_split_${chunkCount}chunks/model_chunk_${chunkIndex}.gltf`;
  }


 
}

customElements.define('a-assets', AAssets);

/**
 * Preload using XHRLoader for any type of asset.
 */
class AAssetItem extends ANode {
  constructor () {
    super();
    this.data = null;
    this.isAssetItem = true;
    this._loadingPromise = null;
    this._loadedPromise = new Promise((resolve) => {
      this._resolveLoaded = resolve;
    });
  }
  loaded(){
    return this._loadedPromise;
  }
  load() {
    if (this._loadingPromise) return this._loadingPromise;
    
    const src = this.getAttribute('src');
    // console.log('debug: [START] network transfer:', src);
    
    // Check if this is an image file
    if (this.isImageFile(src)) {
      this._loadingPromise = this.loadImage(src);
    } else {
      this._loadingPromise = this.loadOtherFile(src);
    }

    return this._loadingPromise;
  }

  isImageFile(src) {
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
    const fileName = src.toLowerCase();
    const isImage = imageExtensions.some(ext => fileName.endsWith(ext));
    // console.log('debug: [IMAGE CHECK]', src, 'isImage:', isImage);
    return isImage;
  }

  loadImage(src) {
    return new Promise((resolve, reject) => {
      // Use blob response type for images
      fileLoader.setResponseType('blob');
      fileLoader.load(src, 
        response => {
          // Create img element from blob
          const img = new Image();
          img.onload = () => {
            this.data = img;  // Store img element instead of blob
            ANode.prototype.load.call(this);
            // console.log('debug: [END] network transfer (image):', src);
            resolve();
            this._resolveLoaded();
          };
          img.onerror = (error) => {
            this.emit('error', {error}, false);
            // console.log('debug: [ERROR] network transfer (image):', src, error);
            reject(error);
          };
          // Create object URL from blob and set as img src
          img.src = URL.createObjectURL(response);
        },
        xhr => {
          this.emit('progress', {
            loadedBytes: xhr.loaded,
            totalBytes: xhr.total,
            xhr: xhr
          });
        },
        error => {
          this.emit('error', {error}, false);
          // console.log('debug: [ERROR] network transfer (image):', src, error);
          reject(error);
        }
      );
    });
  }

  loadOtherFile(src) {
    const responseType = this.getAttribute('response-type') || inferResponseType(src);
    const id = this.getAttribute('id');
    return new Promise((resolve, reject) => {
      fileLoader.setResponseType(responseType);
      fileLoader.load(src, 
        response => {
          const done = () => {
            this.data = response;
            ANode.prototype.load.call(this);
            resolve();
            this._resolveLoaded();
          };
          const assetsEl = this.parentNode;
          if (assetsEl && assetsEl.getAttribute && assetsEl.getAttribute('prefetch') === 'on' && /\.gltf$/i.test(src)) {
            prefetchGltfDependencies(response, THREE.LoaderUtils.extractUrlBase(src)).then(done);
          } else {
            done();
          }
        },
        xhr => {
          this.emit('progress', {
            loadedBytes: xhr.loaded,
            totalBytes: xhr.total,
            xhr: xhr
          });
        },
        error => {
          this.emit('error', {error}, false);
          // console.log('debug: [ERROR] network transfer:', src, error);
          reject(error);
        }
      );
    });
  }
}

customElements.define('a-asset-item', AAssetItem);

/**
 * Create a Promise that resolves once the media element has finished buffering.
 *
 * @param {Element} el - HTMLMediaElement.
 * @returns {Promise}
 */
function mediaElementLoaded (el) {
  if (!el.hasAttribute('autoplay') && el.getAttribute('preload') !== 'auto') {
    return;
  }

  // If media specifies autoplay or preload, wait until media is completely buffered.
  return new Promise(function (resolve, reject) {
    if (el.readyState === 4) { return resolve(); }  // Already loaded.
    if (el.error) { return reject(); }  // Error.

    el.addEventListener('loadeddata', checkProgress, false);
    el.addEventListener('progress', checkProgress, false);
    el.addEventListener('error', reject, false);

    function checkProgress () {
      // Add up the seconds buffered.
      var secondsBuffered = 0;
      for (var i = 0; i < el.buffered.length; i++) {
        secondsBuffered += el.buffered.end(i) - el.buffered.start(i);
      }

      // Compare seconds buffered to media duration.
      if (secondsBuffered >= el.duration) {
        // Set in cache because we won't be needing to call three.js loader if we have.
        // a loaded media element.
        // Store video elements only. three.js loader is used for audio elements.
        // See assetParse too.
        if (el.tagName === 'VIDEO') {
          THREE.Cache.add(el.getAttribute('src'), el);
        }
        resolve();
      }
    }
  });
}

/**
 * Automatically add attributes to media elements where convenient.
 * crossorigin, playsinline.
 */
function fixUpMediaElement (mediaEl) {
  // Cross-origin.
  var newMediaEl = setCrossOrigin(mediaEl);

  // Plays inline for mobile.
  if (newMediaEl.tagName && newMediaEl.tagName.toLowerCase() === 'video') {
    newMediaEl.setAttribute('playsinline', '');
    newMediaEl.setAttribute('webkit-playsinline', '');
  }

  if (newMediaEl !== mediaEl) {
    mediaEl.parentNode.appendChild(newMediaEl);
    mediaEl.parentNode.removeChild(mediaEl);
  }
  return newMediaEl;
}

/**
 * Automatically set `crossorigin` if not defined on the media element.
 * If it is not defined, we must create and re-append a new media element <img> and
 * have the browser re-request it with `crossorigin` set.
 *
 * @param {Element} mediaEl - Media element (e.g., <img>, <audio>, <video>).
 * @returns {Element} Media element to be used to listen to for loaded events.
 */
function setCrossOrigin (mediaEl) {
  var newMediaEl;
  var src;

  // Already has crossorigin set.
  if (mediaEl.hasAttribute('crossorigin')) { return mediaEl; }

  src = mediaEl.getAttribute('src');

  if (src !== null) {
    // Does not have protocol.
    if (src.indexOf('://') === -1) { return mediaEl; }

    // Determine if cross origin is actually needed.
    if (extractDomain(src) === window.location.host) { return mediaEl; }
  }

  warn('Cross-origin element (e.g., <img>) was requested without `crossorigin` set. ' +
       'A-Frame will re-request the asset with `crossorigin` attribute set. ' +
       'Please set `crossorigin` on the element (e.g., <img crossorigin="anonymous">)', src);
  mediaEl.crossOrigin = 'anonymous';
  newMediaEl = mediaEl.cloneNode(true);
  return newMediaEl;
}

/**
 * Extract domain out of URL.
 *
 * @param {string} url
 * @returns {string}
 */
function extractDomain (url) {
  // Find and remove protocol (e.g., http, ftp, etc.) to get domain.
  var domain = url.indexOf('://') > -1 ? url.split('/')[2] : url.split('/')[0];

  // Find and remove port number.
  return domain.substring(0, domain.indexOf(':'));
}

/**
 * Infer response-type attribute from src.
 * Default is text (default XMLHttpRequest.responseType)
 * and arraybuffer for .glb files.
 *
 * @param {string} src
 * @returns {string}
 */
export function inferResponseType (src) {
  var fileName = getFileNameFromURL(src);
  var dotLastIndex = fileName.lastIndexOf('.');
  if (dotLastIndex >= 0) {
    var extension = fileName.slice(dotLastIndex, src.search(/\?|#|$/));
    if (extension === '.glb') {
      return 'arraybuffer';
    }
  }
  return 'text';
}

/**
 * Extract filename from URL
 *
 * @param {string} url
 * @returns {string}
 */
export function getFileNameFromURL (url) {
  var parser = document.createElement('a');
  parser.href = url;
  var query = parser.search.replace(/^\?/, '');
  var filePath = url.replace(query, '').replace('?', '');
  return filePath.substring(filePath.lastIndexOf('/') + 1);
}
