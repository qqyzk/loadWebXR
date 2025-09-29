// js/custom/progressive-gltf.js
console.log('[progressive-gltf] script loaded');

AFRAME.registerComponent('progressive-gltf', {
  schema: { src: { type: 'string' } },

  init: function () {
    console.log('[progressive-gltf] init, src=', this.data.src);
    const el = this.el;
    const src = this.data.src;

    if (!src) {
      console.warn('[progressive-gltf] no src provided');
      return;
    }

    // 检测 loader（优先使用 window.ProgressiveGLTFLoader）
    function detectLoader() {
      if (window.ProgressiveGLTFLoader) return window.ProgressiveGLTFLoader;
      if (window.ProgressiveGLTF) return window.ProgressiveGLTF;
      // 还可以是直接暴露的对象（已在 attach 脚本里处理）
      for (const name of Object.keys(window)) {
        try {
          const v = window[name];
          if (!v) continue;
          if (typeof v === 'function' && /gltf|progressive|stream/i.test(name)) return v;
          if (typeof v === 'object' && typeof v.load === 'function' && /gltf|progressive|stream/i.test(name)) return v;
        } catch (e) {}
      }
      // 最后的回退：使用 THREE.GLTFLoader（非 streaming，但能保证显示）
      if (window.THREE && window.THREE.GLTFLoader) return window.THREE.GLTFLoader;
      return null;
    }

    const Loader = detectLoader();
    if (!Loader) {
      console.error('[progressive-gltf] no suitable loader detected (progressive or THREE.GLTFLoader)');
      return;
    }

    try {
      let loaderInstance;
      if (typeof Loader === 'function') {
        // 有可能 Loader 是构造函数或类，也可能直接是已实例化对象
        // 如果是 THREE.GLTFLoader（有时在 THREE 命名空间内），new 一下
        try {
          loaderInstance = new Loader();
        } catch (e) {
          // 如果 new 失败（Loader 已经是个对象），直接使用它
          loaderInstance = Loader;
        }
      } else {
        loaderInstance = Loader;
      }

      if (typeof loaderInstance.load !== 'function') {
        console.error('[progressive-gltf] loader found but has no load method', loaderInstance);
        return;
      }

      // 开始加载
      loaderInstance.load(
        src,
        function (gltf) {
          // 支持不同 loader 返回形式
          const scene = (gltf && (gltf.scene || (gltf.scenes && gltf.scenes[0]))) || gltf;
          if (!scene) {
            console.error('[progressive-gltf] loaded gltf has no scene:', gltf);
            return;
          }
          el.setObject3D('mesh', scene);
          el.emit('model-loaded', { format: 'progressive-gltf', src });
          console.log('[progressive-gltf] model-loaded', src);
        },
        function (progressEvent) {
          // progressEvent 可能是 {loaded, total} 或 XHRProgressEvent
          el.emit('model-progress', progressEvent);
        },
        function (err) {
          console.error('[progressive-gltf] load error', err);
          el.emit('model-error', { error: err });
        }
      );
    } catch (e) {
      console.error('[progressive-gltf] loader instantiation/load failed', e);
    }
  },

  remove: function () {
    const obj = this.el.getObject3D('mesh');
    if (obj) this.el.removeObject3D('mesh');
  }
});