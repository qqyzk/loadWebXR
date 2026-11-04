"""
Plot frame time vs time for tale 4G: PrismLoader vs Unthrottled (priority-only),
with aligned y-axis for fair comparison. Optionally include W/o chunk (no-chunk).

Output: code/visualize/images/tale/frame_time_4g_comparison.png
Run: python3.12 plot_frame_time_comparison.py [--no-chunk]
"""
import argparse
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(_SCRIPT_DIR, "data")
IMAGES_DIR = os.path.join(_SCRIPT_DIR, "images")

sys.path.insert(0, _SCRIPT_DIR)
from analyze_fluency import load_frames, FPS_REF_MS


def _moving_average(arr: np.ndarray, window: int) -> np.ndarray:
    """Uniform moving average, same length as input (mode='same', edge values extended)."""
    if window <= 1 or len(arr) == 0:
        return arr
    kernel = np.ones(window) / window
    return np.convolve(arr, kernel, mode="same")


def _find_file(app: str, name: str) -> str | None:
    """Return path to data file (no extension or .json)."""
    for path in (
        os.path.join(DATA_DIR, app, name),
        os.path.join(DATA_DIR, app, name + ".json"),
    ):
        if os.path.isfile(path):
            return path
    return None


def plot_one(ax, parsed, title: str, color: str = "C0", show_loading_end: bool = True):
    """Draw time vs frame time on ax. Optional 60 FPS ref and loading-complete line."""
    time_ms = np.array(parsed["time_ms"], dtype=float)
    frame_times = np.array(parsed["frame_times_ms"], dtype=float)
    ax.plot(time_ms, frame_times, color=color, linewidth=1, label="Frame time (ms)")

    if (
        parsed["format"] == "performance"
        and show_loading_end
        and parsed["loading_end_index"] is not None
    ):
        idx = parsed["loading_end_index"]
        if idx < len(time_ms):
            ax.axvline(
                x=time_ms[idx],
                color="gray",
                linestyle="--",
                linewidth=1,
                alpha=0.8,
                label="Loading complete",
            )
    ax.axhline(
        y=FPS_REF_MS,
        color="red",
        linestyle=":",
        linewidth=1,
        alpha=0.6,
        label=f"60 FPS ({FPS_REF_MS} ms)",
    )
    ax.set_xlabel("Time (ms)")
    ax.set_ylabel("Frame time (ms)")
    ax.set_title(title)
    ax.grid(True, alpha=0.3)
    ax.legend(loc="upper right", fontsize=8)


