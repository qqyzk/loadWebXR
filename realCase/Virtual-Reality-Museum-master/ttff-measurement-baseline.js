/**
 * TTFF (Time To First Frame) Measurement Script - Baseline Version
 * 
 * This script measures the time from clicking the start button until:
 * 1. All visible GLTF models are loaded (model-loaded events)
 * 2. The first frame is actually rendered (first-render event)
 * 
 * Usage: Include this script in your HTML before the closing </body> tag
 */

(function() {
  'use strict';

  var TTFFMeasurement = {
    startTime: null,
    firstRenderDone: false,
    allModelsLoaded: false,
    modelsToLoad: [],
    modelsLoaded: 0,
    
    init: function() {
      console.log('[TTFF] Baseline measurement script initialized');
      this.attachButtonListener();
    },
    
    attachButtonListener: function() {
      var self = this;
      var button = document.getElementById('ttff-start-button');
      
      if (!button) {
        console.error('[TTFF] Start button with id "ttff-start-button" not found');
        return;
      }
      
      // Store original onclick handler
      var originalOnClick = button.onclick;
      
      button.addEventListener('click', function() {
        // Record start time
        self.startTime = window.performance ? window.performance.now() : Date.now();
        console.log('[TTFF] Start button clicked at:', self.startTime.toFixed(2), 'ms');
        
        // Store in global metrics
        if (!window.aframeMetrics) {
          window.aframeMetrics = {};
        }
        window.aframeMetrics.ttffStartTime = self.startTime;
        
        // Wait for scene to be injected, then collect models
        setTimeout(function() {
          self.collectModels();
          self.attachSceneListener();
        }, 100);
      }, true); // Use capture phase to run before other handlers
    },
    
    collectModels: function() {
      var scene = document.querySelector('a-scene');
      if (!scene) {
        console.error('[TTFF] a-scene not found');
        return;
      }
      
      // Find all <a-gltf-model> elements that are visible
      var models = scene.querySelectorAll('a-gltf-model');
      this.modelsToLoad = [];
      
      for (var i = 0; i < models.length; i++) {
        var model = models[i];
        // Check if model is visible (not hidden by visible="false")
        // Note: getAttribute('visible') returns a boolean, not a string
        var visible = model.getAttribute('visible');
        if (visible !== false) {
          this.modelsToLoad.push(model);
        }
      }
      
      console.log('[TTFF] Found', this.modelsToLoad.length, 'visible models to wait for');
      
      if (this.modelsToLoad.length === 0) {
        // No models to load, mark as all loaded
        this.allModelsLoaded = true;
        this.checkCompletion();
      } else {
        // Attach listeners to each model
        for (var j = 0; j < this.modelsToLoad.length; j++) {
          this.attachModelListener(this.modelsToLoad[j], j);
        }
      }
    },
    
    attachModelListener: function(model, index) {
      var self = this;
      var modelId = model.id || model.getAttribute('src') || ('model-' + index);
      
      model.addEventListener('model-loaded', function onModelLoaded(event) {
        self.modelsLoaded++;
        
        if (self.modelsLoaded >= self.modelsToLoad.length) {
          self.allModelsLoaded = true;
          var allModelsTime = window.performance ? window.performance.now() : Date.now();
          console.log('[TTFF] All models loaded at:', (allModelsTime - self.startTime).toFixed(2), 'ms');
          
          // Store in global metrics
          if (!window.aframeMetrics) {
            window.aframeMetrics = {};
          }
          window.aframeMetrics.allModelsLoadedTime = allModelsTime;
          
          self.checkCompletion();
        }
        
        // Remove listener after it fires
        model.removeEventListener('model-loaded', onModelLoaded);
      });
    },
    
    attachSceneListener: function() {
      var self = this;
      var scene = document.querySelector('a-scene');
      
      if (!scene) {
        console.error('[TTFF] a-scene not found for first-render listener');
        return;
      }
      
      scene.addEventListener('first-render', function onFirstRender(event) {
        self.firstRenderDone = true;
        var firstRenderTime = event.detail.time;
        
        self.checkCompletion();
        
        // Remove listener after it fires
        scene.removeEventListener('first-render', onFirstRender);
      });
    },
    
    checkCompletion: function() {
      if (this.allModelsLoaded && this.firstRenderDone) {
        var endTime = window.performance ? window.performance.now() : Date.now();
        var ttff = endTime - this.startTime;
        
        console.log('========================================');
        console.log('[TTFF] *** MEASUREMENT COMPLETE ***');
        console.log('[TTFF] Time To First Frame (Baseline):', ttff.toFixed(2), 'ms');
        console.log('========================================');
        
        // Store final result in global metrics
        if (!window.aframeMetrics) {
          window.aframeMetrics = {};
        }
        window.aframeMetrics.ttff = ttff;
        window.aframeMetrics.ttffEndTime = endTime;
        window.aframeMetrics.totalModelsLoaded = this.modelsLoaded;
        
        // Emit custom event for external listeners
        if (typeof CustomEvent !== 'undefined') {
          var event = new CustomEvent('ttff-complete', {
            detail: {
              ttff: ttff,
              modelsLoaded: this.modelsLoaded,
              startTime: this.startTime,
              endTime: endTime
            }
          });
          document.dispatchEvent(event);
        }
      }
    }
  };
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      TTFFMeasurement.init();
    });
  } else {
    TTFFMeasurement.init();
  }
  
  // Expose to window for debugging
  window.TTFFMeasurement = TTFFMeasurement;
  
})();

