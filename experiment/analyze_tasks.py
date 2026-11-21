#!/usr/bin/env python3
"""
Explain the long frames of prism runs from the scheduler task log (task-log="on").

For each run: the frame trace (scene.remTimes) is rebuilt with timestamps, the
loading-phase frames after TTFF are taken (as in analyze.py), and every frame
longer than --threshold ms is attributed to what happened during it:

  task       a scheduler task whose synchronous part ran in that frame
             (kind, model, sync ms) -- e.g. a chunk/model parse that exceeds
             the budget (chunk granularity) or a GPU preparation task
  overlap    more than one scheduler loop was active (the loop awaits a parse
             and the next frame starts another loop, so the budget is not
             enforced across them)
  loaded     a model finished loading in the previous ~2 frames (its first
             draw: GPU upload / shader compile at render time)
  none       nothing from the loader (rendering itself, the application, GC)

Also reports per run: tasks whose synchronous part exceeds the effective
budget, the maximum number of concurrent loops, and the total GPU-preparation
time.

Usage: python3 experiment/analyze_tasks.py <session> [--threshold 25] [--config substr]
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

EXP_DIR = Path(__file__).resolve().parent
BUDGET_MS = 16.7 * 0.7
SKIP = 3


def frames_with_time(exp):
    t = exp.get("firstRenderTime") or (exp["renderTimes"][0] if exp.get("renderTimes") else 0.0)
    out = []
    for f in exp.get("frames") or []:
        start = t
        t += f["delta"]
        out.append((start, t, f["delta"], bool(f.get("allAssetsLoaded"))))
    return out


def explain(exp, threshold):
    log = exp.get("taskLog") or []
    loads = [e["time"] for e in exp.get("modelEvents") or []]
    frames = [f for f in frames_with_time(exp) if not f[3] and (exp.get("ttffEndTime") is None or f[1] > exp["ttffEndTime"])][SKIP:]
    rows = []
    for start, end, dur, _ in frames:
        if dur < threshold:
            continue
        tasks = [t for t in log if start <= t["t0"] < end and t["sync"] >= 1.0]
        tasks.sort(key=lambda t: -t["sync"])
        overlap = max((t["loops"] for t in log if start <= t["t0"] < end), default=0)
        recent = [x for x in loads if start - 40 <= x < end]
        if tasks:
            cause = "task"
        elif recent:
            cause = "loaded"
        else:
            cause = "none"
        rows.append({
            "at_s": (end - exp["startTime"]) / 1000, "frame_ms": dur, "cause": cause, "loops": overlap,
            "tasks": [(t["kind"], t["id"].split("/")[-1][:28], round(t["sync"], 1)) for t in tasks[:3]],
        })
    long_tasks = [t for t in log if t["frame"] != -1 and t["sync"] > BUDGET_MS]
    return {
        "long_frames": rows,
        "long_tasks": Counter(t["kind"] for t in long_tasks),
        "max_sync_by_kind": {k: round(max(t["sync"] for t in log if t["kind"] == k), 1) for k in {t["kind"] for t in log}},
        "max_loops": max((t["loops"] for t in log), default=0),
        "gpu_ms": round(sum(t["sync"] for t in log if t["kind"].startswith("gpu-") and t["frame"] != -1), 1),
        "gpu_p1_ms": round(sum(t["sync"] for t in log if t["kind"] == "gpu-p1"), 1),
    }


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("session")
    ap.add_argument("--threshold", type=float, default=25.0)
    ap.add_argument("--config", default="")
    args = ap.parse_args(argv)
    root = EXP_DIR / "results" / args.session
    causes_by_config: dict[str, Counter] = {}
    for f in sorted(root.glob("*/*/run_*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        exp, meta = data["exp"], data["meta"]
        if args.config not in meta["config"] or not exp.get("frames"):
            continue
        r = explain(exp, args.threshold)
        c = causes_by_config.setdefault(meta["config"], Counter())
        c.update(row["cause"] for row in r["long_frames"])
        print(f"== {meta['app']}/{meta['config']} round {meta['round']}: {len(r['long_frames'])} frames >= {args.threshold:.0f} ms, "
              f"max loops {r['max_loops']}, tasks over budget {dict(r['long_tasks'])}, "
              f"GPU prep {r['gpu_ms']} ms (+{r['gpu_p1_ms']} ms before first frame)")
        print(f"   max sync per kind: {r['max_sync_by_kind']}")
        for row in r["long_frames"][:6]:
            print(f"   {row['frame_ms']:6.1f} ms at {row['at_s']:5.1f}s  {row['cause']:6s} loops={row['loops']} {row['tasks']}")
    if causes_by_config:
        print("\nlong-frame causes per configuration (all runs):")
        for cfg, c in sorted(causes_by_config.items()):
            print(f"   {cfg:24s} {dict(c)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
