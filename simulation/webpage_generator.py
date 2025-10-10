import json
import os

def generate_webpage(config_path="config.json"):
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

    # 生成 a-assets 中的 a-asset-item
    asset_items = ""
    for m in models:
        model_id = f"model_{m['id']}"
        asset_items += f'''      <a-asset-item id="{model_id}" src="{m["path"]}" response-type="arraybuffer"></a-asset-item>\n'''
    
    # 添加音频资源
    if audio.get("path"):
        asset_items += f'''      <a-asset-item id="audio" src="{audio["path"]}" response-type="arraybuffer" preload="none"></a-asset-item>\n'''

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

    # 生成 a-sound
    audio_html = ""
    if audio.get("path"):
        autoplay = "true" if audio.get("autoplay", False) else "false"
        audio_html = f'''    <a-sound src="#audio" autoplay="{autoplay}"></a-sound>\n'''

    html_content = f"""<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>{title}</title>
    <script src="../lib/my-aframe.js"></script>
  </head>
  <body>
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
  </body>
</html>
"""

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    print(f"A-Frame 网页已生成: {output_path}")


if __name__ == "__main__":
    generate_webpage()