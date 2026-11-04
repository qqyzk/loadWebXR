"""
Plot TTFF comparison (baseline vs PrismLoader) for 5 network conditions as a single combined figure.
Layout: 3 subplots on top row, 2 on bottom row, shared legend at bottom.
For thesis chap3 (single-column).
"""
from __future__ import annotations
import os
import sys

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _SCRIPT_DIR)

import openpyxl
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

plt.rcParams["font.family"] = "serif"
plt.rcParams["font.serif"] = ["Times New Roman", "DejaVu Serif"]
plt.rcParams["axes.unicode_minus"] = False

REPO_ROOT = os.path.dirname(os.path.dirname(_SCRIPT_DIR))
XLSX_PATH = os.path.join(REPO_ROOT, "results", "loadtime.xlsx")
OUT_PATH = os.path.join(REPO_ROOT, "load_webxr", "images", "loadreal_combined.png")

NETWORKS = ["5g", "4g", "slow", "3g", "192"]
NETWORK_DISPLAY = {"5g": "5G", "4g": "Fast 4G", "slow": "Slow 4G", "3g": "3G", "192": "Local Wifi"}
APP_DISPLAY = {"EllieTale": "ET", "Halloween": "HW", "Museum": "VM"}


def parse_ttff(val):
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip().replace(",", "")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def run():
    wb = openpyxl.load_workbook(XLSX_PATH, read_only=True, data_only=True)
    ws = wb["all"]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    headers = [str(h).strip().lower() if h is not None else "" for h in rows[0]]
    key_map = {}
    for i, h in enumerate(headers):
        h = (h or "").replace(" ", "_")
        if "app" in h:
            key_map["app_name"] = i
        elif "method" in h:
            key_map["method"] = i
        elif "run" in h:
            key_map["run_id"] = i
        elif "ttff" in h or "ms" in h:
            key_map["ttff_ms"] = i

    # Parse data: network -> app -> method -> ttff
    data = {}
    for row in rows[1:]:
        if not row:
            continue
        net = str(row[key_map["run_id"]]).strip()
        if net not in NETWORKS:
            continue
        app = str(row[key_map["app_name"]]).strip()
        method = str(row[key_map["method"]]).strip().lower()
        ttff = parse_ttff(row[key_map["ttff_ms"]])
        if ttff is None:
            continue
        method_key = "main" if "main" in method else "baseline"
        if net not in data:
            data[net] = {}
        if app not in data[net]:
            data[net][app] = {}
        data[net][app][method_key] = ttff

    app_order = ["EllieTale", "Halloween", "Museum"]

    # Create figure: 2x3 grid, last cell for legend
    fig, axes = plt.subplots(2, 3, figsize=(12, 7))
    axes[1, 2].set_visible(False)

    positions = [(0, 0), (0, 1), (0, 2), (1, 0), (1, 1)]

    for idx, net in enumerate(NETWORKS):
        r, c = positions[idx]
        ax = axes[r, c]
        app_data = data.get(net, {})
        apps = [a for a in app_order if a in app_data]

        x = np.arange(len(apps))
        width = 0.35
        baseline_vals = [app_data[app].get("baseline", 0) for app in apps]
        main_vals = [app_data[app].get("main", 0) for app in apps]
        labels = [APP_DISPLAY.get(a, a) for a in apps]

        ax.bar(x - width / 2, baseline_vals, width, label="Baseline", color="#1f77b4", hatch="///", alpha=0.9, edgecolor="black", linewidth=1.0)
        ax.bar(x + width / 2, main_vals, width, label="PrismLoader", color="#d62728", hatch="---", alpha=0.9, edgecolor="black", linewidth=1.0)
        ax.set_ylabel("TTFF (ms)", fontsize=14)
        ax.set_title(NETWORK_DISPLAY[net], fontsize=16, fontweight="bold")
        ax.set_xticks(x)
        ax.set_xticklabels(labels, fontsize=13)
        ax.tick_params(axis="y", labelsize=12)

    # Legend in the empty bottom-right cell, vertical
    handles, legend_labels = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles, legend_labels, loc="center", fontsize=14, frameon=True,
               bbox_to_anchor=(0.83, 0.25), ncol=1)

    plt.tight_layout()

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    fig.savefig(OUT_PATH, dpi=300, bbox_inches="tight")
    plt.close()
    print(f"Saved: {OUT_PATH}")


if __name__ == "__main__":
    run()
