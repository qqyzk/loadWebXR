#!/usr/bin/env python3
"""
Apply model-splitter chunk results into real applications.

功能概述
--------
- 读取 model-splitter 生成的 chunk_report_<profile>.json（每个 profile 独立一份，互不影响）。
- 根据实际分块数量，把分块文件拷贝到应用目录，路径命名遵循方案 A（带 profile）：
    src="item/Foo.glb", profile=4g, 实际 N 块
      -> item/Foo.glb_split_4g_Nchunks/model_chunk_1.gltf ...

- 自动修改应用的 HTML：
  - 在 <a-assets> 上设置 chunk-profile="<profile>"，用于运行时选择分块版本。
  - 对「实际>=2」的模型：添加/更新 chunked="true"、chunk-count="N"。
  - 对「无法分割」或实际<2 的模型：移除 chunked / chunk-count。

- 在首次对某个 HTML 做修改之前，会创建一个 *-no-chunk.html 备份。

场景与硬编码路径
----------------
- tale  -> EllieTale-WebXR-main / html/Beach.html
- hallo -> hallovreen-master / index.html
- mus   -> Virtual-Reality-Museum-master / index.html

用法示例
--------
python model-splitter/apply_chunks.py \\
  --chunk-report model-splitter/results/tale/chunk_report_4g.json

profile 从 chunk-report 文件名推断（chunk_report_4g.json -> 4g）。可选 --profile 覆盖。

可选参数：
  --scenario tale|hallo|mus   # 若无法从路径推断，可手动指定
  --profile 4g                # 覆盖从文件名推断的 profile
  --dry-run                   # 仅打印操作，不真正修改文件
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union


SCENARIO_NAMES = ("tale", "hallo", "mus")


@dataclass
class ScenarioConfig:
    name: str
    app_root: Path
    scene_html: Path
    results_root: Path


def build_scenario_configs(base_dir: Path) -> Dict[str, ScenarioConfig]:
    """
    根据仓库固定结构，构造三个场景的配置。

    base_dir: 仓库根目录（即包含 model-splitter 和 realCase 的目录）。
    """
    return {
        "tale": ScenarioConfig(
            name="tale",
            app_root=base_dir / "realCase" / "EllieTale-WebXR-main",
            scene_html=base_dir / "realCase" / "EllieTale-WebXR-main" / "html" / "Beach.html",
            results_root=base_dir / "model-splitter" / "results" / "tale",
        ),
        "hallo": ScenarioConfig(
            name="hallo",
            app_root=base_dir / "realCase" / "hallovreen-master",
            scene_html=base_dir / "realCase" / "hallovreen-master" / "index.html",
            results_root=base_dir / "model-splitter" / "results" / "hallo",
        ),
        "mus": ScenarioConfig(
            name="mus",
            app_root=base_dir / "realCase" / "Virtual-Reality-Museum-master",
            scene_html=base_dir / "realCase" / "Virtual-Reality-Museum-master" / "index.html",
            results_root=base_dir / "model-splitter" / "results" / "mus",
        ),
    }


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Apply chunk_report.json to Web3D applications (copy chunks + patch HTML)."
    )
    parser.add_argument(
        "--chunk-report",
        required=True,
        help="Path to chunk_report_<profile>.json (e.g. model-splitter/results/tale/chunk_report_4g.json).",
    )
    parser.add_argument(
        "--scenario",
        choices=SCENARIO_NAMES,
        help="Scenario name (tale|hallo|mus). If omitted, inferred from chunk-report path.",
    )
    parser.add_argument(
        "--profile",
        help="Profile name (e.g. 4g, 3g). If omitted, inferred from chunk-report filename (chunk_report_4g.json -> 4g).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned operations without touching filesystem.",
    )
    return parser.parse_args(argv)


def infer_scenario_from_path(path: Path) -> Optional[str]:
    """从 chunk_report 路径中推断场景名（tale / hallo / mus）。"""
    parts = [p.lower() for p in path.parts]
    for name in SCENARIO_NAMES:
        if name in parts:
            return name
    return None


def infer_profile_from_report_path(report_path: Path) -> Optional[str]:
    """从 chunk_report 文件名推断 profile：chunk_report_4g.json -> 4g。"""
    stem = report_path.stem  # chunk_report_4g
    if stem.startswith("chunk_report_"):
        return stem[len("chunk_report_"):] or None
    return None


def load_chunk_report(path: Path) -> List[Dict[str, Union[str, int, float]]]:
    if not path.is_file():
        raise FileNotFoundError(f"chunk_report.json not found: {path}")
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError(f"Expected list in chunk_report.json, got {type(data)}")
    return data


def build_src_to_actual_map(
    records: List[Dict[str, Union[str, int, float]]]
) -> Dict[str, Optional[int]]:
    """
    从 chunk_report 记录构建映射：
      src (e.g. 'item/Foo.glb') -> 实际块数 (>=2) 或 None。

    - '实际' 为数字且 >=2: 返回对应数字。
    - 其他情况（'无法分割'、<2 等）：返回 None。
    """
    result: Dict[str, Optional[int]] = {}
    for row in records:
        src = row.get("模型")
        actual = row.get("实际")
        if not isinstance(src, str):
            continue
        if isinstance(actual, int) and actual >= 2:
            result[src] = actual
        else:
            result[src] = None
    return result


def ensure_no_chunk_backup(html_path: Path, dry_run: bool = False) -> None:
    """
    如不存在 <name>-no-chunk.html，则创建一份备份。
    已存在时不覆盖。
    """
    if not html_path.is_file():
        raise FileNotFoundError(f"Scene HTML not found: {html_path}")

    backup_path = html_path.with_name(html_path.stem + "-no-chunk" + html_path.suffix)
    if backup_path.exists():
        print(f"[info] backup already exists, skip: {backup_path}")
        return

    print(f"[info] create no-chunk backup: {backup_path}")
    if dry_run:
        return
    shutil.copy2(html_path, backup_path)


def move_existing_split_dirs_for_src(
    scenario: ScenarioConfig,
    src: str,
    profile: str,
    backup_root: Path,
    dry_run: bool = False,
) -> None:
    """
    把 app_root 中与指定 src 且当前 profile 对应的旧分块目录移动到 backup_root。
    仅移动 *_split_<profile>_* 的目录，不影响其他 profile 的目录。
    """
    src_path = Path(src)
    parent_rel = src_path.parent  # e.g. 'item'
    base_name = src_path.name     # e.g. 'Foo.glb'

    parent_abs = scenario.app_root / parent_rel
    if not parent_abs.is_dir():
        return

    prefix = base_name + "_split_" + profile + "_"
    for entry in parent_abs.iterdir():
        if not entry.is_dir():
            continue
        if entry.name.startswith(prefix):
            rel_from_app = entry.relative_to(scenario.app_root)
            dest = backup_root / rel_from_app
            print(f"[info] move old split dir: {entry} -> {dest}")
            if dry_run:
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(entry), str(dest))


def copy_chunks_for_src(
    scenario: ScenarioConfig,
    results_root: Path,
    profile: str,
    src: str,
    actual_chunks: int,
    dry_run: bool = False,
) -> None:
    """
    将 results_root/<profile>/ 中的分块拷贝到 app_root 中 {src}_split_{profile}_{N}chunks/。
    若存在 .gltf + .bin（纹理去重输出），则拷贝 model_chunk_i.gltf、model_chunk_i.bin 及 base_stem_textures/；
    否则拷贝 model_chunk_i.glb。
    """
    src_path = Path(src)
    src_dir_rel = src_path.parent              # e.g. 'item'
    base_name = src_path.name                  # e.g. 'Foo.glb'
    base_stem = src_path.stem                  # e.g. 'Foo'

    source_dir = results_root / profile / src_dir_rel
    if not source_dir.is_dir():
        print(f"[warn] source dir for chunks not found, skip: {source_dir}")
        return

    target_dir = scenario.app_root / f"{src}_split_{profile}_{actual_chunks}chunks"
    print(f"[info] ensure target dir exists: {target_dir}")
    if not dry_run:
        target_dir.mkdir(parents=True, exist_ok=True)

    first_gltf = source_dir / f"{base_stem}_chunk_1.gltf"
    use_gltf = first_gltf.is_file()

    if use_gltf:
        for i in range(1, actual_chunks + 1):
            src_gltf = source_dir / f"{base_stem}_chunk_{i}.gltf"
            src_bin = source_dir / f"{base_stem}_chunk_{i}.bin"
            dst_gltf = target_dir / f"model_chunk_{i}.gltf"
            dst_bin = target_dir / f"model_chunk_{i}.bin"
            if not src_gltf.is_file():
                print(f"[warn] chunk gltf missing, skip: {src_gltf}")
                continue
            print(f"[info] copy chunk: {src_gltf} -> {dst_gltf}")
            if not dry_run:
                shutil.copy2(src_gltf, dst_gltf)
                if src_bin.is_file():
                    shutil.copy2(src_bin, dst_bin)
        textures_src = source_dir / f"{base_stem}_textures"
        if textures_src.is_dir():
            textures_dst = target_dir / f"{base_stem}_textures"
            print(f"[info] copy textures: {textures_src} -> {textures_dst}")
            if not dry_run:
                if textures_dst.exists():
                    shutil.rmtree(textures_dst)
                shutil.copytree(textures_src, textures_dst)
    else:
        for i in range(1, actual_chunks + 1):
            src_chunk = source_dir / f"{base_stem}_chunk_{i}.glb"
            dst_chunk = target_dir / f"model_chunk_{i}.glb"
            if not src_chunk.is_file():
                print(f"[warn] chunk file missing, skip copy: {src_chunk}")
                continue
            print(f"[info] copy chunk: {src_chunk} -> {dst_chunk}")
            if dry_run:
                continue
            shutil.copy2(src_chunk, dst_chunk)


def update_html_for_chunks(
    html_path: Path,
    profile: str,
    src_to_actual: Dict[str, Optional[int]],
    dry_run: bool = False,
) -> None:
    """
    根据 profile 与 src_to_actual 映射，更新 HTML：
    - 在 <a-assets> 上设置 chunk-profile="<profile>"。
    - 对 <a-asset-item>：若 actual>=2 添加/更新 chunked、chunk-count；否则移除。
    """
    if not html_path.is_file():
        raise FileNotFoundError(f"Scene HTML not found: {html_path}")

    with html_path.open("r", encoding="utf-8") as f:
        lines = f.readlines()

    def process_line(line: str) -> str:
        if "<a-asset-item" not in line:
            return line
        # 找出 src="... "
        m = re.search(r'src="([^"]+)"', line)
        if not m:
            return line
        src = m.group(1)

        # 先移除已有的 chunk 相关属性（含历史遗留的 chunk-format）
        new_line = re.sub(r'\s+chunked="[^"]*"', "", line)
        new_line = re.sub(r'\s+chunk-count="[^"]*"', "", new_line)
        new_line = re.sub(r'\s+chunk-format="[^"]*"', "", new_line)

        actual = src_to_actual.get(src)
        if actual is None or actual < 2:
            # 不分块：只保留清理后的行
            return new_line

        # 需要分块：插入 chunked & chunk-count
        insertion = f' chunked="true" chunk-count="{actual}"'
        m_resp = re.search(r'\sresponse-type=', new_line)
        if m_resp:
            pos = m_resp.start()
        else:
            # 放在 opening tag 的 > 之前（用 find 而非 rfind，避免插到 </a-asset-item> 后）
            pos = new_line.find(">")
            if pos == -1:
                pos = len(new_line)

        return new_line[:pos] + insertion + new_line[pos:]

    new_lines = [process_line(ln) for ln in lines]

    # 在 <a-assets> 上设置或更新 chunk-profile
    def set_a_assets_profile(line: str) -> str:
        if "<a-assets" not in line or line.strip().startswith("<!--"):
            return line
        new_line = re.sub(r'\s+chunk-profile="[^"]*"', "", line)
        # 在 > 前插入 chunk-profile
        pos = new_line.find(">")
        if pos == -1:
            pos = len(new_line)
        insertion = f' chunk-profile="{profile}"'
        return new_line[:pos] + insertion + new_line[pos:]

    new_lines = [set_a_assets_profile(ln) for ln in new_lines]

    if new_lines == lines:
        print(f"[info] HTML unchanged: {html_path}")
        return

    print(f"[info] write updated HTML: {html_path}")
    if dry_run:
        return
    with html_path.open("w", encoding="utf-8") as f:
        f.writelines(new_lines)


def main(argv: List[str]) -> int:
    script_path = Path(__file__).resolve()
    base_dir = script_path.parents[1]  # 仓库根目录: .../code
    configs = build_scenario_configs(base_dir)

    args = parse_args(argv)
    chunk_report_path = Path(args.chunk_report).resolve()

    scenario_name = args.scenario or infer_scenario_from_path(chunk_report_path)
    if not scenario_name:
        print(
            f"[error] unable to infer scenario from chunk-report path: {chunk_report_path}\n"
            f"        please specify --scenario explicitly (one of: {', '.join(SCENARIO_NAMES)})",
            file=sys.stderr,
        )
        return 1

    if scenario_name not in configs:
        print(f"[error] unknown scenario: {scenario_name}", file=sys.stderr)
        return 1

    scenario = configs[scenario_name]
    profile = args.profile or infer_profile_from_report_path(chunk_report_path)
    if not profile:
        print(
            "[error] could not infer profile from chunk-report filename (e.g. chunk_report_4g.json). Use --profile 4g",
            file=sys.stderr,
        )
        return 1

    print(f"[info] scenario: {scenario.name}")
    print(f"[info] profile: {profile}")
    print(f"[info] app_root: {scenario.app_root}")
    print(f"[info] scene_html: {scenario.scene_html}")
    print(f"[info] results_root: {scenario.results_root}")

    records = load_chunk_report(chunk_report_path)
    src_to_actual = build_src_to_actual_map(records)

    # 先备份 HTML（如无备份）
    ensure_no_chunk_backup(scenario.scene_html, dry_run=args.dry_run)

    # 为本次运行创建一个备份根目录，用于移动当前 profile 的旧 split 目录
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_root = scenario.app_root / "_chunk_backups" / timestamp

    # 预扫描：对报告中的每个 src，仅移动当前 profile 的 split 目录
    for src in sorted({row.get("模型") for row in records if isinstance(row.get("模型"), str)}):
        if src is None:
            continue
        move_existing_split_dirs_for_src(
            scenario=scenario,
            src=src,
            profile=profile,
            backup_root=backup_root,
            dry_run=args.dry_run,
        )

    # 拷贝新的分块文件（从 results_root/<profile>/ 到 app 的 _split_<profile>_Nchunks）
    for src, actual in src_to_actual.items():
        if actual is None or actual < 2:
            continue
        copy_chunks_for_src(
            scenario=scenario,
            results_root=scenario.results_root,
            profile=profile,
            src=src,
            actual_chunks=actual,
            dry_run=args.dry_run,
        )

    # 更新 HTML：chunk-profile 与各 a-asset-item 的 chunked / chunk-count
    update_html_for_chunks(
        html_path=scenario.scene_html,
        profile=profile,
        src_to_actual=src_to_actual,
        dry_run=args.dry_run,
    )

    print("[info] done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

