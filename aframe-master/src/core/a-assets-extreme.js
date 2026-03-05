/* global customElements */
/**
 * a-assets-extreme.js
 *
 * Based on a-assets-profile.js. Extreme variant to verify that when scheduling is very slow,
 * we can still meet the target budget (greedy scheduling can achieve budget under slow load).
 *
 * === Change vs profile ===
 * Only one task is run every N frames (taskEveryNFrames = 3). So we throttle to at most
 * 1 task per N frames in the render-loop doTasks. Other frames do no asset work.
 */
import * as THREE from 'three';
import { ANode } from './a-node.js';
import { debug } from '../utils/index.js';

var fileLoader = new THREE.FileLoader();
var warn = debug('core:a-assets:warn');

class AAssets extends ANode {
  constructor () {
    super();
    this.isAssets = true;
    this.fileLoader = fileLoader;
    this.timeout = null;
    this.priorityQueues = {1: [], 2: [], 3: []};
    this.renderFirstFrame = true;
    this.frameTimeBudget = 16.7;
    this.safeMargin = 6; // 30% of budget; effectiveBudget = frameTimeBudget - safeMargin
    this.networkQueues = {1: [], 2: [], 3: []};
    this.sceneQueues = { 1: [],2: [], 3: []};
    this.sceneTaskCount = { 1: 0, 2: 0, 3: 0};
    this.currentPriority = 1;
    this.currentStage = 0;
    this.allTasksDone = false;
    this.sceneTaskDone = 0;
    this._profileFrameIndex = 0;
    this._profileFrames = [];
    this._profileLastRenderStartTime = null;
    // Extreme: at most 1 task every N frames (slow scheduling to verify budget is achievable)
    this._extremeFrameIndex = 0;
    this.taskEveryNFrames = 5;
    // Wait M frames after first render before starting priority 2/3 scheduling; those M frames count as priority 1
    this.taskWaitFramesAfterFirst = 10;
    this._extremeWaitFramesRemaining = 10;
  }

  async doConnectedCallback () {
    var self = this;

    super.doConnectedCallback();

    if (!this.parentNode.isScene) {
      throw new Error('<a-assets> must be a child of a <a-scene>.');
    }
    await customElements.whenDefined('a-asset-item');
    await Promise.resolve();
    this.collectResources();
    this.load();
    await this.loadFirstPriority();
    this.parentNode.emit('firstloaded');
    this.parentNode.addEventListener('render', async function (event) {
      const startTime = event.detail;
      if (!self.allTasksDone) {
        self.doTasks(startTime);
      }
    });
  }

  disconnectedCallback () {
    super.disconnectedCallback();
    if (this.timeout) { clearTimeout(this.timeout); }
  }

  load () {
    super.load.call(this, null, function () { return false; });
  }

  collectResources () {
    const elements = this.getChildren();
    elements.forEach(el => {
      const priority = this.getPriority(el);
      this.priorityQueues[priority].push(el);
      this.networkQueues[priority].push(el);
    });
  }

  getPriority (el) {
    if (el.hasAttribute('priority')) return parseInt(el.getAttribute('priority'));
    return 3;
  }

  async loadPriorityGroups (groups) {
    for (let priority of groups) {
      await this.loadGroup(priority);
    }
  }

  async loadFirstPriority () {
    const group = this.networkQueues[1];
    if (!group.length) return;

    group.map(item => {
      if (item.tagName === 'A-ASSET-ITEM') {
        this.loadAssetItem(item);
      }
    });

    const frameStart = performance.now();
    const frameTasks = [];
    let frameNetworkMs = 0;
    const framePriority = this.currentPriority;

    while (true) {
      if (this.sceneQueues[this.currentPriority].length !== 0) {
        const lastUsedMs = performance.now() - frameStart;
        const t0 = performance.now();
        const info = await this.doSceneTask();
        if (info) {
          frameTasks.push({ ...info, durationMs: performance.now() - t0,  lastUsedMs: lastUsedMs });
        }
        this.sceneTaskDone++;
      } else {
        await this.delay(2);
      }
      if (this.sceneTaskDone === this.sceneTaskCount[this.currentPriority]) {
        this.currentStage = 0;
        this.sceneTaskDone = 0;
        this.currentPriority++;
        break;
      }
    }
    // Do not record priority 1; only priority 2+ are recorded in doTasks (every render frame).
  }

  async loadGroup (priority) {
    const group = this.networkQueues[priority];
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
  }

