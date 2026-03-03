"""
Web3D loading fluency analysis: supports performance (no-chunk) and profile (ellie-profile) JSON formats.
Computes Average FPS, FTSD, MaxFT, stutter count; plots time vs frame time.
"""
import json
import os
import sys
import numpy as np
import matplotlib.pyplot as plt

# Metrics are computed over the loading phase: performance uses allAssetsLoaded==False; profile uses all frames.
# First SKIP_FIRST_N_FRAMES are excluded from all metric calculations.
FPS_REF_MS = 16.7  # 60 FPS reference line (ms)
STUTTER_PERCENT_ABOVE_REF = 0.3  # Frame time above this fraction over FPS_REF_MS is counted as stutter (e.g. 0.3 = 30%)
SKIP_FIRST_N_FRAMES = 3  # Exclude this many frames from the start when computing metrics
IMAGES_DIR = os.path.join(os.path.dirname(__file__), "images")


def _detect_format(data):
    """Detect JSON format from first record. Returns 'performance' or 'profile'."""
    if not data or not isinstance(data, list):
        raise ValueError("JSON must be a non-empty array")
    first = data[0]
    if isinstance(first, dict):
        if "delta" in first and "allAssetsLoaded" in first:
            return "performance"
        if "frameDurationMs" in first and "frameStart" in first:
            return "profile"
    raise ValueError("Unrecognized JSON format; expected performance (no-chunk) or profile (ellie-profile) structure")


def load_frames(filepath):
    """
    Load JSON, auto-detect format, return unified structure for metrics and plotting.
    Returns:
        dict: {
            "format": "performance" | "profile",
            "frame_times_ms": list[float],
            "time_ms": list[float],
            "loading_end_index": int | None  # only for performance: frame index where loading completes (for vertical line)
        }
    """
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    fmt = _detect_format(data)

    if fmt == "performance":
        frame_times = [float(x["delta"]) for x in data]
        all_loaded = [x["allAssetsLoaded"] for x in data]
        time_ms = np.cumsum([0.0] + frame_times[:-1]).tolist()
        loading_end = None
        for i, loaded in enumerate(all_loaded):
            if loaded:
                loading_end = i
                break
        return {
            "format": "performance",
            "frame_times_ms": frame_times,
            "time_ms": time_ms,
            "loading_end_index": loading_end,
        }

    # profile: only priority 2 and 3 (drop priority 1); only frames with lastTrueRenderTimeMs; frame time = lastTrueRenderTimeMs
    data = [x for x in data if x.get("priority") in (2, 3) and "lastTrueRenderTimeMs" in x]
    if not data:
        return {
            "format": "profile",
            "frame_times_ms": [],
            "time_ms": [],
            "loading_end_index": None,
        }
    frame_times = [float(x["lastTrueRenderTimeMs"]) for x in data]
    t0 = float(data[0]["frameStart"])
    time_ms = [float(x["frameStart"]) - t0 for x in data]
    return {
        "format": "profile",
        "frame_times_ms": frame_times,
        "time_ms": time_ms,
        "loading_end_index": None,
    }


def get_loading_phase_frame_times(parsed):
    """
    Return frame times used for metrics (loading phase), excluding the first SKIP_FIRST_N_FRAMES.
    performance: only frames with allAssetsLoaded==False; profile: all frames.
    """
    if parsed["format"] == "performance":
        end = parsed["loading_end_index"]
        if end is None:
            raw = parsed["frame_times_ms"]
        else:
            raw = parsed["frame_times_ms"][:end]
    else:
        raw = parsed["frame_times_ms"]
    if len(raw) <= SKIP_FIRST_N_FRAMES:
        return []
    return raw[SKIP_FIRST_N_FRAMES:]


