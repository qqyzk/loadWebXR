#!/usr/bin/env python3
"""
Summarise one experiment session (experiment/results/<session>/).

Per run:
  ttff_ms        click -> first frame after all visible P1 models are loaded
  load_ms        click -> all assets loaded (loaders that emit all-assets-loaded)
  smoothness     from the per-frame deltas recorded by a-scene (scene.remTimes, the
                 data behind FTSD/MaxFT in the paper), restricted to the loading
                 phase after the first complete frame: frames rendered after TTFF
                 and flagged allAssetsLoaded == false (the loading-phase rule of
                 visualize/analyze_fluency.py), skipping the first SKIP_FRAMES
                 frames as the original analysis did. Loaders that render from
                 the start (bundle "progressive": progressive, via) are measured
                 from the first frame instead of from TTFF.
                 ftsd, max_ft, top3_ft (mean of the 3 longest frames), p99_ft,
                 low1_fps (1% low: FPS over the slowest 1% of frames),
                 missed_ratio (frames missed at the display period; the period is
                 the median frame time of the run unless --period is given).
  visibility     (levels set) time with at least one model inside the view frustum
                 but not loaded yet, and per-asset first-in-view / loaded times.
  timed_out      (stress set) run stopped at maxDurationMs before loading finished.
  stages         (stages set) per-model wall / main-thread-blocking time of parse,
                 integrate, compile, upload and draw; median over runs -> stages.csv.

Outputs (in the session directory): runs.csv, summary.csv (mean, std, median and
95% confidence interval per application x configuration) and, if present,
visibility.csv. A compact table is printed; for the main set it also reports the
best chunk configuration per application (lowest mean MaxFT among prism-*).

Usage: python3 experiment/analyze.py <session> [--period MS] [--skip-frames N]
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import sys
from pathlib import Path

EXP_DIR = Path(__file__).resolve().parent
SKIP_FRAMES = 3

# Two-sided 95% Student t quantiles for small samples (df = n - 1).
T95 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306,
       9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
       19: 2.093, 24: 2.064, 29: 2.045}


def t95(df: int) -> float:
    if df in T95:
        return T95[df]
    smaller = [k for k in T95 if k <= df]
    return T95[max(smaller)] if smaller and df < 30 else 1.96


def frame_series(exp: dict) -> list[tuple[float, float, bool]]:
    """(timestamp, frame time, allAssetsLoaded) from scene.remTimes; timestamps are
    rebuilt from the first rendered frame (remTimes starts at the second frame)."""
    frames = exp.get("frames") or []
    t = exp.get("firstRenderTime")
    if t is None:
        t = exp["renderTimes"][0] if exp.get("renderTimes") else 0.0
    out = []
    for f in frames:
        t += f["delta"]
        out.append((t, f["delta"], bool(f.get("allAssetsLoaded"))))
    return out


def smoothness(exp: dict, skip: int, period: float | None, from_first_frame: bool = False) -> dict:
    series = frame_series(exp)
    start = None if from_first_frame else exp.get("ttffEndTime")
    ft = [d for (t, d, loaded) in series if not loaded and (start is None or t > start)]
    ft = ft[skip:]
    if not ft:
        return {"n_frames": 0}
    ordered = sorted(ft)
    n = len(ft)
    worst = ordered[-max(1, math.ceil(n * 0.01)):]
    per = period or statistics.median(ft)
    missed = sum(max(0, round(d / per) - 1) for d in ft)
    return {
        "n_frames": n,
        "ftsd": statistics.pstdev(ft),
        "max_ft": ordered[-1],
        "top3_ft": statistics.mean(ordered[-3:]),
        "p99_ft": ordered[min(n - 1, math.ceil(0.99 * n) - 1)],
        "low1_fps": 1000.0 / statistics.mean(worst),
        "missed_ratio": missed / (missed + n),
        "period": per,
    }


STAGES = ["parse", "integrate", "compile", "upload", "draw"]


def stage_summary(files: list[Path]) -> list[dict]:
    per_model: dict[tuple, list[dict]] = {}
    for f in files:
        data = json.loads(f.read_text(encoding="utf-8"))
        for st in data["exp"].get("stages", []):
            per_model.setdefault((data["meta"]["app"], st["id"]), []).append(st)
    out = []
    for (app, model), runs in sorted(per_model.items()):
        first = runs[0]
        row = {"app": app, "model": model, "priority": first["priority"], "n": len(runs), "mb": first["bytes"] / 1e6,
               "textures": first["textures"], "triangles": first["triangles"]}
        for stage in STAGES:
            row[f"{stage}_ms"] = statistics.median(r[stage]["wallMs"] for r in runs)
            row[f"{stage}_blocked_ms"] = statistics.median(r[stage]["blockedMs"] for r in runs)
        out.append(row)
    return out


def run_metrics(path: Path, skip: int, period: float | None) -> tuple[dict, list[dict]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    meta, exp = data["meta"], data["exp"]
    row = {
        "app": meta["app"], "config": meta["config"], "round": meta["round"],
        "ttff_ms": exp.get("ttff"),
        "load_ms": (exp["allAssetsLoadedTime"] - exp["startTime"]) if exp.get("allAssetsLoadedTime") else None,
        "timed_out": exp.get("timedOut", False),
        "models_loaded": len(exp.get("modelEvents") or []),
        "page_errors": sum(1 for e in data.get("consoleErrors", []) if e.startswith("pageerror")),
        "battery_temp": meta.get("batteryTemp"),
        "viewport": "x".join(str(v) for v in exp.get("viewport") or []),
    }
    row.update(smoothness(exp, skip, period, from_first_frame=meta.get("bundle") == "progressive"))
    vis_rows = []
    vis = exp.get("visibility")
    if vis:
        stats = vis["stats"]
        row["incomplete_ms"] = stats["incompleteMs"]
        row["incomplete_frame_ratio"] = stats["incompleteFrames"] / stats["frames"] if stats["frames"] else None
        t0 = exp["startTime"]
        for e in vis["entities"]:
            vis_rows.append({
                "app": meta["app"], "config": meta["config"], "round": meta["round"], "key": e["key"],
                "asset": e["asset"],
                "first_in_view_s": (e["firstInView"] - t0) / 1000 if e["firstInView"] is not None else None,
                "loaded_s": (e["loadedTime"] - t0) / 1000 if e["loadedTime"] is not None else None,
                "in_view_before_loaded": e["firstInViewLoaded"] is False,
                "missing_ms": e["missingMs"],
            })
        row["entities_seen_unloaded"] = sum(1 for v in vis_rows if v["in_view_before_loaded"])
    return row, vis_rows


def summarise(rows: list[dict], metrics: list[str]) -> list[dict]:
    groups: dict[tuple, list[dict]] = {}
    for r in rows:
        groups.setdefault((r["app"], r["config"]), []).append(r)
    out = []
    for (app, config), rs in sorted(groups.items()):
        s = {"app": app, "config": config, "n": len(rs)}
        for m in metrics:
            vals = [r[m] for r in rs if isinstance(r.get(m), (int, float)) and not isinstance(r.get(m), bool)]
            if not vals:
                continue
            mean = statistics.mean(vals)
            sd = statistics.stdev(vals) if len(vals) > 1 else 0.0
            s[f"{m}_mean"] = mean
            s[f"{m}_std"] = sd
            s[f"{m}_median"] = statistics.median(vals)
            s[f"{m}_ci95"] = t95(len(vals) - 1) * sd / math.sqrt(len(vals)) if len(vals) > 1 else None
        s["timed_out"] = sum(1 for r in rs if r.get("timed_out"))
        out.append(s)
    return out


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    fields = []
    for r in rows:
        fields += [k for k in r if k not in fields]
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def fmt(v, digits=1):
    return "-" if v is None else f"{v:.{digits}f}"


def main(argv) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("session")
    ap.add_argument("--period", type=float, default=None, help="display frame period in ms (default: per-run median)")
    ap.add_argument("--skip-frames", type=int, default=SKIP_FRAMES)
    args = ap.parse_args(argv)

    root = EXP_DIR / "results" / args.session
    files = sorted(root.glob("*/*/run_*.json"))
    if not files:
        print(f"no runs under {root}")
        return 1
    stage_files = [f for f in files if f.parent.name == "stages"]
    files = [f for f in files if f.parent.name != "stages"]
    if stage_files:
        stages = stage_summary(stage_files)
        write_csv(root / "stages.csv", stages)
        print(f"{len(stage_files)} stage-benchmark runs -> stages.csv")
        print(f"{'app':5s} {'model':24s} {'P':>1s} {'MB':>5s} {'parse':>7s} {'integ':>6s} {'compile':>7s} {'upload':>7s} {'draw':>6s}  (median ms)")
        for r in stages:
            print(f"{r['app']:5s} {r['model']:24s} {r['priority']:1d} {r['mb']:5.1f} {r['parse_ms']:7.1f} {r['integrate_ms']:6.1f} "
                  f"{r['compile_ms']:7.1f} {r['upload_ms']:7.1f} {r['draw_ms']:6.1f}")
    if not files:
        return 0
    rows, vis_rows = [], []
    for f in files:
        r, v = run_metrics(f, args.skip_frames, args.period)
        rows.append(r)
        vis_rows += v

    metrics = ["ttff_ms", "load_ms", "ftsd", "max_ft", "top3_ft", "p99_ft", "low1_fps", "missed_ratio",
               "n_frames", "incomplete_ms", "incomplete_frame_ratio", "entities_seen_unloaded"]
    summary = summarise(rows, metrics)
    write_csv(root / "runs.csv", rows)
    write_csv(root / "summary.csv", summary)
    write_csv(root / "visibility.csv", vis_rows)

    print(f"{len(rows)} runs in {root.relative_to(EXP_DIR.parent)}")
    print(f"{'app':5s} {'config':24s} {'n':>3s} {'TTFF s':>14s} {'load s':>8s} {'FTSD':>6s} {'MaxFT':>7s} "
          f"{'Top3':>6s} {'P99':>6s} {'1%low':>6s} {'miss%':>6s} {'inc.s':>6s} {'t/o':>3s}")
    for s in summary:
        ttff = s.get("ttff_ms_mean")
        print(f"{s['app']:5s} {s['config']:24s} {s['n']:3d} "
              f"{fmt(ttff and ttff / 1000, 2):>7s}±{fmt(s.get('ttff_ms_std') and s['ttff_ms_std'] / 1000, 2):<6s} "
              f"{fmt(s.get('load_ms_mean') and s['load_ms_mean'] / 1000, 2):>8s} "
              f"{fmt(s.get('ftsd_mean')):>6s} {fmt(s.get('max_ft_mean')):>7s} {fmt(s.get('top3_ft_mean')):>6s} "
              f"{fmt(s.get('p99_ft_mean')):>6s} {fmt(s.get('low1_fps_mean')):>6s} "
              f"{fmt(s.get('missed_ratio_mean') and 100 * s['missed_ratio_mean']):>6s} "
              f"{fmt(s.get('incomplete_ms_mean') and s['incomplete_ms_mean'] / 1000, 2):>6s} {s['timed_out']:3d}")

    prism = [s for s in summary if s["config"].startswith("prism-4g_") and "max_ft_mean" in s]
    if prism:
        print("\nbest chunk configuration per app (lowest mean MaxFT):")
        for app in sorted({s["app"] for s in prism}):
            best = min((s for s in prism if s["app"] == app), key=lambda s: s["max_ft_mean"])
            print(f"  {app}: {best['config']} (MaxFT {best['max_ft_mean']:.1f} ms)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
