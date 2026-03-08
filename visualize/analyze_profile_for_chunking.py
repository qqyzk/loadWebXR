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
    parser.add_argument(
        "--max-k",
        type=int,
        default=16,
        help="Maximum chunk count k per model; values above this are clipped (default:16).",
    )
    parser.add_argument(
        "--expansion",
        type=int,
        default=None,
        metavar="PCT",
        help=(
            "Single expansion percent (e.g. 30). Target total chunks = N*(1+PCT/100). "
            "Uses greedy split: repeatedly split the slowest model until target reached."
        ),
    )
    parser.add_argument(
        "--expansions",
        nargs="*",
        type=int,
        default=None,
        metavar="PCT",
        help=(
            "Multiple expansion percents to generate multiple plans (e.g. 30 50 100 200). "
            "Writes chunk_plan_<base>_<pct>.json for each. Overrides --expansion."
        ),
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
    max_k: int = 16,
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
            k = min(k, max_k)
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


def build_records_expansion(
    aggregated: Dict[Tuple[str, str, str], float],
    target_frame_ms: float,
    safe_margin_ms: float,
    expansion_pct: int,
    max_k: int = 16,
) -> List[Dict[str, Any]]:
    """
    Build chunk plan by expansion percent: target total chunks = N * (1 + expansion_pct/100).
    Greedy: repeatedly split the model with largest (time_i / k_i) until target chunk count reached.
    """
    budget_ms = target_frame_ms - safe_margin_ms
    if budget_ms <= 0:
        raise ValueError(
            f"Non-positive budget: target_frame_ms={target_frame_ms}, "
            f"safe_margin_ms={safe_margin_ms}"
        )

    # Separate 3D models (by maxProcessTimeMs desc) and non-models
    model_keys: List[Tuple[Tuple[str, str, str], float]] = []
    non_model_items: List[Tuple[Tuple[str, str, str], float]] = []
    for key, max_process in aggregated.items():
        (src, task_type, subtype) = key
        if is_3d_model(subtype, src):
            model_keys.append((key, max_process))
        else:
            non_model_items.append((key, max_process))

    model_keys.sort(key=lambda x: x[1], reverse=True)
    N = len(model_keys)
    if N == 0:
        target_total = 0
    else:
        target_total = max(N, round(N * (1 + expansion_pct / 100.0)))
    target_total = min(target_total, N * max_k)

    # Greedy: k[i] for each model, start all at 1, add splits until sum(k) == target_total
    k_list = [1] * N
    current_total = N
    while current_total < target_total:
        best_i = -1
        best_val = -1.0
        for i in range(N):
            if k_list[i] >= max_k:
                continue
            val = model_keys[i][1] / k_list[i]
            if val > best_val:
                best_val = val
                best_i = i
        if best_i < 0:
            break
        k_list[best_i] += 1
        current_total += 1

    key_to_k: Dict[Tuple[str, str, str], int] = {
        model_keys[i][0]: k_list[i] for i in range(N)
    }

    records: List[Dict[str, Any]] = []
    for (src, task_type, subtype), max_process in sorted(
        aggregated.items(), key=lambda kv: kv[0][0]
    ):
        key = (src, task_type, subtype)
        model_flag = is_3d_model(subtype, src)
        k = key_to_k.get(key, 1) if model_flag else 1
        need_chunk = bool(model_flag and k > 1)
        exceeds_budget = max_process > budget_ms

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


def build_records_expansion(
    aggregated: Dict[Tuple[str, str, str], float],
    target_frame_ms: float,
    safe_margin_ms: float,
    expansion_pct: int,
    max_k: int = 16,
) -> List[Dict[str, Any]]:
    """
    Build chunk plan by expansion: target total chunks = N * (1 + expansion_pct/100).
    Greedy: repeatedly pick the model with largest (time_i / k_i), increment k_i until
    total chunks reached. Non-3D resources get k=1.
    """
    budget_ms = target_frame_ms - safe_margin_ms
    if budget_ms <= 0:
        raise ValueError(
            f"Non-positive budget: target_frame_ms={target_frame_ms}, "
            f"safe_margin_ms={safe_margin_ms}"
        )

    # Separate 3D models (by profile time desc) and non-models
    model_keys_times: List[Tuple[Tuple[str, str, str], float]] = []
    non_model_items: List[Tuple[Tuple[str, str, str], float]] = []

    for key, max_process in aggregated.items():
        (src, task_type, subtype) = key
        if is_3d_model(subtype, src):
            model_keys_times.append((key, max_process))
        else:
            non_model_items.append((key, max_process))

    # Sort models by maxProcessTimeMs descending (slowest first)
    model_keys_times.sort(key=lambda x: x[1], reverse=True)
    N = len(model_keys_times)
    if N == 0:
        target_total = 0
    else:
        target_total = max(N, round(N * (1 + expansion_pct / 100.0)))

    # Greedy: k_i = 1 initially; add splits until sum(k_i) == target_total
    # Each step: pick i with max time_i / k_i, then k_i += 1 (cap at max_k)
    k_list = [1] * N
    current_total = N
    while current_total < target_total:
        best_i = -1
        best_val = -1.0
        for i in range(N):
            if k_list[i] >= max_k:
                continue
            val = model_keys_times[i][1] / k_list[i]
            if val > best_val:
                best_val = val
                best_i = i
        if best_i < 0:
            break
        k_list[best_i] += 1
        current_total += 1

    key_to_k: Dict[Tuple[str, str, str], int] = {}
    for idx, (key, _) in enumerate(model_keys_times):
        key_to_k[key] = k_list[idx]

    # Build full records (models + non-models), sorted by src for stability
    records: List[Dict[str, Any]] = []
    for key, max_process in sorted(aggregated.items(), key=lambda kv: kv[0][0]):
        (src, task_type, subtype) = key
        model_flag = is_3d_model(subtype, src)
        k = key_to_k.get(key, 1)
        need_chunk = bool(model_flag and k > 1)
        exceeds_budget = max_process > budget_ms

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


def _profile_base_name(profile_path: str) -> str:
    """e.g. profile_4g or profile_4g.json -> profile_4g"""
    base = os.path.basename(profile_path)
    if base.endswith(".json"):
        base = base[:-5]
    return base


def main() -> None:
    args = parse_args()

    profile_path = args.profile_path
    target_frame_ms = args.target_frame_ms
    safe_margin_ms = args.safe_margin_ms

    if safe_margin_ms is None:
        safe_margin_ms = target_frame_ms * 0.3

    frames = load_profile(profile_path)
    aggregated = aggregate_max_process_times(frames)
    dir_name = os.path.dirname(profile_path)
    base_name = _profile_base_name(profile_path)

    # Multiple expansion percents (e.g. 30 50 100 200)
    if args.expansions is not None:
        for pct in args.expansions:
            records = build_records_expansion(
                aggregated,
                target_frame_ms,
                safe_margin_ms,
                expansion_pct=pct,
                max_k=args.max_k,
            )
            output_name = f"chunk_plan_{base_name}_{pct}.json"
            output_path = os.path.join(dir_name, output_name)
            write_output(records, output_path)
            print(f"Wrote chunking plan (expansion={pct}%): {output_path}")
        if args.expansions:
            print_summary(records, args.top_k)
        return

    # Single expansion percent
    if args.expansion is not None:
        records = build_records_expansion(
            aggregated,
            target_frame_ms,
            safe_margin_ms,
            expansion_pct=args.expansion,
            max_k=args.max_k,
        )
        if args.output:
            output_path = args.output
        else:
            output_name = f"chunk_plan_{base_name}_{args.expansion}.json"
            output_path = os.path.join(dir_name, output_name)
        write_output(records, output_path)
        print(f"Wrote chunking plan (expansion={args.expansion}%): {output_path}")
        print_summary(records, args.top_k)
        return

    # Legacy: single plan by budget
    records = build_records(
        aggregated, target_frame_ms, safe_margin_ms, max_k=args.max_k
    )
    if args.output:
        output_path = args.output
    else:
        output_name = f"chunk_plan_{base_name}.json"
        output_path = os.path.join(dir_name, output_name)
    write_output(records, output_path)
    print(f"Wrote chunking plan to: {output_path}")
    print_summary(records, args.top_k)


if __name__ == "__main__":
    main()

