#!/usr/bin/env python3
"""
生成实验配置脚本
生成 4种优先级分布 × 5种资源总数 = 20种配置组合

优先级分布：
1. (70%, 20%, 10%) - P1主导
2. (50%, 30%, 20%) - 均衡偏P1
3. (20%, 30%, 50%) - 均衡偏P3
4. (10%, 20%, 70%) - P3主导

资源总数：
16, 32, 64, 128, 256
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


def generate_all_configs(output_dir="experiment_configs", use_baseline=False):
    """
    生成所有实验配置
    
    Args:
        output_dir: 输出目录
        use_baseline: 如果为True，在文件名中添加baseline标记
    """
    os.makedirs(output_dir, exist_ok=True)
    
    config_id = 1
    all_configs = []
    
    for dist_name, dist_values in PRIORITY_DISTRIBUTIONS.items():
        for model_count in MODEL_COUNTS:
            # 生成配置
            config = generate_config(
                config_id=config_id,
                model_count=model_count,
                priority_distribution=dist_values
            )
            
            # 修改输出路径
            branch_suffix = "baseline" if use_baseline else "main"
            filename = f"config_{dist_name}_{model_count}.json"
            config_path = os.path.join(output_dir, filename)
            
            # 同时也更新web_page中的output_path
            html_filename = f"index_{dist_name}_{model_count}.html"
            config["web_page"]["output_path"] = f"htmls/{html_filename}"
            config["web_page"]["title"] = f"Experiment {dist_name} N={model_count}"
            
            # 保存配置
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
            
            # 统计信息
            exp_cfg = config["web_page"]["experiment_config"]
            p1_count = exp_cfg["priority_counts"]["P1"]
            p2_count = exp_cfg["priority_counts"]["P2"]
            p3_count = exp_cfg["priority_counts"]["P3"]
            
            print(f"[{config_id:2d}/20] {filename}")
            print(f"        Priority: P1={p1_count:3d}, P2={p2_count:3d}, P3={p3_count:3d}")
            
            all_configs.append({
                "id": config_id,
                "file": filename,
                "distribution": dist_name,
                "model_count": model_count,
                "priority_counts": {
                    "P1": p1_count,
                    "P2": p2_count,
                    "P3": p3_count
                }
            })
            
            config_id += 1
    
    # 生成索引文件
    index_path = os.path.join(output_dir, "experiment_index.json")
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump({
            "total_configs": len(all_configs),
            "priority_distributions": {
                name: {"P1": vals[0], "P2": vals[1], "P3": vals[2]} 
                for name, vals in PRIORITY_DISTRIBUTIONS.items()
            },
            "model_counts": MODEL_COUNTS,
            "configs": all_configs
        }, f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ 已生成 {len(all_configs)} 个配置文件")
    print(f"✅ 索引文件: {index_path}")
    print(f"\n配置目录: {output_dir}/")


def main():
    parser = argparse.ArgumentParser(
        description="生成实验配置 (4种优先级分布 × 5种资源总数 = 20种配置)"
    )
    parser.add_argument(
        "--output_dir", 
        type=str, 
        default="experiment_configs",
        help="输出目录 (默认: experiment_configs)"
    )
    args = parser.parse_args()
    
    print(f"=" * 60)
    print(f"生成实验配置")
    print(f"=" * 60)
    
    generate_all_configs(output_dir=args.output_dir, use_baseline=False)


if __name__ == "__main__":
    main()

