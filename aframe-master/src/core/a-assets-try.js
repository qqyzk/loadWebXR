/* global customElements */
/**
 * a-assets-profile.js
 *
 * Same logic as a-assets-no-chunk.js, with one addition: in the doTasks loop (and the
 * loadFirstPriority while-loop), we measure the time of each call and record task info
 * (type, src, id) so we can output a per-frame profile. Timing is done only in the loop;
 * doNetworkTask/doSceneTask are changed only to return task descriptors for logging.
 *
 * === Changes vs no-chunk (only these) ===
 *
 * 1. Constructor: add _profileFrameIndex, _profileFrameTasks, _profileFrames,
 *    _profileFrameStart, _profileFramePriority, _profileFrameNetworkMs.
 *
 * 2. doTasks (render-loop):
 *    - Start: set _profileFrameStart = startTime, _profileFrameTasks = [],
 *      _profileFrameNetworkMs = 0, _profileFramePriority = this.currentPriority.
 *    - Before doNetworkTask(): t0 = performance.now(); info = this.doNetworkTask();
 *      if (info) push { ...info, durationMs: now()-t0 }, _profileFrameNetworkMs += duration.
 *    - Before await doSceneTask(): t0 = performance.now(); info = await this.doSceneTask();
 *      if (info) push { ...info, durationMs: now()-t0 }.
 *    - When allTasksDone: setTimeout 0, console.log(JSON.stringify(_profileFrames, null, 2)).
 *    - After while: if (_profileFrameTasks.length) push one frame object to _profileFrames,
 *      then _profileFrameIndex++.
 *
 * 3. loadFirstPriority (its while-loop): same idea — before each await doSceneTask(),
 *    t0 = now(), info = await doSceneTask(), if (info) push to _profileFrameTasks with
 *    durationMs = now()-t0. We must init _profileFrame* at start of loadFirstPriority
 *    and push a frame at end so priority-1 frames are included.
 *
 * 4. doNetworkTask: return task descriptor instead of task.load().
 *    task = shift(); if (!task) return; get src, id, tag; task.load(); return { type:'network', subtype:tag, src, id }.
 *
 * 5. doSceneTask: after doing the work, return { type:'scene', subtype: task.type, src, id }
 *    so the loop can log it (no timing inside doSceneTask).
 *
 * Output: one JSON array of frames. Each frame has frameIndex, priority, frameStart, frameEnd,
 * frameDurationMs, taskDurationMs, networkTaskDurationMs, tasks: [].
 * lastTrueRenderTimeMs (optional): user-perceived frame interval = this frameStart - previous render's
 * frameStart; only present from the second render frame onward.
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
    this.safeMargin = this.frameTimeBudget * 0.3; // 30% of budget; effectiveBudget = frameTimeBudget - safeMargin
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
    this._profileLastFrameDurationMs = 0;
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

    if (frameTasks.length > 0) {
      const frameEnd = performance.now();
      const taskDurationMs = frameTasks.reduce(function (s, t) { return s + (t.durationMs || 0); }, 0);
      const frameIndex = this._profileFrameIndex++;
      this._profileFrames.push({
        frameIndex: frameIndex,
        priority: framePriority,
        frameStart: frameStart,
        frameEnd,
        frameDurationMs: frameEnd - frameStart,
        taskDurationMs: taskDurationMs,
        networkTaskDurationMs: frameNetworkMs,
        tasks: frameTasks
      });
    }
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
    const lastTrueRenderTimeMs = this._profileLastRenderStartTime != null
      ? frameStart - this._profileLastRenderStartTime
      : undefined;
    this._profileLastRenderStartTime = frameStart;

    const frameTasks = [];
    let frameNetworkMs = 0;
    const framePriority = this.currentPriority;

    const effectiveBudget = this.frameTimeBudget - this.safeMargin;

    if (this._profileLastFrameDurationMs > effectiveBudget) {
      const frameEnd = performance.now();
      this._profileLastFrameDurationMs = frameEnd - frameStart;
      const frameIndex = this._profileFrameIndex++;
      this._profileFrames.push({
        frameIndex: frameIndex,
        priority: framePriority,
        ...(lastTrueRenderTimeMs !== undefined && { lastTrueRenderTimeMs: lastTrueRenderTimeMs }),
        frameStart: frameStart,
        frameEnd,
        frameDurationMs: frameEnd - frameStart,
        taskDurationMs: 0,
        networkTaskDurationMs: 0,
        tasks: [],
        skipped: true
      });
      return;
    }

    while (performance.now() - startTime < effectiveBudget && !this.allTasksDone) {
      if (this.currentStage === 0) {
        if (this.networkQueues[this.currentPriority].length > 0) {
          const lastUsedMs = performance.now() - startTime;
          const t0 = performance.now();
          const info = this.doNetworkTask();
          if (info) {
            const durationMs = performance.now() - t0;
            frameTasks.push({ ...info, durationMs: durationMs, lastUsedMs: lastUsedMs, curUsedMs: performance.now() - startTime  });
            frameNetworkMs += durationMs;
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
    this._profileLastFrameDurationMs = frameEnd - frameStart;

    if (frameTasks.length > 0) {
      const taskDurationMs = frameTasks.reduce(function (s, t) { return s + (t.durationMs || 0); }, 0);
      const frameIndex = this._profileFrameIndex++;
      const frameRecord = {
        frameIndex: frameIndex,
        priority: framePriority,
        ...(lastTrueRenderTimeMs !== undefined && { lastTrueRenderTimeMs: lastTrueRenderTimeMs }),
        frameStart: frameStart,
        frameEnd,
        frameDurationMs: frameEnd - frameStart,
        taskDurationMs: taskDurationMs,
        networkTaskDurationMs: frameNetworkMs,
        tasks: frameTasks
      };
      this._profileFrames.push(frameRecord);
    }
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
