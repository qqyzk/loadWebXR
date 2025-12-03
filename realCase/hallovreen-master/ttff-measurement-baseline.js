/**
 * TTFF (Time To First Frame) Measurement Script - Baseline Version
 * 
 * This script measures the time from clicking the start button until:
 * 1. All priority-1 GLTF models are loaded (model-loaded events)
 * 2. These models are rendered at least once (render event after model-loaded)
 * 
 * Note: In baseline, rendering starts early (doesn't wait for models).
 * This script ensures we measure until priority-1 models are both loaded AND rendered.
 * 
 * Usage: Include this script in your HTML before the closing </body> tag
 */

(function() {
  'use strict';

  var TTFFMeasurement = {
    startTime: null,
    firstRenderTime: null,
    renderAfterModelsLoaded: false,
    allPriority1ModelsLoaded: false,
    priority1ModelsToLoad: [],
    priority1ModelsLoaded: 0,
    
    init: function() {
      console.log('[TTFF-BASELINE] Baseline measurement script initialized (priority-1)');
      this.attachButtonListener();
    },
    
    attachButtonListener: function() {
      var self = this;
      var button = document.getElementById('ttff-start-button');
      
      if (!button) {
        console.error('[TTFF-BASELINE] Start button with id "ttff-start-button" not found');
        return;
      }
      
      button.addEventListener('click', function() {
        // Record start time
        self.startTime = window.performance ? window.performance.now() : Date.now();
        console.log('[TTFF-BASELINE] Start button clicked at:', self.startTime.toFixed(2), 'ms');
        
        // Store in global metrics
        if (!window.aframeMetrics) {
          window.aframeMetrics = {};
        }
        window.aframeMetrics.ttffStartTime = self.startTime;
        
        // Wait for scene to be injected, then collect priority-1 models
        setTimeout(function() {
          self.collectPriority1Models();
        }, 100);
      }, true); // Use capture phase to run before other handlers
    },
    
    collectPriority1Models: function() {
      var scene = document.querySelector('a-scene');
      if (!scene) {
        console.error('[TTFF-BASELINE] a-scene not found');
        return;
      }
      
      // Find all <a-gltf-model> elements that are visible and priority-1
      var models = scene.querySelectorAll('a-gltf-model');
      this.priority1ModelsToLoad = [];
      
      for (var i = 0; i < models.length; i++) {
        var model = models[i];
        
        // Check if model is visible (not hidden by visible="false")
        var visible = model.getAttribute('visible');
        if (visible === false) {
          continue;
        }
        
        // Check the priority by looking at the asset item
        var src = model.getAttribute('src');
        if (!src) {
          continue;
        }
        
        // src is a reference to an asset item, e.g., "#target"
        var assetId = src.replace('#', '');
        var assetItem = document.getElementById(assetId);
        
        if (assetItem) {
          var priority = assetItem.getAttribute('priority');
          if (priority === '1' || priority === 1) {
            this.priority1ModelsToLoad.push(model);
          }
        }
      }
      
      console.log('[TTFF-BASELINE] Found', this.priority1ModelsToLoad.length, 'priority-1 models to wait for');
      
      if (this.priority1ModelsToLoad.length === 0) {
        // No priority-1 models to load, wait for next render
        this.allPriority1ModelsLoaded = true;
        this.waitForRenderAfterModelsLoaded();
      } else {
        // Attach listeners to each priority-1 model
        for (var j = 0; j < this.priority1ModelsToLoad.length; j++) {
          this.attachModelListener(this.priority1ModelsToLoad[j], j);
        }
      }
    },
    
    attachModelListener: function(model, index) {
      var self = this;
      var modelId = model.id || model.getAttribute('src') || ('model-' + index);
      
      model.addEventListener('model-loaded', function onModelLoaded(event) {
        self.priority1ModelsLoaded++;
        
        if (self.priority1ModelsLoaded >= self.priority1ModelsToLoad.length) {
          self.allPriority1ModelsLoaded = true;
          var allPriority1ModelsTime = window.performance ? window.performance.now() : Date.now();
          console.log('[TTFF-BASELINE] All priority-1 models loaded at:', (allPriority1ModelsTime - self.startTime).toFixed(2), 'ms');
          
          // Store in global metrics
          if (!window.aframeMetrics) {
            window.aframeMetrics = {};
          }
          window.aframeMetrics.allPriority1ModelsLoadedTime = allPriority1ModelsTime;
          
          // Now wait for these models to be rendered
          self.waitForRenderAfterModelsLoaded();
        }
        
        // Remove listener after it fires
        model.removeEventListener('model-loaded', onModelLoaded);
      });
    },
    
    waitForRenderAfterModelsLoaded: function() {
      var self = this;
      var scene = document.querySelector('a-scene');
      
      if (!scene) {
        console.error('[TTFF-BASELINE] a-scene not found for render listener');
        return;
      }
      
      console.log('[TTFF-BASELINE] Priority-1 models loaded, waiting for next render...');
      
      // Listen for the next render event to ensure loaded models have been rendered
      scene.addEventListener('render', function onRender(event) {
        self.renderAfterModelsLoaded = true;
        self.firstRenderTime = event.detail.time;
        console.log('[TTFF-BASELINE] Render after models loaded at:', (self.firstRenderTime - self.startTime).toFixed(2), 'ms');
        
        // Remove listener after first render
        scene.removeEventListener('render', onRender);
        
        self.checkCompletion();
      });
    },
    
    checkCompletion: function() {
      if (this.allPriority1ModelsLoaded && this.renderAfterModelsLoaded) {
        // Use the actual render time, not current time
        var endTime = this.firstRenderTime;
        var ttff = endTime - this.startTime;
        
        console.log('========================================');
        console.log('[TTFF-BASELINE] *** MEASUREMENT COMPLETE ***');
        console.log('[TTFF-BASELINE] Time To First Frame (Baseline):', ttff.toFixed(2), 'ms');
        console.log('[TTFF-BASELINE] Priority-1 models loaded:', this.priority1ModelsLoaded);
        console.log('========================================');
        
        // Store final result in global metrics
        if (!window.aframeMetrics) {
          window.aframeMetrics = {};
        }
        window.aframeMetrics.ttff = ttff;
        window.aframeMetrics.ttffEndTime = endTime;
        window.aframeMetrics.priority1ModelsLoaded = this.priority1ModelsLoaded;
        
        // Emit custom event for external listeners
        if (typeof CustomEvent !== 'undefined') {
          var event = new CustomEvent('ttff-complete', {
            detail: {
              ttff: ttff,
              priority1ModelsLoaded: this.priority1ModelsLoaded,
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
