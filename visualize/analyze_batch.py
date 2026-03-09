"""
Batch fluency analysis: tale, hallo, mus × prism variants (prism_20/30/50), no-chunk, priority-only × 192, 4g, slow, 3g.
Uses analyze_fluency.load_frames + compute_metrics.
Output: one table file per network condition under visualize/results/.
Adds a row "prism" = best by max_ft among prism_20, prism_30, prism_50.
"""
import os
import sys

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(_SCRIPT_DIR, "data")
RESULTS_DIR = os.path.join(_SCRIPT_DIR, "results")

# Import single-file analysis
sys.path.insert(0, _SCRIPT_DIR)
from analyze_fluency import load_frames, compute_metrics

APPS = ["tale", "hallo", "mus"]
NETWORKS = ["192", "4g", "slow", "3g"]

# Prism chunk variants to consider; file pattern: prism_{network}_{exp}
PRISM_EXPANSIONS = [20, 30, 50]

# File prefix -> display name; file is {prefix}_{network} (no extension or .json). prism variants use prism_{network}_{exp}.
STRATEGY_PREFIXES = [
    ("no", "no-chunk"),
    ("priority", "priority-only"),
]


def _find_data_file(app: str, strategy_prefix: str, network: str) -> str | None:
    """Return path to data file for app/strategy/network, or None if missing."""
    base = os.path.join(DATA_DIR, app, f"{strategy_prefix}_{network}")
    for path in (base, base + ".json"):
        if os.path.isfile(path):
            return path
    return None


def _find_prism_expansion_file(app: str, network: str, expansion: int) -> str | None:
    """Return path to prism_{network}_{expansion} data file, or None if missing."""
    base = os.path.join(DATA_DIR, app, f"prism_{network}_{expansion}")
    for path in (base, base + ".json"):
        if os.path.isfile(path):
            return path
    return None


def _metrics_for_file(filepath: str) -> dict | None:
    """Load file and return metrics dict (fps, fstd, max_ft, avg_max_ft) or None on error."""
    try:
        parsed = load_frames(filepath)
        m = compute_metrics(parsed)
        return {
            "fps": m["avg_fps"],
            "fstd": m["ftsd_ms"],
            "max_ft": m["max_ft_ms"],
            "avg_max_ft": m["top3_avg_ft_ms"],
        }
    except Exception:
        return None


def _change(baseline: float, value: float) -> str:
    if baseline is None or baseline == 0:
        return ""
    return f"{(value - baseline) / baseline:.7g}"


def collect_network_data(network: str) -> list[dict]:
    """
    For one network, collect one row per (strategy_name, app).
    Prism variants: prism_20, prism_30, prism_50 (from prism_{network}_20 etc.); plus synthetic "prism" = best by max_ft among those.
    Row order per app: prism (best), prism_20, prism_30, prism_50, no-chunk, priority-only.
    """
    rows = []
    for app in APPS:
        # Prism expansion variants
        prism_variant_rows = []
        for exp in PRISM_EXPANSIONS:
            path = _find_prism_expansion_file(app, network, exp)
            name = f"prism_{exp}"
            if path is None:
                prism_variant_rows.append({"name": name, "app": app, "fps": None, "fstd": None, "max_ft": None, "avg_max_ft": None})
                continue
            metrics = _metrics_for_file(path)
            if metrics is None:
                prism_variant_rows.append({"name": name, "app": app, "fps": None, "fstd": None, "max_ft": None, "avg_max_ft": None})
                continue
            prism_variant_rows.append({
                "name": name,
                "app": app,
                "fps": metrics["fps"],
                "fstd": metrics["fstd"],
                "max_ft": metrics["max_ft"],
                "avg_max_ft": metrics["avg_max_ft"],
            })
        # Best prism by max_ft (smaller is better)
        valid = [r for r in prism_variant_rows if r.get("max_ft") is not None]
        if valid:
            best = min(valid, key=lambda r: r["max_ft"])
            prism_best_row = {
                "name": "prism",
                "app": app,
                "fps": best["fps"],
                "fstd": best["fstd"],
                "max_ft": best["max_ft"],
                "avg_max_ft": best["avg_max_ft"],
            }
            rows.append(prism_best_row)
        else:
            rows.append({"name": "prism", "app": app, "fps": None, "fstd": None, "max_ft": None, "avg_max_ft": None})
        rows.extend(prism_variant_rows)
        # no-chunk, priority-only
        for prefix, name in STRATEGY_PREFIXES:
            path = _find_data_file(app, prefix, network)
            if path is None:
                rows.append({"name": name, "app": app, "fps": None, "fstd": None, "max_ft": None, "avg_max_ft": None})
                continue
            metrics = _metrics_for_file(path)
            if metrics is None:
                rows.append({"name": name, "app": app, "fps": None, "fstd": None, "max_ft": None, "avg_max_ft": None})
                continue
            rows.append({
                "name": name,
                "app": app,
                "fps": metrics["fps"],
                "fstd": metrics["fstd"],
                "max_ft": metrics["max_ft"],
                "avg_max_ft": metrics["avg_max_ft"],
            })
    return rows


