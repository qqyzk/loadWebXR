/* global customElements */
import * as THREE from 'three';
import { ANode } from './a-node.js';
import { debug } from '../utils/index.js';

var fileLoader = new THREE.FileLoader();
var warn = debug('core:a-assets:warn');
/**
 * Asset management system. Handles blocking on asset loading.
 */
class AAssets extends ANode {
  constructor () {
    super();
    this.isAssets = true;
    this.fileLoader = fileLoader;
    this.timeout = null;
    this.priorityQueues = {1: [], 2: [], 3: []};
    this.renderFirstFrame = true;
    this.frameTimeBudget = 16.7;
    this.networkQueues = {1: [], 2: [], 3: []};
    this.sceneQueues = { 1: [],2: [], 3: []};
    this.sceneTaskCount = { 1: 0, 2: 0, 3: 0};
    this.currentPriority = 1;
    this.currentStage = 0;
    this.allTasksDone = false;
    this.sceneTaskDone=0;
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
    console.log('debug:queue', this.priorityQueues);
    this.load();
    // await this.loadGroup(1);//network trasfer
    // await this.doGroupSceneTask(1);//scene
    await this.loadFirstPriority();
    this.parentNode.emit('firstloaded');
    this.parentNode.addEventListener('render', async function (event) {
      const startTime = event.detail;
      if(!self.allTasksDone){
        self.doTasks(startTime);
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
      this.priorityQueues[priority].push(el);
      
      // Check if this is a chunked model
      const src = el.getAttribute('src');
      if (src && this.isChunkedModel(src)) {
        console.log('🔍 [ASSETS] Chunked model detected, skipping original asset:', src);
        // Don't add chunked models to networkQueues - they will be handled by gltf-model component
        // Only add to priorityQueues for reference
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
      console.log('debug: loading group', priority);
      await this.loadGroup(priority);

    }
  }
  async loadFirstPriority() {
    console.log('debug: loading first priority group', this.currentPriority);
    const group = this.networkQueues[1];
    console.log('debug: network transfering group',1, group);
    if (!group.length) return;
    group.map(item => {
      if (item.tagName === 'A-ASSET-ITEM') {
       this.loadAssetItem(item);
      } 
    });
    while(true){
      if(this.sceneQueues[this.currentPriority].length !== 0){
          await this.doSceneTask();
          this.sceneTaskDone++;
          if(this.sceneTaskDone === this.sceneTaskCount[this.currentPriority]){
            this.currentStage = 0;
            this.sceneTaskDone = 0;
            this.currentPriority++;
            break;
          }
        }else{
          await this.delay(2);
        }
    }
  }
  async loadGroup(priority) {
    const group = this.networkQueues[priority];
    console.log('debug: network transfering group', priority, group);
    if (!group.length) return;
    await Promise.all(
      group.map(item => {
       if (item.tagName === 'A-ASSET-ITEM') {
          return this.loadAssetItem(item);
        } else if (item.tagName === 'AUDIO') {
          return this.loadAudio(item);
        } 
      })
    );
    console.log('debug: netword transfered group', priority,this.sceneQueues);
  }
  delay (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  async doGroupSceneTask(priority) {
    while(this.sceneQueues[this.currentPriority].length  < this.priorityQueues[priority].length){
      await this.delay(2);
      console.log('debug: waiting for scene task', this.sceneQueues[this.currentPriority].length, this.priorityQueues[priority].length);
    }
    const group = this.sceneQueues[priority];
    console.log('debug: loading group', priority, group);
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
  async doTasks (startTime) {
    while ( performance.now()-startTime < this.frameTimeBudget && !this.allTasksDone) {
      if (this.currentStage === 0){
        this.doNetworkTask();
        if(this.networkQueues[this.currentPriority].length === 0){
          this.currentStage = 1;
          console.log('debug: network transfer started, switch to scene task', this.currentPriority);
        }
      }else if (this.currentStage === 1){
        if(this.sceneQueues[this.currentPriority].length !== 0){
          await this.doSceneTask();
          this.sceneTaskDone++;
          if(this.sceneTaskDone === this.sceneTaskCount[this.currentPriority]){
            this.currentStage = 0;
            this.sceneTaskDone = 0;
            this.currentPriority++;
            console.log('debug: scene task done, switch to next priority', this.currentPriority);
            if(this.currentPriority > 3){
              this.allTasksDone = true;
              this.parentNode.emit('all-assets-loaded');
            }
          }
        }else{
          await this.delay(2);
        }
      }
    }
  }
  doNetworkTask () {
    const item =  this.networkQueues[this.currentPriority].shift();
    item.load();
  }
  doGLTFTask (task) {
    // Check if this is a chunked model task
    if (task.isChunked) {
      return this.doChunkedGLTFTask(task);
    } else {
      return this.doNormalGLTFTask(task);
    }
  }

  doNormalGLTFTask (task) {
    const taskStartTime = performance.now();
    console.log('debug: [START] loading gltf model:', task.src, 'at:', taskStartTime.toFixed(2));
    return new Promise((resolve, reject) => {
      task.loader.load(task.src, function gltfLoaded (gltfModel) {
        const taskEndTime = performance.now();
        const taskDuration = taskEndTime - taskStartTime;
        task.theself.model = gltfModel.scene || gltfModel.scenes[0];
        task.theself.model.animations = gltfModel.animations;
        task.el.setObject3D('mesh', task.theself.model);
        task.el.emit('model-loaded', {format: 'gltf', model: task.theself.model});
        console.log('debug: [END] loading gltf model:', task.src, 'duration:', taskDuration.toFixed(2) + 'ms');
        resolve();
      }, undefined /* onProgress */, function gltfFailed (error) {
        const taskEndTime = performance.now();
        const taskDuration = taskEndTime - taskStartTime;
        var message = (error && error.message) ? error.message : 'Failed to load glTF model';
        warn(message);
        task.el.emit('model-error', {format: 'gltf', src: task.src});
        console.log('debug: [ERROR] loading gltf model:', task.src, 'duration:', taskDuration.toFixed(2) + 'ms', error);
        reject(error);
      });
    });
  }

  doChunkedGLTFTask (task) {
    const taskStartTime = performance.now();
    console.log('debug: [START] loading combined chunked gltf model:', task.baseSrc, 'at:', taskStartTime.toFixed(2));
    
    return new Promise((resolve, reject) => {
      // For chunked models, we need to load all chunks and combine them
      const chunkCount = this.getChunkCount(task.baseSrc);
      const chunkPromises = [];
      
      // Load each chunk
      for (let i = 1; i <= chunkCount; i++) {
        const chunkSrc = this.getChunkSrc(task.baseSrc, i);
        console.log('debug: [LOADING CHUNK]', chunkSrc);
        
        const chunkPromise = new Promise((chunkResolve, chunkReject) => {
          task.loader.load(chunkSrc, function gltfLoaded (gltfModel) {
            console.log('debug: [CHUNK LOADED]', chunkSrc);
            chunkResolve(gltfModel);
          }, undefined, function gltfFailed (error) {
            console.error('debug: [CHUNK FAILED]', chunkSrc, chunkSrc, error);
            chunkReject(error);
          });
        });
        
        chunkPromises.push(chunkPromise);
      }
      
      // Wait for all chunks to load, then combine them
      Promise.all(chunkPromises).then((chunkModels) => {
        const taskEndTime = performance.now();
        const taskDuration = taskEndTime - taskStartTime;
        
        console.log('debug: [COMBINING CHUNKS]', chunkCount, 'chunks');
        
        // Create a combined scene by merging all chunk scenes
        const combinedScene = chunkModels[0].scene || chunkModels[0].scenes[0];
        
        // Add other chunks to the combined scene
        for (let i = 1; i < chunkModels.length; i++) {
          const chunkScene = chunkModels[i].scene || chunkModels[i].scenes[0];
          if (chunkScene) {
            // Clone and add all children from this chunk
            chunkScene.children.forEach(child => {
              combinedScene.add(child.clone());
            });
          }
        }
        
        // Set the combined model
        task.theself.model = combinedScene;
        task.theself.model.animations = chunkModels[0].animations; // Use first chunk's animations
        task.el.setObject3D('mesh', task.theself.model);
        task.el.emit('model-loaded', {format: 'gltf', model: task.theself.model, isChunked: true});
        
        console.log('debug: [END] loading combined chunked gltf model:', task.baseSrc, 'duration:', taskDuration.toFixed(2) + 'ms');
        resolve();
      }).catch((error) => {
        const taskEndTime = performance.now();
        const taskDuration = taskEndTime - taskStartTime;
        var message = (error && error.message) ? error.message : 'Failed to load combined chunked glTF model';
        warn(message);
        task.el.emit('model-error', {format: 'gltf', src: task.baseSrc, isChunked: true});
        console.log('debug: [ERROR] loading combined chunked glTF model:', task.baseSrc, 'duration:', taskDuration.toFixed(2) + 'ms', error);
        reject(error);
      });
    });
  }
  doSoundTask (task) {
    console.log('debug: [START] loading sound:', task.src);
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
        console.log('debug: [END] loading sound:', task.src);
        resolve();
      }, undefined /* onProgress */, function (error) {
        console.log('debug: [ERROR] loading sound:', task.src, error);
        reject(error);
      });
    });
  }
  async doSceneTask () {
    const task = this.sceneQueues[this.currentPriority].shift();
    if(task.type === 'gltf-model'){
      await this.doGLTFTask(task);
    }else if (task.type === 'sound'){
      await this.doSoundTask(task);
    }
  }

  /**
   * Check if a model is chunked (split into multiple parts)
   * @param {string} src - The source URL of the model
   * @returns {boolean} - True if the model is chunked
   */
  isChunkedModel (src) {
    if (!src || typeof src !== 'string') return false;
    
    // Specify known chunked models explicitly
    // This is a reliable and performant solution
    const knownChunkedModels = [
      'Beach_Environment_v1.02.glb',
      'Beach_Seashell_particles_half_v1.01.glb',
      'Elly_2k_03.glb',
      'Noah_hunter_v1.01.glb'
    ];
    
    const isChunked = knownChunkedModels.some(model => src.includes(model));
    
    // Debug logging
    console.log('🔍 [CHUNK DETECTION]', {
      src: src,
      knownChunkedModels: knownChunkedModels,
      isChunked: isChunked
    });
    
    return isChunked;
  }

  /**
   * Get the number of chunks for a chunked model
   * @param {string} src - The source URL of the model
   * @returns {number} - The number of chunks, or 0 if not chunked
   */
  getChunkCount (src) {
    if (!this.isChunkedModel(src)) return 0;
    
    // Specify chunk count for each known chunked model
    if (src.includes('Beach_Environment_v1.02.glb')) {
      return 4; // 4 chunks
    }
    if (src.includes('Beach_Seashell_particles_half_v1.01.glb')) {
      return 4; // 4 chunks
    }
    if (src.includes('Elly_2k_03.glb')) {
      return 2; // 2 chunks
    }
    if (src.includes('Noah_hunter_v1.01.glb')) {
      return 2; // 2 chunks
    }
    
    // Default fallback (should not reach here for known models)
    console.warn('⚠️ [CHUNK COUNT] Unknown chunked model, using default:', src);
    return 2;
  }

  /**
   * Get the source path for a specific chunk
   * @param {string} baseSrc - The base source path
   * @param {number} chunkIndex - The chunk index (1-based)
   * @returns {string} - The chunk source path
   */
  getChunkSrc (baseSrc, chunkIndex) {
    const basePath = baseSrc;
    const chunkCount = this.getChunkCount(baseSrc);
    return `${basePath}_split_${chunkCount}chunks/model_chunk_${chunkIndex}.glb`;
  }

  /**
   * Download a single chunk file
   * @param {string} chunkSrc - The chunk source path
   * @returns {Promise} - Promise that resolves when chunk is downloaded
   */
  downloadChunk (chunkSrc) {
    console.log('📥 [DOWNLOADING CHUNK]', chunkSrc);
    
    // Create a temporary asset-item for chunk download
    const chunkAssetItem = document.createElement('a-asset-item');
    chunkAssetItem.setAttribute('src', chunkSrc);
    chunkAssetItem.setAttribute('id', `chunk_${Date.now()}_${Math.random()}`);
    
    // Return the download promise
    return chunkAssetItem.load().then(() => {
      console.log('✅ [CHUNK DOWNLOADED]', chunkSrc);
      return chunkAssetItem.data;
    }).catch((error) => {
      console.error('❌ [CHUNK DOWNLOAD FAILED]', chunkSrc, error);
      throw error;
    });
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
    console.log('debug: [START] network transfer:', src);
    const responseType = this.getAttribute('response-type') || inferResponseType(src);
    const id = this.getAttribute('id');
    this._loadingPromise = new Promise((resolve, reject) => {
      fileLoader.setResponseType(responseType);
      fileLoader.load(src, 
        response => {
          this.data = response;
          ANode.prototype.load.call(this);
          console.log('debug: [END] network transfer:', src);
          resolve();
          this._resolveLoaded();
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
          console.log('debug: [ERROR] network transfer:', src, error);
          reject(error);
        }
      );
    });

    return this._loadingPromise;
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