  delay (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async doGroupSceneTask (priority) {
    while (this.sceneQueues[this.currentPriority].length < this.priorityQueues[priority].length) {
      await this.delay(2);
    }
    const group = this.sceneQueues[priority];
    if (!group.length) return;
    await Promise.all(
      group.map(item => {
        if (item.type === 'gltf-model') {
          return this.doGLTFTask(item);
        } else if (item.type === 'sound') {
          return this.doSoundTask(item);
        }
      })
    );
  }

  async loadAssetItem (item) {
    return item.load();
  }

  async loadAudio (audioEl) {
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
    this.sceneTaskCount[task.priority] += 1;
  }

  registerSceneTask (task) {
    this.sceneQueues[task.priority].push(task);
  }

  async doTasks (startTime) {
    const frameStart = startTime;
    // lastTrueRenderTimeMs = interval since previous render (every frame)
    const lastTrueRenderTimeMs = this._profileLastRenderStartTime != null
      ? frameStart - this._profileLastRenderStartTime
      : undefined;
    this._profileLastRenderStartTime = frameStart;

    // One record per render frame; frameIndex = render frame index (0, 1, 2, ...)
    const currentFrameIndex = this._profileFrameIndex++;
    // After first render, wait M frames before starting priority 2/3; do not record (no priority 1).
    if (this._extremeWaitFramesRemaining > 0) {
      this._extremeWaitFramesRemaining--;
      return;
    }
    this._extremeFrameIndex++;
    // Only run tasks every N frames (very slow scheduling: at most 1 task every N frames)
    if (this._extremeFrameIndex % this.taskEveryNFrames !== 0) {
      this._profileFrames.push({
        frameIndex: currentFrameIndex,
        priority: this.currentPriority,
        ...(lastTrueRenderTimeMs !== undefined && { lastTrueRenderTimeMs: lastTrueRenderTimeMs }),
        frameStart: frameStart,
        frameEnd: frameStart,
        frameDurationMs: 0,
        taskDurationMs: 0,
        networkTaskDurationMs: 0,
        tasks: []
      });
      return;
    }

    const frameTasks = [];
    let frameNetworkMs = 0;
    const framePriority = this.currentPriority;
    let tasksDoneThisFrame = 0;
    const maxTasksThisFrame = 1;

    const effectiveBudget = this.frameTimeBudget - this.safeMargin;
    while (performance.now() - startTime < effectiveBudget && !this.allTasksDone && tasksDoneThisFrame < maxTasksThisFrame) {
      if (this.currentStage === 0) {
        if (this.networkQueues[this.currentPriority].length > 0) {
          const lastUsedMs = performance.now() - startTime;
          const t0 = performance.now();
          const info = this.doNetworkTask();
          if (info) {
            const durationMs = performance.now() - t0;
            frameTasks.push({ ...info, durationMs: durationMs, lastUsedMs: lastUsedMs, curUsedMs: performance.now() - startTime  });
            frameNetworkMs += durationMs;
            tasksDoneThisFrame++;
          }
        } else {
          this.currentStage = 1;
        }
      } else if (this.currentStage === 1) {
        if (this.sceneQueues[this.currentPriority].length !== 0) {
          const lastUsedMs = performance.now() - startTime;
          const t0 = performance.now();
          const info = await this.doSceneTask();
          if (info) {
            frameTasks.push({ ...info, durationMs: performance.now() - t0, lastUsedMs: lastUsedMs, curUsedMs: performance.now() - startTime });
          }
          this.sceneTaskDone++;
          tasksDoneThisFrame++;
        } else {
          await this.delay(2);
        }
        if (this.sceneTaskDone === this.sceneTaskCount[this.currentPriority]) {
          this.currentStage = 0;
          this.sceneTaskDone = 0;
          this.currentPriority++;
          if (this.currentPriority > 3) {
            this.allTasksDone = true;
            const self = this;
            setTimeout(function () {
              console.log(JSON.stringify(self._profileFrames, null, 2));
            }, 0);
            this.parentNode.emit('all-assets-loaded');
          }
        }
      }
    }

    const frameEnd = performance.now();
    const taskDurationMs = frameTasks.reduce(function (s, t) { return s + (t.durationMs || 0); }, 0);
    this._profileFrames.push({
      frameIndex: currentFrameIndex,
      priority: framePriority,
      ...(lastTrueRenderTimeMs !== undefined && { lastTrueRenderTimeMs: lastTrueRenderTimeMs }),
      frameStart: frameStart,
      frameEnd: frameEnd,
      frameDurationMs: frameEnd - frameStart,
      taskDurationMs: taskDurationMs,
      networkTaskDurationMs: frameNetworkMs,
      tasks: frameTasks
    });
  }

  doNetworkTask () {
    const task = this.networkQueues[this.currentPriority].shift();
    if (!task) return undefined;
    const src = task.getAttribute ? task.getAttribute('src') : null;
    const id = task.getAttribute ? task.getAttribute('id') : null;
    const tag = task.tagName ? task.tagName.toLowerCase() : 'unknown';
    task.load();
    return { type: 'network', subtype: tag, src, id };
  }

  doGLTFTask (task) {
    return this.doNormalGLTFTask(task);
  }

  doNormalGLTFTask (task) {
    return new Promise((resolve, reject) => {
      task.loader.load(task.src, function gltfLoaded (gltfModel) {
        task.theself.model = gltfModel.scene || gltfModel.scenes[0];
        task.theself.model.animations = gltfModel.animations;
        task.el.setObject3D('mesh', task.theself.model);
        task.el.emit('model-loaded', {format: 'gltf', model: task.theself.model});
        resolve();
      }, undefined, function gltfFailed (error) {
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
        THREE.Cache.remove(task.src);
        if (task.theself.data.autoplay || task.theself.mustPlay) {
          task.theself.playSound(task.theself.processSound);
        }
        task.theself.el.emit('sound-loaded', task.theself.evtDetail, false);
        resolve();
      }, undefined, function (error) {
        reject(error);
      });
    });
  }

  async doSceneTask () {
    const task = this.sceneQueues[this.currentPriority].shift();
    if (!task) return undefined;
    if (task.type === 'gltf-model') {
      await this.doGLTFTask(task);
    } else if (task.type === 'sound') {
      await this.doSoundTask(task);
    }
    const src = task.src || (task.el && task.el.getAttribute && task.el.getAttribute('src'));
    const id = task.el && task.el.getAttribute && task.el.getAttribute('id');
    return { type: 'scene', subtype: task.type, src, id };
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

  loaded () {
    return this._loadedPromise;
  }

  load () {
    if (this._loadingPromise) return this._loadingPromise;

    const src = this.getAttribute('src');
    if (this.isImageFile(src)) {
      this._loadingPromise = this.loadImage(src);
    } else {
      this._loadingPromise = this.loadOtherFile(src);
    }
    return this._loadingPromise;
  }

  isImageFile (src) {
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
    const fileName = src.toLowerCase();
    return imageExtensions.some(ext => fileName.endsWith(ext));
  }

  loadImage (src) {
    return new Promise((resolve, reject) => {
      fileLoader.setResponseType('blob');
      fileLoader.load(src,
        response => {
          const img = new Image();
          img.onload = () => {
            this.data = img;
            ANode.prototype.load.call(this);
            resolve();
            this._resolveLoaded();
          };
          img.onerror = (error) => {
            this.emit('error', {error}, false);
            reject(error);
          };
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
          reject(error);
        }
      );
    });
  }

  loadOtherFile (src) {
    const responseType = this.getAttribute('response-type') || inferResponseType(src);
    return new Promise((resolve, reject) => {
      fileLoader.setResponseType(responseType);
      fileLoader.load(src,
        response => {
          this.data = response;
          ANode.prototype.load.call(this);
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
          reject(error);
        }
      );
    });
  }
}

customElements.define('a-asset-item', AAssetItem);

function mediaElementLoaded (el) {
  if (!el.hasAttribute('autoplay') && el.getAttribute('preload') !== 'auto') {
    return;
  }
  return new Promise(function (resolve, reject) {
    if (el.readyState === 4) { return resolve(); }
    if (el.error) { return reject(); }

    el.addEventListener('loadeddata', checkProgress, false);
    el.addEventListener('progress', checkProgress, false);
    el.addEventListener('error', reject, false);

    function checkProgress () {
      var secondsBuffered = 0;
      for (var i = 0; i < el.buffered.length; i++) {
        secondsBuffered += el.buffered.end(i) - el.buffered.start(i);
      }
      if (secondsBuffered >= el.duration) {
        if (el.tagName === 'VIDEO') {
          THREE.Cache.add(el.getAttribute('src'), el);
        }
        resolve();
      }
    }
  });
}

function fixUpMediaElement (mediaEl) {
  var newMediaEl = setCrossOrigin(mediaEl);
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

function setCrossOrigin (mediaEl) {
  var newMediaEl;
  var src;
  if (mediaEl.hasAttribute('crossorigin')) { return mediaEl; }
  src = mediaEl.getAttribute('src');
  if (src !== null) {
    if (src.indexOf('://') === -1) { return mediaEl; }
    if (extractDomain(src) === window.location.host) { return mediaEl; }
  }
  warn('Cross-origin element (e.g., <img>) was requested without `crossorigin` set. ' +
       'A-Frame will re-request the asset with `crossorigin` attribute set. ' +
       'Please set `crossorigin` on the element (e.g., <img crossorigin="anonymous">)', src);
  mediaEl.crossOrigin = 'anonymous';
  newMediaEl = mediaEl.cloneNode(true);
  return newMediaEl;
}

function extractDomain (url) {
  var domain = url.indexOf('://') > -1 ? url.split('/')[2] : url.split('/')[0];
  return domain.substring(0, domain.indexOf(':'));
}

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

export function getFileNameFromURL (url) {
  var parser = document.createElement('a');
  parser.href = url;
  var query = parser.search.replace(/^\?/, '');
  var filePath = url.replace(query, '').replace('?', '');
  return filePath.substring(filePath.lastIndexOf('/') + 1);
}
