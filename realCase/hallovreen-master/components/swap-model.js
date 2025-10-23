AFRAME.registerComponent('swap-model', {

  schema: {
    light: {
      type: 'selector'
    },
    from: {
      type: 'selector'
    },
    to: {
      type: 'selector'
    },
    sound: {
      type: 'string'
    }
  },

  init: function () {

    this.soundId = null;
    this.animating = false;

    // Sound mapping for a-sound elements
    this.soundMap = {
      'bat': 'batSound',
      'feet': 'feetSound', 
      'hand': 'handSound',
      'pumpkin_laugh': 'pumpkinLaughSound',
      'skeleton': 'skeletonSound',
      'vampire': 'vampireSound',
      'werewolf': 'werewolfSound',
      'witch_laugh': 'witchLaughSound',
      'zombi': 'zombiSound'
    };

    this.el.addEventListener('click', this.swapModel.bind(this));
    this.data.to.addEventListener('animation-finished', this.animationEnd.bind(this));

  },

  swapModel: function () {

    if (!clicksEnabled) return;

    this.data.from.setAttribute("visible", "false");
    this.data.to.setAttribute("position", "0 0 0");
    this.data.to.setAttribute("visible", true);
    this.data.to.setAttribute("animation-mixer", "repetitions: 1;");
    
    // Play sound using a-sound
    if (this.data.sound != null && !this.animating) {
      var soundId = this.soundMap[this.data.sound];
      if (soundId) {
        var soundElement = document.getElementById(soundId);
        if (soundElement && soundElement.components && soundElement.components.sound) {
          soundElement.components.sound.playSound();
        }
      }
      document.getElementById('score').emit('found', {sound: this.data.sound});
    }
    
    this.animating = true;
    
  },

  animationEnd: function () {

    this.animating = false;
    this.data.to.removeAttribute("animation-mixer");
    this.data.to.setAttribute("visible", false);
    this.data.from.setAttribute("visible", true);
  }

});