def main():
    parser = argparse.ArgumentParser(description="Frame time comparison: tale 4G")
    parser.add_argument(
        "--no-chunk",
        action="store_true",
        help="Add a third subplot for W/o chunk (no-chunk)",
    )
    parser.add_argument(
        "--one-figure",
        action="store_true",
        help="Plot all series in one figure (one axes) instead of subplots",
    )
    parser.add_argument(
        "--truncate",
        action="store_true",
        help="Truncate all series to the shortest time (same time range for fair comparison)",
    )
    parser.add_argument(
        "--smooth",
        type=int,
        default=None,
        metavar="WINDOW",
        help="Smooth frame time with moving average of WINDOW points (e.g. 10)",
    )
    args = parser.parse_args()

    app = "tale"
    network = "4g"

    # Paths: prism_4g_50 (PrismLoader), priority_4g (Unthrottled), optional no_4g
    prism_path = _find_file(app, f"prism_{network}_50")
    priority_path = _find_file(app, f"priority_{network}")
    no_path = _find_file(app, f"no_{network}") if args.no_chunk else None

    if not prism_path or not priority_path:
        print("Missing data files. Need tale/prism_4g_50 and tale/priority_4g under data/")
        sys.exit(1)

    prism = load_frames(prism_path)
    priority = load_frames(priority_path)
    no_parsed = load_frames(no_path) if no_path else None

    # Optionally truncate all series to shortest time range
    if args.truncate and args.one_figure:
        series = [(prism, "prism"), (priority, "priority")]
        if no_parsed and no_parsed["frame_times_ms"]:
            series.append((no_parsed, "no"))
        min_end_time = min(
            max(p["time_ms"]) for p, _ in series if p and p["time_ms"]
        )
        def truncate(parsed):
            if not parsed or not parsed["time_ms"]:
                return parsed
            t = np.array(parsed["time_ms"])
            ft = np.array(parsed["frame_times_ms"])
            mask = t <= min_end_time
            return {
                **parsed,
                "time_ms": t[mask].tolist(),
                "frame_times_ms": ft[mask].tolist(),
            }
        prism = truncate(prism)
        priority = truncate(priority)
        if no_parsed:
            no_parsed = truncate(no_parsed)

    # Optionally smooth frame_times_ms (moving average)
    if args.smooth is not None and args.smooth > 1:
        def smooth_parsed(parsed):
            if not parsed or not parsed["frame_times_ms"]:
                return parsed
            ft = np.array(parsed["frame_times_ms"], dtype=float)
            return {**parsed, "frame_times_ms": _moving_average(ft, args.smooth).tolist()}
        prism = smooth_parsed(prism)
        priority = smooth_parsed(priority)
        if no_parsed:
            no_parsed = smooth_parsed(no_parsed)

    # Shared y-axis: use same ylim for all (0 to max across all series + margin)
    all_ft = []
    for p in (prism, priority, no_parsed) if no_parsed else (prism, priority):
        if p and p["frame_times_ms"]:
            all_ft.extend(p["frame_times_ms"])
    y_max = max(all_ft) * 1.05 if all_ft else 100
    y_lim = (0, max(y_max, FPS_REF_MS * 1.5))

    if args.one_figure:
        # Single axes: all series overlaid. Legend order: PrismLoader, W/o chunk, Unthrottled.
        # PrismLoader red #d62728 (same as results/analysis/plot_ttff.py)
        fig, ax = plt.subplots(figsize=(10, 3.5))
        ax.plot(
            np.array(prism["time_ms"]),
            np.array(prism["frame_times_ms"]),
            color="#d62728",
            linewidth=1,
            label="PrismLoader",
        )
        if no_parsed and no_parsed["frame_times_ms"]:
            ax.plot(
                np.array(no_parsed["time_ms"]),
                np.array(no_parsed["frame_times_ms"]),
                color="#1f77b4",
                linewidth=1,
                label="W/o chunk",
            )
        ax.plot(
            np.array(priority["time_ms"]),
            np.array(priority["frame_times_ms"]),
            color="#2ca02c",
            linewidth=1,
            label="Unthrottled",
        )
        ax.set_ylim(y_lim)
        ax.set_xlabel("Time (ms)", fontsize=14)
        ax.set_ylabel("Frame time (ms)", fontsize=14)
        ax.legend(fontsize=12)
        ax.tick_params(axis="both", labelsize=12)
        ax.grid(True, alpha=0.3)
    else:
        # Subplots with shared y-axis (aligned ordinate)
        n_plots = 3 if no_parsed else 2
        fig, axes = plt.subplots(1, n_plots, figsize=(5 * n_plots, 4), sharey=True)
        if n_plots == 1:
            axes = [axes]
        plot_one(axes[0], prism, "PrismLoader", color="C0")
        axes[0].set_ylim(y_lim)
        plot_one(axes[1], priority, "Unthrottled", color="C1")
        axes[1].set_ylim(y_lim)
        if n_plots == 3 and no_parsed:
            plot_one(axes[2], no_parsed, "W/o chunk", color="C2")
            axes[2].set_ylim(y_lim)

    out_dir = os.path.join(IMAGES_DIR, app)
    os.makedirs(out_dir, exist_ok=True)
    out_name = "frame_time_4g_comparison"
    if args.no_chunk:
        out_name += "_with_nochunk"
    if args.one_figure:
        out_name += "_one"
    if args.truncate:
        out_name += "_truncated"
    if args.smooth is not None and args.smooth > 1:
        out_name += f"_smoothed{args.smooth}"
    out_path = os.path.join(out_dir, out_name + ".png")
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved: {out_path}")


if __name__ == "__main__":
    main()
