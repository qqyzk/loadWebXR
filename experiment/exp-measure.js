/**
 * Unified measurement script for all loader variants (experiment harness).
 *
 * Replaces ttff-measurement-main.js / ttff-measurement-baseline.js in the generated
 * experiment pages. All results are written to window.__exp, and window.__exp.done
 * becomes true when the run is complete, so an automation script can read them.
 *
 * TTFF: time from the start-button click to the first rendered frame after all
 * visible priority-1 <a-gltf-model> entities have emitted model-loaded (the
 * definition of the original baseline script). For loaders that start rendering
 * only after P1 is loaded, this equals the first rendered frame.
 *
 * Frame times: the per-frame deltas recorded by a-scene (scene.remTimes, the data
 * used for FTSD/MaxFT in the paper) when the bundle provides them, plus the
 * timestamp of every scene 'render' event.
 *
 * Options (window.__EXP_CONFIG__, written by experiment/gen_pages.py):
 *   fixedView   (default true) disable device-orientation ("magic window") camera
 *               control, so every run starts from the application's initial view.
 *   motion      {type: 'turn-away'|'look-around', degrees, durationMs}: rotate the
 *               camera yaw linearly from the first rendered frame on (R1-1/R1-2).
 *   visibility  [{key, asset, min, max}]: world-space boxes of the model entities
 *               (from experiment/runner/probe.mjs); every frame records which
 *               entities are inside the view frustum and whether they are loaded.
 *   renderLoad  {type: 'const', ms} | {type: 'wave', minMs, maxMs, periodMs}:
 *               busy-wait in every frame to emulate heavy rendering (R2-2).
 *   maxDurationMs  finish the run this long after the click even if loading has not
 *               completed (exp.timedOut = true); used when the render load can
 *               starve the loader.
 */
