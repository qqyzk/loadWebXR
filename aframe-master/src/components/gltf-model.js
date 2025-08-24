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
    var el = this.el;
    var data = this.data;
    if (!data) { return; }
    var assetEl = document.getElementById(data.substring(1));
    var src = assetEl.getAttribute('src');
    this.remove();
    var assets = this.el.sceneEl.querySelector('a-assets');
    var priority = 3;
    if (assetEl.hasAttribute('priority')){
      priority = parseInt(assetEl.getAttribute('priority'));
    }
    
    // Check if this is a chunked model
    if (assets.isChunkedModel && assets.isChunkedModel(src)) {
      // Handle chunked model
      const chunkCount = assets.getChunkCount(src);
      console.log('🔍 [GLTF-COMPONENT] Chunked model detected:', {
        src: src,
        chunkCount: chunkCount,
        priority: priority
      });
      
      // Add scene task count for chunks
      assets.addSceneTaskCount({
        priority: priority
      });
      
      // For chunked models, we need to load all chunks and combine them
      this.ready.then(() => {
        const chunkPromises = [];
        
        // Download all chunks first
        for (let i = 1; i <= chunkCount; i++) {
          const chunkSrc = assets.getChunkSrc(src, i);
          console.log('📦 [GLTF-COMPONENT] Downloading chunk:', {
            chunkIndex: i,
            chunkSrc: chunkSrc
          });
          
          chunkPromises.push(assets.downloadChunk(chunkSrc));
        }
        
        // Wait for all chunks to download, then load them as one combined model
        Promise.all(chunkPromises).then(() => {
          console.log('🎯 [GLTF-COMPONENT] All chunks downloaded, registering combined scene task');
          
          // Register a single scene task for the combined chunked model
          assets.registerSceneTask({
            type: 'gltf-model',
            src: src, // Use original src for the combined model
            el: self.el,
            loader: self.loader,
            theself: self,
            priority: priority,
            isChunked: true,
            baseSrc: src
          });
        }).catch((error) => {
          console.error('❌ [GLTF-COMPONENT] Failed to download chunks:', error);
        });
      });
    } else {
      // Handle non-chunked model (original logic)
      assets.addSceneTaskCount({
        priority: priority
      });
      
      assetEl.loaded()
        .then(() => this.ready)
        .then(() => {
          assets.registerSceneTask({
            type: 'gltf-model',
            src: src,
            el: self.el,
            loader: self.loader,
            theself: self,
            priority: priority
          });
        });
    }
  },

  remove: function () {
    if (!this.model) { return; }
    this.el.removeObject3D('mesh');
  }
});
