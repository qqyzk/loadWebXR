AFRAME.registerComponent('autoplay', {

  schema: {
  },

  init: function () {
    // Wait for assets to load before starting
    this.el.sceneEl.addEventListener('loaded', this.startGame.bind(this));
  },

  startGame: function () {
    // Auto-start the game after assets are loaded
    var bgMusic = document.getElementById('bgMusic');
    if (bgMusic && bgMusic.components.sound) {
      bgMusic.components.sound.playSound();
    }
    clicksEnabled = true;
    console.log('Game initialized, clicksEnabled:', clicksEnabled);
  }

});