(function () {
  'use strict';

  var MAX_RENDER_SAMPLES = 20000;
  var CONFIG = window.__EXP_CONFIG__ || {};
  try { performance.setResourceTimingBufferSize(5000); } catch (e) { /* ignore */ }

  var exp = window.__exp = {
    version: 2,
    page: CONFIG,
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    viewport: [window.innerWidth, window.innerHeight],
    startTime: null,
    p1Models: [],
    p1LoadedTime: null,
    ttffEndTime: null,
    ttff: null,
    firstRenderTime: null,
    allAssetsLoadedTime: null,
    modelEvents: [],
    renderTimes: [],
    frames: null,
    resources: null,
    motion: null,
    visibility: null,
    doneTime: null,
    timedOut: false,
    ready: false,
    done: false,
    errors: []
  };

  var sceneEl = null;
  var motionState = null;
  var tracker = null;

  function now () { return performance.now(); }
  function log () {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[EXP]');
    console.log.apply(console, args);
  }

  function rawAttr (el, name) { return Element.prototype.getAttribute.call(el, name); }

  function entityLabel (el) {
    return el.id || rawAttr(el, 'src') || el.tagName.toLowerCase();
  }

  // Model entities in document order, keyed as <asset>#<occurrence>; the same
  // enumeration is used by probe.mjs, so keys match the probe output.
  function modelEntities (scene) {
    var els = scene.querySelectorAll('a-gltf-model, [gltf-model]');
    var counts = {};
    var out = [];
    for (var i = 0; i < els.length; i++) {
      var ref = rawAttr(els[i], 'src') || rawAttr(els[i], 'gltf-model') || '';
      var asset = ref.charAt(0) === '#' ? ref.slice(1) : ref;
      counts[asset] = (counts[asset] || 0) + 1;
      out.push({ el: els[i], asset: asset, key: asset + '#' + counts[asset] });
    }
    return out;
  }

  // ------------------------------------------------------------ driver component
  // Runs inside the render loop: tick (before rendering) applies the scripted
  // camera motion and the artificial render load; tock (after rendering) samples
  // visibility.

  function busyWait (ms) {
    var end = now() + ms;
    while (now() < end) { /* spin */ }
  }

  function renderLoadMs (t) {
    var load = CONFIG.renderLoad;
    if (!load) { return 0; }
    if (load.type === 'const') { return load.ms; }
    if (load.type === 'wave') {
      var phase = (t % load.periodMs) / load.periodMs;
      return load.minMs + (load.maxMs - load.minMs) * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase));
    }
    return 0;
  }

  function applyMotion (t) {
    if (!CONFIG.motion || !sceneEl || !sceneEl.camera) { return; }
    var camEl = sceneEl.camera.el;
    var lc = camEl.components && camEl.components['look-controls'];
    var target = lc && lc.yawObject ? lc.yawObject : camEl.object3D;
    if (!motionState) {
      motionState = { start: t, baseYaw: target.rotation.y };
      exp.motion = { type: CONFIG.motion.type, startTime: t, endTime: t + CONFIG.motion.durationMs };
    }
    var progress = Math.min(1, (t - motionState.start) / CONFIG.motion.durationMs);
    target.rotation.y = motionState.baseYaw + progress * CONFIG.motion.degrees * Math.PI / 180;
  }

  function registerDriver () {
    if (!window.AFRAME || AFRAME.components['exp-driver']) { return; }
    AFRAME.registerComponent('exp-driver', {
      tick: function () {
        var t = now();
        applyMotion(t);
        var ms = renderLoadMs(t);
        if (ms > 0) { busyWait(ms); }
      },
      tock: function () {
        if (tracker) { tracker.sample(now()); }
      }
    });
  }

  // ---------------------------------------------------------- visibility tracker

  function createTracker (scene) {
    var THREE = AFRAME.THREE;
    var byKey = {};
    modelEntities(scene).forEach(function (e) { byKey[e.key] = e.el; });
    var items = CONFIG.visibility.map(function (v) {
      return {
        key: v.key,
        asset: v.asset,
        el: byKey[v.key] || null,
        box: new THREE.Box3(new THREE.Vector3().fromArray(v.min), new THREE.Vector3().fromArray(v.max)),
        firstInView: null,
        firstInViewLoaded: null,
        loadedTime: null,
        missingMs: 0
      };
    });
    var frustum = new THREE.Frustum();
    var m = new THREE.Matrix4();
    var last = null;
    var stats = { frames: 0, incompleteFrames: 0, incompleteMs: 0 };
    return {
      stats: stats,
      sample: function (t) {
        var cam = sceneEl && sceneEl.camera;
        if (!cam || exp.startTime === null) { return; }
        var dt = last === null ? 0 : t - last;
        last = t;
        m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        frustum.setFromProjectionMatrix(m);
        var incomplete = false;
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          var loaded = !!(it.el && it.el.getObject3D && it.el.getObject3D('mesh'));
          if (loaded && it.loadedTime === null) { it.loadedTime = t; }
          if (!frustum.intersectsBox(it.box)) { continue; }
          if (it.firstInView === null) { it.firstInView = t; it.firstInViewLoaded = loaded; }
          if (!loaded) { it.missingMs += dt; incomplete = true; }
        }
        stats.frames += 1;
        if (incomplete) { stats.incompleteFrames += 1; stats.incompleteMs += dt; }
      },
      result: function () {
        return {
          stats: stats,
          entities: items.map(function (it) {
            return {
              key: it.key, asset: it.asset, found: !!it.el, firstInView: it.firstInView,
              firstInViewLoaded: it.firstInViewLoaded, loadedTime: it.loadedTime, missingMs: it.missingMs
            };
          })
        };
      }
    };
  }

  // ------------------------------------------------------------------ main flow

  function onClick () {
    if (exp.startTime !== null) { return; }
    exp.startTime = now();
    log('start at', exp.startTime.toFixed(1));
    // Record every model-loaded event (bubbles from the entity) from the click on.
    document.addEventListener('model-loaded', function (evt) {
      var el = evt.target;
      exp.modelEvents.push({ entity: entityLabel(el), src: rawAttr(el, 'src') || rawAttr(el, 'gltf-model'), time: now() });
    }, true);
    // The scene is injected by the page's own click handler, which runs after this
    // capture-phase listener, so set up on the next task.
    setTimeout(setupScene, 0);
  }

  function fixView (scene) {
    if (CONFIG.fixedView === false) { return; }
    function disable () {
      var camEl = scene.camera && scene.camera.el;
      if (camEl && camEl.components && camEl.components['look-controls']) {
        camEl.setAttribute('look-controls', 'magicWindowTrackingEnabled', false);
      }
    }
    scene.addEventListener('camera-set-active', function () { setTimeout(disable, 0); });
    scene.addEventListener('componentinitialized', function (evt) {
      if (evt.detail && evt.detail.name === 'look-controls') { setTimeout(disable, 0); }
    }, true);
    disable();
  }

  function setupScene () {
    var scene = document.querySelector('a-scene');
    if (!scene) {
      exp.errors.push('a-scene not found after start');
      setTimeout(setupScene, 50);
      return;
    }
    sceneEl = scene;
    fixView(scene);
    if (CONFIG.motion || CONFIG.renderLoad || CONFIG.visibility) {
      registerDriver();
      scene.setAttribute('exp-driver', '');
    }
    if (CONFIG.visibility) { tracker = createTracker(scene); }

    scene.addEventListener('render', function () {
      if (exp.done || exp.renderTimes.length >= MAX_RENDER_SAMPLES) { return; }
      var t = now();
      exp.renderTimes.push(t);
      if (exp.p1LoadedTime !== null && exp.ttffEndTime === null) {
        exp.ttffEndTime = t;
        exp.ttff = t - exp.startTime;
        log('TTFF', exp.ttff.toFixed(1), 'ms');
      }
    });
    scene.addEventListener('all-assets-loaded', function () {
      exp.allAssetsLoadedTime = now();
    });

    // Same selection as the original measurement scripts: visible <a-gltf-model>
    // entities whose asset item has priority="1".
    var models = scene.querySelectorAll('a-gltf-model');
    var pending = [];
    for (var i = 0; i < models.length; i++) {
      var model = models[i];
      if (model.getAttribute('visible') === false) { continue; }
      var src = model.getAttribute('src');
      if (!src) { continue; }
      var item = document.getElementById(String(src).replace('#', ''));
      if (item && String(item.getAttribute('priority')) === '1') { pending.push(model); }
    }
    exp.p1Models = pending.map(entityLabel);
    log('P1 models:', pending.length);

    var remaining = pending.length;
    function p1Done () {
      exp.p1LoadedTime = now();
      log('P1 loaded at', (exp.p1LoadedTime - exp.startTime).toFixed(1), 'ms');
    }
    if (remaining === 0) { p1Done(); }
    pending.forEach(function (model) {
      if (model.getObject3D && model.getObject3D('mesh')) {
        remaining -= 1;
        if (remaining === 0) { p1Done(); }
        return;
      }
      model.addEventListener('model-loaded', function handler () {
        model.removeEventListener('model-loaded', handler);
        remaining -= 1;
        if (remaining === 0) { p1Done(); }
      });
    });

    waitForCompletion(scene);
  }

  // Done when TTFF is known, the frame trace is complete (a-scene saves it one
  // frame after all assets are loaded; bundles without remTimes skip this), and
  // any scripted motion has finished.
  function waitForCompletion (scene) {
    var hasTrace = Array.isArray(scene.remTimes);
    var traceDone = !hasTrace || (scene.allAssetsLoaded && scene.afterLoadedFrame >= 1);
    var motionDone = !CONFIG.motion || (exp.motion && now() >= exp.motion.endTime);
    if (CONFIG.maxDurationMs && now() - exp.startTime > CONFIG.maxDurationMs &&
        !(exp.ttff !== null && traceDone && motionDone)) {
      exp.timedOut = true;
      log('max duration reached');
      finish(scene, hasTrace);
      return;
    }
    if (exp.ttff === null || !traceDone || !motionDone) {
      setTimeout(function () { waitForCompletion(scene); }, 100);
      return;
    }
    finish(scene, hasTrace);
  }

  function finish (scene, hasTrace) {
    exp.frames = hasTrace ? scene.remTimes.slice() : null;
    if (window.aframeMetrics && window.aframeMetrics.firstRenderTime) {
      exp.firstRenderTime = window.aframeMetrics.firstRenderTime;
    }
    if (tracker) { exp.visibility = tracker.result(); }
    exp.resources = performance.getEntriesByType('resource')
      .filter(function (e) { return e.startTime >= exp.startTime; })
      .map(function (e) {
        var name = e.name;
        try { name = new URL(e.name).pathname; } catch (err) { /* keep raw */ }
        return {
          name: name,
          initiatorType: e.initiatorType,
          startTime: e.startTime,
          responseStart: e.responseStart,
          responseEnd: e.responseEnd,
          transferSize: e.transferSize,
          encodedBodySize: e.encodedBodySize
        };
      });
    exp.doneTime = now();
    exp.done = true;
    log('done; ttff =', exp.ttff === null ? 'n/a' : exp.ttff.toFixed(1), 'ms, frames =', exp.frames ? exp.frames.length : 'n/a');
  }

  function init () {
    var button = document.getElementById('ttff-start-button');
    if (!button) {
      exp.errors.push('start button #ttff-start-button not found');
      return;
    }
    button.addEventListener('click', onClick, true);
    exp.ready = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