def compute_metrics(parsed):
    """
    Compute Average FPS, FTSD, MaxFT, stutter count, stutter_pct (over loading phase, first SKIP_FIRST_N_FRAMES excluded).
    FTSD has the same unit as frame time (ms). Stutter: frame time > FPS_REF_MS * (1 + STUTTER_PERCENT_ABOVE_REF).
    Returns: dict with keys avg_fps, ftsd_ms, max_ft_ms, n_frames, stutter_count, stutter_pct
    """
    ft = get_loading_phase_frame_times(parsed)
    if not ft:
        return {"avg_fps": 0.0, "ftsd_ms": 0.0, "max_ft_ms": 0.0, "n_frames": 0, "stutter_count": 0, "stutter_pct": 0.0}
    arr = np.array(ft, dtype=float)
    n_frames = len(ft)
    mean_ms = float(np.mean(arr))
    avg_fps = 1000.0 / mean_ms if mean_ms > 0 else 0.0
    ftsd_ms = float(np.std(arr))  # same unit as frame time (ms)
    max_ft_ms = float(np.max(arr))
    stutter_threshold_ms = FPS_REF_MS * (1.0 + STUTTER_PERCENT_ABOVE_REF)
    stutter_count = int(np.sum(arr > stutter_threshold_ms))
    stutter_pct = round(100.0 * stutter_count / n_frames, 2) if n_frames else 0.0
    return {
        "avg_fps": round(avg_fps, 2),
        "ftsd_ms": round(ftsd_ms, 2),
        "max_ft_ms": round(max_ft_ms, 2),
        "n_frames": n_frames,
        "stutter_count": stutter_count,
        "stutter_pct": stutter_pct,
    }


def plot_frame_times(parsed, title=None, show_loading_end=True, ax=None):
    """
    Plot time (ms) vs frame time (ms).
    If ax is None, create new figure; otherwise draw on given ax.
    Returns matplotlib figure.
    """
    time_ms = parsed["time_ms"]
    frame_times = parsed["frame_times_ms"]
    if ax is None:
        fig, ax = plt.subplots(figsize=(12, 6))
    else:
        fig = ax.figure

    ax.plot(time_ms, frame_times, color="blue", linewidth=1, label="Frame time (ms)")

    if parsed["format"] == "performance" and show_loading_end and parsed["loading_end_index"] is not None:
        idx = parsed["loading_end_index"]
        if idx < len(time_ms):
            ax.axvline(
                x=time_ms[idx],
                color="gray",
                linestyle="--",
                linewidth=1.5,
                label="Loading complete",
            )
    ax.axhline(
        y=FPS_REF_MS,
        color="red",
        linestyle=":",
        linewidth=1.5,
        alpha=0.7,
        label=f"60 FPS ({FPS_REF_MS} ms)",
    )
    ax.set_xlabel("Time (ms)", fontsize=12)
    ax.set_ylabel("Frame time (ms)", fontsize=12)
    if title:
        ax.set_title(title, fontsize=14)
    ax.grid(True, alpha=0.3)
    ax.legend()
    return fig


def analyze_file(
    filepath,
    save_plot=True,
    images_dir=IMAGES_DIR,
    show_plot=False,
):
    """
    Load one JSON file, compute metrics, optionally save/show plot.
    filepath: path to JSON file
    save_plot: whether to save figure to images_dir
    images_dir: directory for saved images (default visualize/images)
    show_plot: whether to show plot window
    Returns: (parsed, metrics)
    """
    parsed = load_frames(filepath)
    metrics = compute_metrics(parsed)

    basename = os.path.splitext(os.path.basename(filepath))[0]
    title = f"Frame time — {basename}"

    if save_plot:
        os.makedirs(images_dir, exist_ok=True)
        out_path = os.path.join(images_dir, f"{basename}.png")
        fig = plot_frame_times(parsed, title=title)
        fig.savefig(out_path, dpi=150, bbox_inches="tight")
        plt.close(fig)

    if show_plot:
        plot_frame_times(parsed, title=title)
        plt.show()

    return parsed, metrics


def main():
    if len(sys.argv) < 2:
        print("Usage: python analyze_fluency.py <json_path> [--show]")
        print("  --show  also display the plot (default: only save to images/)")
        sys.exit(1)
    filepath = sys.argv[1]
    show = "--show" in sys.argv
    if not os.path.isfile(filepath):
        print(f"File not found: {filepath}")
        sys.exit(2)
    parsed, metrics = analyze_file(filepath, save_plot=True, show_plot=show)
    print(f"Format: {parsed['format']}")
    print(f"Average FPS: {metrics['avg_fps']}")
    print(f"FTSD (ms):   {metrics['ftsd_ms']}")
    print(f"MaxFT (ms):  {metrics['max_ft_ms']}")
    print(f"Stutter count (>{FPS_REF_MS * (1 + STUTTER_PERCENT_ABOVE_REF):.1f} ms): {metrics['stutter_count']}")
    print(f"Stutter pct: {metrics['stutter_pct']}%")
    print(f"Frames (loading phase): {metrics['n_frames']}")
    basename = os.path.splitext(os.path.basename(filepath))[0]
    print(f"Plot saved: {os.path.join(IMAGES_DIR, basename + '.png')}")


if __name__ == "__main__":
    main()
