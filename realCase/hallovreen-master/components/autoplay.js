AFRAME.registerComponent('autoplay', {

  schema: {
  },

  init: function () {
    // Auto-start the game immediately
    this.soundId = bgAudio.play();
    clicksEnabled = true;
  }

});

// Auto-initialize the game when the scene loads
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() {
    if (typeof bgAudio !== 'undefined') {
      bgAudio.play();
    }
    clicksEnabled = true;
    console.log('Game initialized, clicksEnabled:', clicksEnabled);
  }, 1000);
});
