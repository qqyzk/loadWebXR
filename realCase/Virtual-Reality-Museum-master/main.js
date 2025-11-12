var startExperienteBtn = document.getElementById('ttff-start-button');

startExperienteBtn.onclick = function(){
    // Remove the start overlay
    document.getElementById('container').outerHTML = '';
    
    // Inject the a-scene from template
    var template = document.getElementById('scene-template');
    var sceneContent = template.content.cloneNode(true);
    document.getElementById('scene-container').appendChild(sceneContent);
};