def add_change_columns(rows: list[dict]) -> None:
    """In-place: for each app, set fstd_change, max_ft_change, avg_max_ft_change relative to priority-only."""
    for app in APPS:
        app_rows = [r for r in rows if r["app"] == app]
        base = next((r for r in app_rows if r["name"] == "priority-only"), None)
        if base is None:
            continue
        b_fstd = base.get("fstd")
        b_max = base.get("max_ft")
        b_avg_max = base.get("avg_max_ft")
        for r in app_rows:
            if r["name"] == "priority-only":
                r["fstd_change"] = ""
                r["max_ft_change"] = ""
                r["avg_max_ft_change"] = ""
            else:
                r["fstd_change"] = _change(b_fstd, r["fstd"]) if r.get("fstd") is not None else ""
                r["max_ft_change"] = _change(b_max, r["max_ft"]) if r.get("max_ft") is not None else ""
                r["avg_max_ft_change"] = _change(b_avg_max, r["avg_max_ft"]) if r.get("avg_max_ft") is not None else ""


def format_table(rows: list[dict]) -> str:
    """Produce markdown table: | name | app | fps | fstd | max_ft | avg_max_ft | fstd_change | max_ft_change | avg_max_ft_change |."""
    lines = [
        "| name | app | fps | fstd | max_ft | avg_max_ft | fstd_change | max_ft_change | avg_max_ft_change |",
        "| ---- | --- | --- | ---- | ------ | ---------- | ----------- | ------------- | ----------------- |",
    ]
    for r in rows:
        fps = r.get("fps") if r.get("fps") is not None else ""
        fstd = r.get("fstd") if r.get("fstd") is not None else ""
        max_ft = r.get("max_ft") if r.get("max_ft") is not None else ""
        avg_max_ft = r.get("avg_max_ft") if r.get("avg_max_ft") is not None else ""
        fps_s = f"{fps}" if isinstance(fps, (int, float)) else str(fps)
        fstd_s = f"{fstd}" if isinstance(fstd, (int, float)) else str(fstd)
        max_s = f"{max_ft}" if isinstance(max_ft, (int, float)) else str(max_ft)
        avg_s = f"{avg_max_ft}" if isinstance(avg_max_ft, (int, float)) else str(avg_max_ft)
        lines.append(
            f"| {r['name']} | {r['app']} | {fps_s} | {fstd_s} | {max_s} | {avg_s} | "
            f"{r.get('fstd_change', '')} | {r.get('max_ft_change', '')} | {r.get('avg_max_ft_change', '')} |"
        )
    return "\n".join(lines)


def main():
    os.makedirs(RESULTS_DIR, exist_ok=True)
    for network in NETWORKS:
        rows = collect_network_data(network)
        if not any(r.get("fps") is not None for r in rows):
            print(f"Skip {network}: no data", file=sys.stderr)
            continue
        add_change_columns(rows)
        out_path = os.path.join(RESULTS_DIR, f"summary_{network}.md")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(format_table(rows))
        print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
