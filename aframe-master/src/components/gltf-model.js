import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { registerComponent } from '../core/component.js';

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

    // Check if this is a chunked model
    if (assets.isChunkedModel && assets.isChunkedModel(src)) {
      // Handle chunked model - 新的分块处理逻辑
      this.handleChunkedModel(src, priority, assets);
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
  },

  // 新增：处理分块模型
  handleChunkedModel: function(src, priority, assets) {
    var self = this;
    const chunkCount = assets.getChunkCount(src);
    
    console.log('🔍 [GLTF-COMPONENT] Chunked model detected:', {
      src: src,
      chunkCount: chunkCount,
      priority: priority
    });
    
    // 为每个分块增加场景任务计数
    for (let i = 1; i <= chunkCount; i++) {
      assets.addSceneTaskCount({ priority: priority });
    }
    
    // 等待每个分块的网络传输完成，然后注册GLTF加载任务
    this.ready.then(() => {
      for (let i = 1; i <= chunkCount; i++) {
        const chunkPromise = assets.getChunkPromise(src, i);
        if (chunkPromise) {
          chunkPromise.then(() => {
            console.log('📦 [GLTF-COMPONENT] Chunk network complete, registering scene task:', i);
            
            // 单个分块网络传输完成，注册GLTF加载任务
            assets.registerSceneTask({
              type: 'chunk-gltf',
              baseSrc: src,
              chunkIndex: i,
              totalChunks: chunkCount,
              el: self.el,
              loader: self.loader,
              theself: self,
              priority: priority
            });
          });
        } else {
          console.error('❌ [GLTF-COMPONENT] No chunk promise found for:', src, 'chunk:', i);
        }
      }
    });
  },


});
