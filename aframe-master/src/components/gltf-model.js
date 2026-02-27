/**
 * gltf-model-priority-only.js
 * For use with a-assets-priority-only: registers a promise that runs the scene task
 * as soon as this asset's network load completes (concurrent scene tasks).
 * No chunking; same component name 'gltf-model' so load after components/index.js to override.
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { registerComponent } from '../core/component.js';

export var Component = registerComponent('gltf-model', {
  schema: { type: 'mymodel' },

  init: function () {
    var self = this;
    var dracoLoader = this.system.getDRACOLoader();
    var meshoptDecoder = this.system.getMeshoptDecoder();
    var ktxLoader = this.system.getKTX2Loader();
    this.model = null;
    this.loader = new GLTFLoader();
    if (dracoLoader) {
      this.loader.setDRACOLoader(dracoLoader);
    }
    if (meshoptDecoder) {
      this.ready = meshoptDecoder.then(function (meshoptDecoder) {
        self.loader.setMeshoptDecoder(meshoptDecoder);
      });
    } else {
      this.ready = Promise.resolve();
    }
    if (ktxLoader) {
      this.loader.setKTX2Loader(ktxLoader);
    }
  },

  update: function () {
    var self = this;
    var data = this.data;
    if (!data) { return; }
    var assetEl = document.getElementById(data.substring(1));
    var src = assetEl.getAttribute('src');
    this.remove();
    var assets = this.el.sceneEl.querySelector('a-assets');
    var priority = 3;
    if (assetEl.hasAttribute('priority')) {
      priority = parseInt(assetEl.getAttribute('priority'));
    }

    assets.addSceneTaskCount({ priority: priority });

    var promise = assetEl.loaded()
      .then(() => this.ready)
      .then(() => assets.runGLTFSceneTask({
        type: 'gltf-model',
        src: src,
        el: self.el,
        loader: self.loader,
        theself: self,
        priority: priority
      }));

    assets.registerScenePromise(priority, promise);
  },

  remove: function () {
    if (!this.model) { return; }
    this.el.removeObject3D('mesh');
  }
});
