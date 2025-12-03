/**
 * TTFF (Time To First Frame) Measurement Script - Main Branch (Optimized) Version
 * 
 * This script measures the time from clicking the start button until:
 * 1. All priority-1 GLTF models are loaded (model-loaded events)
 * 2. The first frame is actually rendered (first-render event)
 * 
 * Unlike the baseline version, this only waits for priority-1 models to load,
 * allowing the first frame to render faster with the most critical assets.
 * 
 * Usage: Include this script in your HTML before the closing </body> tag
 */

(function() {
  'use strict';

  var TTFFMeasurement = {
    startTime: null,
    firstRenderDone: false,
    firstRenderTime: null,
    allPriority1ModelsLoaded: false,
    priority1ModelsToLoad: [],
    priority1ModelsLoaded: 0,
    
    init: function() {
      console.log('[TTFF-MAIN] Optimized measurement script initialized (priority-1 only)');
      this.attachButtonListener();
    },
    
    attachButtonListener: function() {
      var self = this;
      var button = document.getElementById('ttff-start-button');
      
      if (!button) {
        console.error('[TTFF-MAIN] Start button with id "ttff-start-button" not found');
        return;
      }
      
      button.addEventListener('click', function() {
        // Record start time
        self.startTime = window.performance ? window.performance.now() : Date.now();
        console.log('[TTFF-MAIN] Start button clicked at:', self.startTime.toFixed(2), 'ms');
        
        // Store in global metrics
        if (!window.aframeMetrics) {
          window.aframeMetrics = {};
        }
        window.aframeMetrics.ttffStartTime = self.startTime;
        
        // Wait for scene to be injected, then collect priority-1 models
        setTimeout(function() {
          self.collectPriority1Models();
          self.attachSceneListener();
        }, 100);
      }, true); // Use capture phase to run before other handlers
    },
    
    collectPriority1Models: function() {
      var scene = document.querySelector('a-scene');
      if (!scene) {
        console.error('[TTFF-MAIN] a-scene not found');
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
      
      console.log('[TTFF-MAIN] Found', this.priority1ModelsToLoad.length, 'priority-1 models to wait for');
      
      if (this.priority1ModelsToLoad.length === 0) {
        // No priority-1 models to load, mark as all loaded
        this.allPriority1ModelsLoaded = true;
        this.checkCompletion();
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
          console.log('[TTFF-MAIN] All priority-1 models loaded at:', (allPriority1ModelsTime - self.startTime).toFixed(2), 'ms');
          
          // Store in global metrics
          if (!window.aframeMetrics) {
            window.aframeMetrics = {};
          }
          window.aframeMetrics.allPriority1ModelsLoadedTime = allPriority1ModelsTime;
          
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
        console.error('[TTFF-MAIN] a-scene not found for first-render listener');
        return;
      }
      
      scene.addEventListener('first-render', function onFirstRender(event) {
        self.firstRenderDone = true;
        // Store the actual first render time from the event
        self.firstRenderTime = event.detail.time;
        
        self.checkCompletion();
        
        // Remove listener after it fires
        scene.removeEventListener('first-render', onFirstRender);
      });
    },
    
    checkCompletion: function() {
      if (this.allPriority1ModelsLoaded && this.firstRenderDone) {
        // Use the actual first render time from the event, not current time
        var endTime = this.firstRenderTime;
        var ttff = endTime - this.startTime;
        
        console.log('========================================');
        console.log('[TTFF-MAIN] *** MEASUREMENT COMPLETE ***');
        console.log('[TTFF-MAIN] Time To First Frame (Optimized):', ttff.toFixed(2), 'ms');
        console.log('[TTFF-MAIN] Priority-1 models loaded:', this.priority1ModelsLoaded);
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

