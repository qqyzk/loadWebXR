import json
import os
import subprocess

def get_current_branch():
    """获取当前git分支名"""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
            cwd=os.path.dirname(os.path.abspath(__file__))
        )
        return result.stdout.strip()
    except:
        return "main"  # 默认返回main

def generate_webpage(config_path="config.json", use_baseline=None):
    """
    Generate webpage with TTFF measurement support
    
    Args:
        config_path: Path to the config JSON file
        use_baseline: If True, use baseline TTFF script; if False, use main TTFF script
                     If None, auto-detect from current git branch
    """
    # 自动检测分支
    if use_baseline is None:
        current_branch = get_current_branch()
        use_baseline = (current_branch == "baseline")
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)

    webpage_cfg = config.get("web_page", {})
    models = sorted(webpage_cfg.get("models", []), key=lambda x: x["id"])
    audio = webpage_cfg.get("audio", {})
    output_path = webpage_cfg.get("output_path", "index.html")
    title = webpage_cfg.get("title", "A-Frame Scene")

    output_dir = os.path.dirname(output_path)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    # 生成 a-assets 中的 a-asset-item（每个模型一个asset-item）
    asset_items = ""
    for m in models:
        model_id = f"model_{m['id']}"
        path = m["path"]
        priority = m.get("priority", 1)
        asset_items += f'''      <a-asset-item id="{model_id}" src="{path}" response-type="arraybuffer" priority="{priority}"></a-asset-item>\n'''
    
    # 不添加音频资源（实验场景不需要）
    # if audio.get("path"):
    #     audio_priority = audio.get("priority", 3)
    #     asset_items += f'''      <a-asset-item id="audio" src="{audio["path"]}" response-type="arraybuffer" preload="none" priority="{audio_priority}"></a-asset-item>\n'''

    # 生成 a-gltf-model
    model_html = ""
    for m in models:
        model_id = f"model_{m['id']}"
        pos = m.get("position", [0, 0, -5])
        position = f"{pos[0]} {pos[1]} {pos[2]}"
        scale = "0.3 0.3 0.3"
        
        # 处理visible属性
        visible = m.get("visible", True)
        visible_attr = "" if visible else ' visible="false"'

        model_html += f'''    <a-gltf-model src="#{model_id}" position="{position}" scale="{scale}"{visible_attr}></a-gltf-model>\n'''

    # 不生成音频（实验场景不需要）
    audio_html = ""

    # 选择TTFF测试脚本
    ttff_script = "ttff-measurement-baseline.js" if use_baseline else "ttff-measurement-main.js"

    html_content = f"""<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>{title}</title>
    <script src="../lib/my-aframe.js"></script>
  </head>
  <body>
    <!-- TTFF Start Overlay -->
    <div id="ttff-start-overlay" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
         background: rgba(0, 0, 0, 0.9); z-index: 9999; display: flex; align-items: center; 
         justify-content: center; flex-direction: column; color: white; font-family: Arial, sans-serif;">
      <h1 style="font-size: 48px; margin-bottom: 20px;">{title}</h1>
      <p style="font-size: 20px; margin-bottom: 40px;">Simulation Scene for Performance Testing</p>
      <button id="ttff-start-button" style="font-size: 24px; padding: 20px 60px; background: #ff6600; 
              border: none; color: white; cursor: pointer; border-radius: 10px; font-weight: bold;">
        START EXPERIENCE
      </button>
    </div>

    <!-- Scene template - will be injected after Start button click -->
    <template id="scene-template">
    <a-scene>
      <!-- Camera -->
      <a-camera position="0 1.6 0">
        <a-entity cursor="rayOrigin: mouse"></a-entity>
      </a-camera>

      <!-- Assets -->
      <a-assets timeout="500000">
{asset_items}      </a-assets>

      <!-- Models -->
{model_html}
      <!-- Audio -->
{audio_html}
    </a-scene>
    </template>

    <!-- TTFF Measurement Script -->
    <script src="../{ttff_script}"></script>
    
    <!-- Scene Injection Script -->
    <script>
      document.addEventListener('DOMContentLoaded', function() {{
        var button = document.getElementById('ttff-start-button');
        var overlay = document.getElementById('ttff-start-overlay');
        var template = document.getElementById('scene-template');
        
        button.addEventListener('click', function() {{
          // Inject scene from template
          var sceneContent = template.content.cloneNode(true);
          document.body.appendChild(sceneContent);
          
          // Hide overlay
          overlay.style.display = 'none';
        }}, true);
      }});
    </script>
  </body>
</html>
"""

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    print(f"A-Frame 网页已生成: {output_path} (使用 {'baseline' if use_baseline else 'main'} 脚本)")


if __name__ == "__main__":
    generate_webpage()