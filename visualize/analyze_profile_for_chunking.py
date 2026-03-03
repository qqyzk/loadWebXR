#!/usr/bin/env python3

import argparse
import json
import math
import os
from typing import Any, Dict, List, Tuple


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Analyze a single PrismLoader profile file and "
            "derive per-src processing time and chunking decisions."
        )
    )
    parser.add_argument(
        "profile_path",
        help="Path to a profile JSON file (e.g. visualize/data/tale/profile_4g).",
    )
    parser.add_argument(
        "--target-frame-ms",
        type=float,
        default=16.7,
        help=(
            "Target frame time in milliseconds (default: 16.7, i.e., 60 FPS). "
            "Can be overridden from the command line."
        ),
    )
    parser.add_argument(
        "--safe-margin-ms",
        type=float,
        default=None,
        help=(
            "Safety margin in milliseconds to subtract from the frame budget. "
            "If omitted, defaults to 0.3 * target-frame-ms (same as a-assets-profile.js)."
        ),
    )
    parser.add_argument(
        "--output",
        help=(
            "Output JSON path. If omitted, a file named "
            "'chunk_plan_<profile_basename>.json' is written next to the profile."
        ),
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=10,
        help="How many slowest 3D models to show in the summary.",
    )
    return parser.parse_args()


def is_3d_model(subtype: str, src: str) -> bool:
    subtype = (subtype or "").lower()
    if subtype == "gltf-model":
        return True
    src_lower = (src or "").lower()
    return src_lower.endswith(".gltf") or src_lower.endswith(".glb")


def load_profile(path: str) -> List[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError(f"Expected top-level list in profile file: {path}")
    return data


def aggregate_max_process_times(
    frames: List[Dict[str, Any]],
) -> Dict[Tuple[str, str, str], float]:
    """
    Aggregate maximum durationMs for each (src, type, subtype) from the profile.

    Filters:
      - frame['priority'] must be 2 or 3
      - task['type'] must be 'scene'
    """
    result: Dict[Tuple[str, str, str], float] = {}

    for frame in frames:
        priority = frame.get("priority")
        if priority not in (2, 3):
            continue

        tasks = frame.get("tasks") or []
        for task in tasks:
            task_type = task.get("type")
            if task_type != "scene":
                continue

            src = task.get("src")
            subtype = task.get("subtype")
            if src is None:
                continue

            duration = task.get("durationMs")
            if not isinstance(duration, (int, float)):
                continue

            key = (src, task_type, subtype or "")
            prev = result.get(key)
            if prev is None or duration > prev:
                result[key] = float(duration)

    return result


def build_records(
    aggregated: Dict[Tuple[str, str, str], float],
    target_frame_ms: float,
    safe_margin_ms: float,
) -> List[Dict[str, Any]]:
    budget_ms = target_frame_ms - safe_margin_ms
    if budget_ms <= 0:
        raise ValueError(
            f"Non-positive budget: target_frame_ms={target_frame_ms}, "
            f"safe_margin_ms={safe_margin_ms}"
        )

    records: List[Dict[str, Any]] = []

    for (src, task_type, subtype), max_process in sorted(
        aggregated.items(), key=lambda kv: kv[0][0]
    ):
        model_flag = is_3d_model(subtype, src)
        exceeds_budget = max_process > budget_ms
        need_chunk = bool(model_flag and exceeds_budget)

        if need_chunk:
            k = int(math.ceil(max_process / budget_ms))
        else:
            k = 1

        record = {
            "src": src,
            "type": task_type,
            "subtype": subtype,
            "is3DModel": model_flag,
            "maxProcessTimeMs": max_process,
            "targetFrameTimeMs": target_frame_ms,
            "safeMarginMs": safe_margin_ms,
            "budgetMs": budget_ms,
            "exceedsBudget": exceeds_budget,
            "needChunk": need_chunk,
            "k": k,
        }
        records.append(record)

    return records


def write_output(records: List[Dict[str, Any]], output_path: str) -> None:
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)


def print_summary(records: List[Dict[str, Any]], top_k: int) -> None:
    total = len(records)
    models = [r for r in records if r.get("is3DModel")]
    non_models = [r for r in records if not r.get("is3DModel")]

    need_chunk_models = [r for r in models if r.get("needChunk")]
    exceeds_non_models = [r for r in non_models if r.get("exceedsBudget")]

    if records:
        budget_ms = records[0].get("budgetMs")
        target_frame_ms = records[0].get("targetFrameTimeMs")
        safe_margin_ms = records[0].get("safeMarginMs")
    else:
        budget_ms = target_frame_ms = safe_margin_ms = None

    print("=== Chunking Analysis Summary ===")
    if target_frame_ms is not None:
        print(f"Target frame time (ms): {target_frame_ms}")
    if safe_margin_ms is not None:
        print(f"Safe margin (ms):      {safe_margin_ms}")
    if budget_ms is not None:
        print(f"Effective budget (ms): {budget_ms}")
    print()

    print(f"Total resources:              {total}")
    print(f"3D models (is3DModel=true):   {len(models)}")
    print(f"Models needing chunking:      {len(need_chunk_models)}")
    print(f"Non-models exceeding budget:  {len(exceeds_non_models)}")
    print()

    if need_chunk_models:
        print(f"Top {min(top_k, len(need_chunk_models))} slowest models (by maxProcessTimeMs):")
        sorted_models = sorted(
            need_chunk_models,
            key=lambda r: r.get("maxProcessTimeMs", 0),
            reverse=True,
        )
        for r in sorted_models[:top_k]:
            print(
                f"- {r['src']}: "
                f"{r['maxProcessTimeMs']:.2f} ms, "
                f"k={r['k']}"
            )
        print()

    if exceeds_non_models:
        print("Non-3D resources exceeding budget (for inspection):")
        sorted_non = sorted(
            exceeds_non_models,
            key=lambda r: r.get("maxProcessTimeMs", 0),
            reverse=True,
        )
        for r in sorted_non[:top_k]:
            print(
                f"- {r['src']} (subtype={r.get('subtype')}): "
                f"{r['maxProcessTimeMs']:.2f} ms"
            )
        print()


def main() -> None:
    args = parse_args()

    profile_path = args.profile_path
    target_frame_ms = args.target_frame_ms
    safe_margin_ms = args.safe_margin_ms

    if safe_margin_ms is None:
        # Keep default consistent with a-assets-profile.js:
        # this.frameTimeBudget = 16.7;
        # this.safeMargin = this.frameTimeBudget * 0.3;
        safe_margin_ms = target_frame_ms * 0.3

    frames = load_profile(profile_path)
    aggregated = aggregate_max_process_times(frames)
    records = build_records(aggregated, target_frame_ms, safe_margin_ms)

    if args.output:
        output_path = args.output
    else:
        base = os.path.basename(profile_path)
        dir_name = os.path.dirname(profile_path)
        output_name = f"chunk_plan_{base}.json"
        output_path = os.path.join(dir_name, output_name)

    write_output(records, output_path)
    print(f"Wrote chunking plan to: {output_path}")
    print_summary(records, args.top_k)


if __name__ == "__main__":
    main()

