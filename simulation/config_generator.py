import argparse 
import json
import os
import random
import math


def generate_config(config_id: int, model_count=None, priority_distribution=None):
    """
    Generate configuration with support for priority distribution
    
    Args:
        config_id: Configuration ID
        model_count: Total number of models (16, 32, 64, 128, 256), if None will use random 4-8
        priority_distribution: Tuple of (P1%, P2%, P3%), e.g., (0.7, 0.2, 0.1) or None for random
    """
    # Step 1: 确定模型数量
    if model_count is None:
        model_count = random.randint(4, 8)  # 默认随机 4-8 个模型
    
    # Step 2: 确定优先级分布
    if priority_distribution is None:
        # 随机分布 (老行为，50%概率可见即priority=1)
        use_priority_distribution = False
    else:
        use_priority_distribution = True
        p1_ratio, p2_ratio, p3_ratio = priority_distribution
        # 确保比例和为1
        total = p1_ratio + p2_ratio + p3_ratio
        if not math.isclose(total, 1.0, rel_tol=1e-5):
            raise ValueError(f"Priority distribution must sum to 1.0, got {total}")
    
    # Step 3: 生成faces_list（固定5000 faces）
    # 所有模型使用相同的复杂度，但通过编号区分
    faces_list = [5000] * model_count
    
    clip_length = random.randint(1, 10)

    # Step 4: 模型生成部分 (固定 output_dir)
    model_generation = {
        "output_dir": "htmls/models/",
        "faces_list": faces_list
    }

    # Step 5: 音频处理部分 (固定 input/output_audio)
    audio_processing = {
        "input_audio": "htmls/audios/test.wav",
        "clip_length": clip_length,
        "output_audio": "htmls/audios/audio_clip.wav"
    }

    # Step 6: 分配优先级
    if use_priority_distribution:
        # 根据比例分配优先级
        priorities = []
        p1_count = int(model_count * p1_ratio)
        p2_count = int(model_count * p2_ratio)
        p3_count = model_count - p1_count - p2_count  # 确保总数正确
        
        priorities.extend([1] * p1_count)
        priorities.extend([2] * p2_count)
        priorities.extend([3] * p3_count)
        
        # 打乱优先级顺序
        random.shuffle(priorities)
    else:
        # 随机分配 (50%概率priority=1, 50%概率priority=3)
        priorities = [1 if random.random() < 0.5 else 3 for _ in range(model_count)]

    # Step 7: 网页生成部分 (output_path/title 带 id)
    webpage_output_dir = "htmls"
    models = []

    for idx, (faces, priority) in enumerate(zip(faces_list, priorities), start=1):
        # 使用编号命名：model_1.glb, model_2.glb, ...
        model_filename = f"model_{idx}.glb"
        model_full_path = os.path.join("htmls/models/", model_filename)
        model_relative_path = os.path.join(
            os.path.relpath("htmls/models/", webpage_output_dir),
            model_filename
        ).replace("\\", "/")

        # 随机生成位置 (完全对称的空间分布)
        x = random.uniform(-8, 8)
        y = random.uniform(-8, 8)
        z = random.uniform(-8, 8)
        
        # 所有模型都可见 (通过priority控制加载顺序)
        visible = True

        models.append({
            "id": idx,
            "path": model_relative_path,
            "full_path": model_full_path,
            "position": [round(x, 2), round(y, 2), round(z, 2)],
            "visible": visible,
            "priority": priority,
            "faces": faces  # 保留faces信息用于生成模型
        })

    audio_relative_path = os.path.relpath("htmls/audios/audio_clip.wav", webpage_output_dir).replace("\\", "/")
    
    # 音频不自动播放
    audio_autoplay = False

    web_page = {
        "title": f"A-Frame Scene {config_id}",
        "output_path": f"htmls/index_{config_id}.html",
        "model_count": model_count,
        "models": models,
        "audio": {
            "path": audio_relative_path,
            "length": clip_length,
            "autoplay": audio_autoplay,
            "priority": 3
        }
    }
    
    # 添加实验元数据
    if use_priority_distribution:
        web_page["experiment_config"] = {
            "priority_distribution": {
                "P1": p1_ratio,
                "P2": p2_ratio,
                "P3": p3_ratio
            },
            "priority_counts": {
                "P1": priorities.count(1),
                "P2": priorities.count(2),
                "P3": priorities.count(3)
            }
        }

    config = {
        "model_generation": model_generation,
        "audio_processing": audio_processing,
        "web_page": web_page
    }

    return config


def main():
    parser = argparse.ArgumentParser(description="Generate config.json for webpage generation with priority distribution support")
    parser.add_argument("--num", type=int, default=1, help="生成多少份配置文件")
    parser.add_argument("--model_count", type=int, default=None, 
                        help="模型总数 (16, 32, 64, 128, 256)，不指定则随机4-8个")
    parser.add_argument("--priority", type=str, default=None,
                        help="优先级分布 (格式: P1,P2,P3)，例如 '0.7,0.2,0.1'，不指定则随机分配")
    args = parser.parse_args()

    # 解析优先级分布
    priority_distribution = None
    if args.priority:
        parts = args.priority.split(',')
        if len(parts) != 3:
            print("[ERROR] Priority distribution must have 3 values: P1,P2,P3")
            return
        try:
            priority_distribution = tuple(float(p) for p in parts)
        except ValueError:
            print("[ERROR] Invalid priority distribution format")
            return

    for i in range(1, args.num + 1):
        config = generate_config(i, model_count=args.model_count, priority_distribution=priority_distribution)
        config_path = f"configs/config_{i}.json"
        os.makedirs(os.path.dirname(config_path) or ".", exist_ok=True)
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        
        # 打印配置信息
        if priority_distribution:
            exp_cfg = config["web_page"].get("experiment_config", {})
            print(f"[OK] 配置文件已生成: {config_path}")
            print(f"     模型数: {args.model_count}, 优先级: P1={exp_cfg['priority_counts']['P1']}, P2={exp_cfg['priority_counts']['P2']}, P3={exp_cfg['priority_counts']['P3']}")
        else:
            print(f"[OK] 配置文件已生成: {config_path}")


if __name__ == "__main__":
    main()