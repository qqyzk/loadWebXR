#!/usr/bin/env python3
import argparse
import glob
import json
import os
import sys

import model_generator
import audio_generator
import webpage_generator


def main():
    parser = argparse.ArgumentParser(description="Pipeline controller: model -> audio -> webpage")
    parser.add_argument("--configs_dir", type=str, default="configs", help="配置文件目录，例如 configs/")
    parser.add_argument("--skip_model", action="store_true", help="跳过模型生成步骤")
    parser.add_argument("--skip_audio", action="store_true", help="跳过音频处理步骤")
    parser.add_argument("--skip_webpage", action="store_true", help="跳过网页生成步骤")
    args = parser.parse_args()

    # 获取 configs/config_*.json
    config_files = sorted(glob.glob(os.path.join(args.configs_dir, "config_*.json")))
    if not config_files:
        print(f"[ERROR] 在 {args.configs_dir} 下没有找到 config_*.json", file=sys.stderr)
        sys.exit(1)

    print(f"找到 {len(config_files)} 个配置文件：")
    for cf in config_files:
        print(" -", cf)

    for config_path in config_files:
        print(f"处理配置文件: {config_path}")

        # 读取 config
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception as e:
            print(f"[ERROR] 无法读取配置 {config_path}: {e}", file=sys.stderr)
            continue

        # Step 1: 模型生成
        if not args.skip_model:
            try:
                print("=== Step 1: Model generation ===")
                model_generator.batch_generate(config_path=config_path)
            except Exception as e:
                print("[ERROR] 模型生成失败：", e, file=sys.stderr)
                continue
        else:
            print("=== Step 1: Model generation skipped ===")

        # Step 2: 音频处理
        if not args.skip_audio:
            try:
                print("=== Step 2: Audio processing ===")
                audio_generator.extract_audio(config_path=config_path)
            except Exception as e:
                print("[ERROR] 音频处理失败：", e, file=sys.stderr)
                continue
        else:
            print("=== Step 2: Audio processing skipped ===")

        # Step 3: 网页生成
        if not args.skip_webpage:
            try:
                print("=== Step 3: Webpage generation ===")
                webpage_generator.generate_webpage(config_path=config_path)
            except Exception as e:
                print("[ERROR] 网页生成失败：", e, file=sys.stderr)
                continue
        else:
            print("=== Step 3: Webpage generation skipped ===")

        print(f"配置 {config_path} 执行完成！")

    print("\n全部配置文件执行完成！")


if __name__ == "__main__":
    main()