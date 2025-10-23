
AFRAME.registerComponent('animation-control', {
  schema: {
    target: {
      type: 'selector'
    },
    sound: {
      type: 'string'
    },
    clip: {
      type: 'string'
    },
    repetitions: {
      type: 'number',
      default: 0
    },
    crossFadeDuration: {
      type: 'number',
      default: 0.5
    },
    lightOn: {
      type: 'selector'
    }
  },

  init: function () {

    this.soundId = null;
    this.animating = false;
    this.oldAnimationData = this.data.target.getAttribute("animation-mixer");

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

    this.el.addEventListener('click', this.playAnimation.bind(this));

    this.data.target.addEventListener('animation-finished', this.endAnimation.bind(this));

  },

  playAnimation: function (){

    if (!clicksEnabled) return;

    currentData = this.data.target.getAttribute("animation-mixer");

    if (currentData.clip != "idle") {
      return;

    } else {
      this.data.target.removeAttribute("animation-mixer");
      this.data.target.setAttribute("animation-mixer", this.data);
      
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
    }
  },

  endAnimation: function () {

    this.animating = false;
    this.data.target.removeAttribute("animation-mixer");
    this.data.target.setAttribute("animation-mixer", this.oldAnimationData);
  }

});