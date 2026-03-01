#!/usr/bin/env python3
"""
生成实验配置脚本
生成 4种优先级分布 × 6种资源总数 = 24种配置组合，可按面数输出到 experiment_configs/{faces}/

优先级分布：
1. (70%, 20%, 10%) - P1主导
2. (50%, 30%, 20%) - 均衡偏P1
3. (20%, 30%, 50%) - 均衡偏P3
4. (10%, 20%, 70%) - P3主导

资源总数：8, 16, 32, 64, 128, 256
面数：5000, 10000, 20000, 40000, 80000（输出到 experiment_configs/{faces}/，路径指向 htmls/{faces}/）
"""

import os
import json
import argparse
from config_generator import generate_config

# 定义实验参数
PRIORITY_DISTRIBUTIONS = {
    "70_20_10": (0.70, 0.20, 0.10),  # P1主导
    "50_30_20": (0.50, 0.30, 0.20),  # 均衡偏P1
    "20_30_50": (0.20, 0.30, 0.50),  # 均衡偏P3
    "10_20_70": (0.10, 0.20, 0.70),  # P3主导
}

MODEL_COUNTS = [8, 16, 32, 64, 128, 256]

# 支持的面数（experiment_configs/{faces}/、htmls/{faces}/）
DEFAULT_FACES_LIST = [10000, 20000, 40000, 80000]


def generate_all_configs_for_faces(output_base_dir="experiment_configs", faces_list=None, use_baseline=False):
    """
    为每种面数生成 24 个实验配置，写入 experiment_configs/{faces}/
    
    Args:
        output_base_dir: 实验配置根目录（其下按面数分子目录）
        faces_list: 面数列表，如 [10000, 20000, 40000, 80000]；None 时用 DEFAULT_FACES_LIST
        use_baseline: 如果为 True，在文件名中添加 baseline 标记
    """
    if faces_list is None:
        faces_list = DEFAULT_FACES_LIST
    
    for faces in faces_list:
        output_dir = os.path.join(output_base_dir, str(faces))
        os.makedirs(output_dir, exist_ok=True)
        print(f"\n--- faces = {faces} -> {output_dir}/ ---")
        _generate_one_faces_set(output_dir, faces, use_baseline)


def _generate_one_faces_set(output_dir, faces, use_baseline):
    """为单一面数生成 24 个 config，写入 output_dir。"""
    config_id = 1
    all_configs = []
    
    for dist_name, dist_values in PRIORITY_DISTRIBUTIONS.items():
        for model_count in MODEL_COUNTS:
            config = generate_config(
                config_id=config_id,
                model_count=model_count,
                priority_distribution=dist_values,
                faces=faces,
            )
            
            filename = f"config_{dist_name}_{model_count}.json"
            config_path = os.path.join(output_dir, filename)
            
            html_filename = f"index_{dist_name}_{model_count}.html"
            config["web_page"]["output_path"] = f"htmls/{faces}/{html_filename}"
            config["web_page"]["title"] = f"Experiment {dist_name} N={model_count}"
            
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
            
            exp_cfg = config["web_page"]["experiment_config"]
            p1_count = exp_cfg["priority_counts"]["P1"]
            p2_count = exp_cfg["priority_counts"]["P2"]
            p3_count = exp_cfg["priority_counts"]["P3"]
            
            print(f"  [{config_id:2d}/24] {filename}  P1={p1_count}, P2={p2_count}, P3={p3_count}")
            
            all_configs.append({
                "id": config_id,
                "file": filename,
                "distribution": dist_name,
                "model_count": model_count,
                "faces": faces,
                "priority_counts": {"P1": p1_count, "P2": p2_count, "P3": p3_count},
            })
            config_id += 1
    
    index_path = os.path.join(output_dir, "experiment_index.json")
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump({
            "total_configs": len(all_configs),
            "faces": faces,
            "priority_distributions": {
                name: {"P1": vals[0], "P2": vals[1], "P3": vals[2]}
                for name, vals in PRIORITY_DISTRIBUTIONS.items()
            },
            "model_counts": MODEL_COUNTS,
            "configs": all_configs,
        }, f, indent=2, ensure_ascii=False)
    
    print(f"  -> 索引: {index_path}")


def main():
    parser = argparse.ArgumentParser(
        description="按面数生成实验配置到 experiment_configs/{faces}/ (4 分布 × 6 模型数 = 24 配置/面数)"
    )
    parser.add_argument(
        "--output_dir",
        type=str,
        default="experiment_configs",
        help="实验配置根目录，其下按面数分子目录 (默认: experiment_configs)",
    )
    parser.add_argument(
        "--faces",
        type=int,
        nargs="+",
        default=None,
        metavar="N",
        help="面数列表，如 --faces 5000 10000 20000 40000 80000；默认: 10000 20000 40000 80000",
    )
    args = parser.parse_args()
    
    print("=" * 60)
    print("生成实验配置 (experiment_configs/{faces}/)")
    print("=" * 60)
    
    generate_all_configs_for_faces(
        output_base_dir=args.output_dir,
        faces_list=args.faces,
        use_baseline=False,
    )
    print("\n完成。之后对每种面数运行: python main.py --configs_dir experiment_configs/<faces>")


if __name__ == "__main__":
    main()

