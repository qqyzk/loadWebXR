import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { registerComponent } from '../core/component.js';
import * as utils from '../utils/index.js';
var warn = utils.debug('components:gltf-model:warn');

/**
 * glTF model loader.
 */
export var Component = registerComponent('gltf-model', {
  schema: {type: 'mymodel'},

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
      console.log('debug: gltf-model meshoptDecoder',meshoptDecoder);
      this.ready = meshoptDecoder.then(function (meshoptDecoder) {
        self.loader.setMeshoptDecoder(meshoptDecoder);
      });
    } else {
      console.log('debug: gltf-model meshoptDecoder else',meshoptDecoder);
      this.ready = Promise.resolve();
    }
    if (ktxLoader) {
      this.loader.setKTX2Loader(ktxLoader);
    }
  },

  update: function () {
    var self = this;
    var el = this.el;
    var data = this.data;
    // console.log('debug: gltf-model src', src);
    if (!data) { return; }
    var assetEl = document.getElementById(data.substring(1));
    var src = assetEl.getAttribute('src');
    this.remove();
    // console.log('debug: gltf-model el',assetEl,assetEl.isAssetItem);
    // assetEl.load().then(function(){
    
    // });
    // this.ready.then(function () {
    //   self.loader.load(src, function gltfLoaded (gltfModel) {
    //     self.model = gltfModel.scene || gltfModel.scenes[0];
    //     self.model.animations = gltfModel.animations;

    //     el.setObject3D('mesh', self.model);
    //     el.emit('model-loaded', {format: 'gltf', model: self.model});
    //   }, undefined /* onProgress */, function gltfFailed (error) {
    //     var message = (error && error.message) ? error.message : 'Failed to load glTF model';
    //     warn(message);
    //     el.emit('model-error', {format: 'gltf', src: src});
    //   });
    // });
    console.log('debug: assetEl.load',assetEl.load);
    assetEl.load()
        .then(() => this.ready)
        .then(() => {
          console.log('debug: assetEl load success',src);
          self.loader.load(src, function gltfLoaded (gltfModel) {
                console.log('debug: gltf-model loaded',src);
                self.model = gltfModel.scene || gltfModel.scenes[0];
                self.model.animations = gltfModel.animations;
        
                el.setObject3D('mesh', self.model);
                el.emit('model-loaded', {format: 'gltf', model: self.model});
              }, undefined /* onProgress */, function gltfFailed (error) {
                var message = (error && error.message) ? error.message : 'Failed to load glTF model';
                warn(message);
                el.emit('model-error', {format: 'gltf', src: src});
              });
        });
        
   
  },

  remove: function () {
    if (!this.model) { return; }
    this.el.removeObject3D('mesh');
  }
});
