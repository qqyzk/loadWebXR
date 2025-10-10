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

    model_html = ""
    for m in models:
        pos = m.get("position", [0, 0, -5])
        position = f"{pos[0]} {pos[1]} {pos[2]}"
        scale = "0.3 0.3 0.3"

        priority = m.get("priority", 3)

        start = int(m["start_time"] * 1000) 
        model_html += f'''
    <a-entity gltf-model="url({m["path"]})"
              position="{position}" scale="{scale}" visible="false"
              data-priority="{priority}"
              animation="property: visible; to: true; delay: {start}; dur: 1">
    </a-entity>
        '''

    audio_html = ""
    if audio.get("path"):
        audio_html = f'''\n    <a-entity sound="src: url({audio["path"]}); autoplay: true; loop: true"></a-entity>\n    '''

    html_content = f"""<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>{title}</title>
    <script src="https://aframe.io/releases/1.5.0/aframe.min.js"></script>
  </head>
  <body>
    <a-scene>
{model_html}{audio_html}
    </a-scene>
  </body>
</html>
"""

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    print(f"A-Frame 网页已生成: {output_path}")


if __name__ == "__main__":
    generate_webpage()