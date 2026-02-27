/**
 * sound-priority-only.js
 * For use with a-assets-priority-only: registers a promise that runs the scene task
 * as soon as this asset's network load completes (concurrent scene tasks).
 * Same component name 'sound' so load after components/index.js to override.
 */
import { registerComponent } from '../core/component.js';
import { debug } from '../utils/index.js';
import * as THREE from 'three';

var warn = debug('components:sound:warn');

export var Component = registerComponent('sound', {
  schema: {
    autoplay: { default: false },
    distanceModel: { default: 'inverse', oneOf: ['linear', 'inverse', 'exponential'] },
    loop: { default: false },
    loopStart: { default: 0 },
    loopEnd: { default: 0 },
    maxDistance: { default: 10000 },
    on: { default: '' },
    poolSize: { default: 1 },
    positional: { default: true },
    refDistance: { default: 1 },
    rolloffFactor: { default: 1 },
    src: { type: 'myaudio' },
    volume: { default: 1 }
  },

  multiple: true,

  init: function () {
    var self = this;
    this.listener = null;
    this.audioLoader = new THREE.AudioLoader();
    this.pool = new THREE.Group();
    this.loaded = false;
    this.mustPlay = false;
    this.playSoundBound = function () { self.playSound(); };
  },

  update: function (oldData) {
    var data = this.data;
    var i;
    var sound;
    var srcChanged = data.src !== oldData.src;
    if (srcChanged) {
      if (!data.src) { return; }
      this.setupSound();
    }

    for (i = 0; i < this.pool.children.length; i++) {
      sound = this.pool.children[i];
      if (data.positional) {
        sound.setDistanceModel(data.distanceModel);
        sound.setMaxDistance(data.maxDistance);
        sound.setRefDistance(data.refDistance);
        sound.setRolloffFactor(data.rolloffFactor);
      }
      sound.setLoop(data.loop);
      sound.setLoopStart(data.loopStart);
      if (data.loopStart !== 0 && data.loopEnd === 0) {
        sound.setLoopEnd(sound.buffer.duration);
      } else {
        sound.setLoopEnd(data.loopEnd);
      }
      sound.setVolume(data.volume);
      sound.isPaused = false;
    }

    if (data.on !== oldData.on) {
      this.updateEventListener(oldData.on);
    }

    if (srcChanged) {
      var self = this;
      this.loaded = false;
      var assetEl = document.getElementById(data.src.substring(1));
      var src = assetEl.getAttribute('src');
      var assets = this.el.sceneEl.querySelector('a-assets');
      var priority = 3;
      if (assetEl.hasAttribute('priority')) {
        priority = parseInt(assetEl.getAttribute('priority'));
      }
      assets.addSceneTaskCount({ priority: priority });

      var promise = assetEl.loaded().then(() => assets.runSoundSceneTask({
        type: 'sound',
        src: src,
        el: self.el,
        loader: this.audioLoader,
        theself: self,
        priority: priority
      }));

      assets.registerScenePromise(priority, promise);
    }
  },

  pause: function () {
    this.stopSound();
    this.removeEventListener();
  },

  play: function () {
    if (this.data.autoplay) { this.playSound(); }
    this.updateEventListener();
  },

  remove: function () {
    var i;
    var sound;
    this.removeEventListener();
    if (this.el.getObject3D(this.attrName)) {
      this.el.removeObject3D(this.attrName);
    }
    try {
      for (i = 0; i < this.pool.children.length; i++) {
        sound = this.pool.children[i];
        sound.disconnect();
      }
    } catch (e) {
      warn('Audio source not properly disconnected');
    }
  },

  updateEventListener: function (oldEvt) {
    var el = this.el;
    if (oldEvt) { el.removeEventListener(oldEvt, this.playSoundBound); }
    el.addEventListener(this.data.on, this.playSoundBound);
  },

  removeEventListener: function () {
    this.el.removeEventListener(this.data.on, this.playSoundBound);
  },

  setupSound: function () {
    var el = this.el;
    var i;
    var sceneEl = el.sceneEl;
    var self = this;
    var sound;

    if (this.pool.children.length > 0) {
      this.stopSound();
      el.removeObject3D('sound');
    }

    var listener = this.listener = sceneEl.audioListener || new THREE.AudioListener();
    sceneEl.audioListener = listener;

    if (sceneEl.camera) {
      sceneEl.camera.add(listener);
    }

    sceneEl.addEventListener('camera-set-active', function (evt) {
      evt.detail.cameraEl.getObject3D('camera').add(listener);
    });

    this.pool = new THREE.Group();
    for (i = 0; i < this.data.poolSize; i++) {
      sound = this.data.positional
        ? new THREE.PositionalAudio(listener)
        : new THREE.Audio(listener);
      this.pool.add(sound);
    }
    el.setObject3D(this.attrName, this.pool);

    for (i = 0; i < this.pool.children.length; i++) {
      sound = this.pool.children[i];
      sound.onEnded = function () {
        this.isPlaying = false;
        self.el.emit('sound-ended', self.evtDetail, false);
      };
    }
  },

  pauseSound: function () {
    var i;
    var sound;
    this.isPlaying = false;
    for (i = 0; i < this.pool.children.length; i++) {
      sound = this.pool.children[i];
      if (!sound.source || !sound.source.buffer || !sound.isPlaying || sound.isPaused) {
        continue;
      }
      sound.isPaused = true;
      sound.pause();
    }
  },

  playSound: function (processSound) {
    var found;
    var i;
    var sound;

    if (!this.loaded) {
      warn('Sound not loaded yet. It will be played once it finished loading');
      this.mustPlay = true;
      this.processSound = processSound;
      return;
    }

    found = false;
    this.isPlaying = true;
    for (i = 0; i < this.pool.children.length; i++) {
      sound = this.pool.children[i];
      if (!sound.isPlaying && sound.buffer && !found) {
        if (processSound) { processSound(sound); }
        sound.play();
        sound.isPaused = false;
        found = true;
        continue;
      }
    }

    if (!found) {
      warn('All the sounds are playing. If you need to play more sounds simultaneously ' +
           'consider increasing the size of pool with the `poolSize` attribute.', this.el);
      return;
    }

    this.mustPlay = false;
    this.processSound = undefined;
  },

  stopSound: function () {
    var i;
    var sound;
    this.isPlaying = false;
    for (i = 0; i < this.pool.children.length; i++) {
      sound = this.pool.children[i];
      if (!sound.source || !sound.source.buffer) { return; }
      sound.stop();
    }
  }
});
