import argparse 
import json
import os
import random


def generate_config(config_id: int):
    # Step 1: 随机参数
    clip_length = random.randint(1, 10)
    model_count = random.randint(4, 8)  # 至少 4 个模型
    faces_list = [random.choice([500, 1000, 2000, 3000, 4000, 5000]) for _ in range(model_count)]

    # Step 2: 模型生成部分 (固定 output_dir)
    model_generation = {
        "output_dir": "htmls/models/",
        "faces_list": faces_list
    }

    # Step 3: 音频处理部分 (固定 input/output_audio)
    audio_processing = {
        "input_audio": "htmls/audios/test.wav",
        "clip_length": clip_length,
        "output_audio": "htmls/audios/audio_clip.wav"
    }

    # Step 4: 网页生成部分 (output_path/title 带 id)
    interval = clip_length / model_count
    webpage_output_dir = "htmls"

    models = []

    for idx, faces in enumerate(faces_list, start=1):
        model_filename = f"model_{faces}.glb"
        model_full_path = os.path.join("htmls/models/", model_filename)
        model_relative_path = os.path.join(
            os.path.relpath("htmls/models/", webpage_output_dir),
            model_filename
        ).replace("\\", "/")

        # 随机生成位置 (完全对称的空间分布)
        x = random.uniform(-8, 8)
        y = random.uniform(-8, 8)
        z = random.uniform(-8, 8)
        
        # 50%概率可见
        visible = random.random() < 0.5

        models.append({
            "id": idx,
            "path": model_relative_path,
            "full_path": model_full_path,
            "position": [round(x, 2), round(y, 2), round(z, 2)],
            "visible": visible
        })

    audio_relative_path = os.path.relpath("htmls/audios/audio_clip.wav", webpage_output_dir).replace("\\", "/")
    
    # 20%概率自动播放
    audio_autoplay = random.random() < 0.2

    web_page = {
        "title": f"A-Frame Scene {config_id}",
        "output_path": f"htmls/index_{config_id}.html",
        "model_count": model_count,
        "models": models,
        "audio": {
            "path": audio_relative_path,
            "length": clip_length,
            "autoplay": audio_autoplay
        }
    }

    config = {
        "model_generation": model_generation,
        "audio_processing": audio_processing,
        "web_page": web_page
    }

    return config


def main():
    parser = argparse.ArgumentParser(description="Randomly generate config.json for webpage generation")
    parser.add_argument("--num", type=int, default=1, help="生成多少份配置文件")
    args = parser.parse_args()

    for i in range(1, args.num + 1):
        config = generate_config(i)
        config_path = f"configs/config_{i}.json"
        os.makedirs(os.path.dirname(config_path) or ".", exist_ok=True)
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        print(f"[OK] 配置文件已生成: {config_path}")


if __name__ == "__main__":
    main()