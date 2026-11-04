"""
Plot TTFF comparison (baseline vs main) for 5G network condition from results/loadtime.xlsx.
Uses the "all" sheet only. Output: loadreal_5g.png with identical style to existing network plots.
"""
from __future__ import annotations

import os

try:
    import openpyxl
except ImportError:
    raise SystemExit("Install openpyxl: pip install openpyxl")

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np
except ImportError:
    raise SystemExit("Install matplotlib: pip install matplotlib")

plt.rcParams["font.family"] = "serif"
plt.rcParams["font.serif"] = ["Times New Roman", "DejaVu Serif"]
plt.rcParams["axes.unicode_minus"] = False

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
XLSX_PATH = os.path.join(REPO_ROOT, "results", "loadtime.xlsx")
OUT_DIR = os.path.join(REPO_ROOT, "load_webxr", "images")

APP_DISPLAY = {"EllieTale": "ET", "Halloween": "HW", "Museum": "VM"}


def parse_ttff(val) -> float | None:
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
        if "app" in h or h == "app_name":
            key_map["app_name"] = i
        elif "method" in h:
            key_map["method"] = i
        elif "run" in h or h == "run_id":
            key_map["run_id"] = i
        elif "ttff" in h or "ms" in h or h == "ttff_ms":
            key_map["ttff_ms"] = i

    data = {"baseline": {}, "main": {}}
    for row in rows[1:]:
        if not row:
            continue
        net = str(row[key_map["run_id"]]).strip()
        if net != "5g":
            continue
        app = str(row[key_map["app_name"]]).strip()
        method = str(row[key_map["method"]]).strip().lower()
        ttff = parse_ttff(row[key_map["ttff_ms"]])
        if ttff is None:
            continue
        method_key = "main" if "main" in method else "baseline"
        data[method_key][app] = ttff

    app_order = ["EllieTale", "Halloween", "Museum"]
    apps = [a for a in app_order if a in data["baseline"]]

    os.makedirs(OUT_DIR, exist_ok=True)

    fig, ax = plt.subplots(figsize=(4, 3.5))
    x = np.arange(len(apps))
    width = 0.35
    baseline_vals = [data["baseline"][app] for app in apps]
    main_vals = [data["main"][app] for app in apps]
    labels = [APP_DISPLAY.get(a, a) for a in apps]

    ax.bar(x - width / 2, baseline_vals, width, label="Baseline", color="#1f77b4", hatch="///", alpha=0.9, edgecolor="black", linewidth=1.0)
    ax.bar(x + width / 2, main_vals, width, label="PrismLoader", color="#d62728", hatch="---", alpha=0.9, edgecolor="black", linewidth=1.0)
    ax.set_ylabel("TTFF (ms)", fontsize=18)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=16)
    ax.legend(fontsize=14, frameon=True)
    ax.tick_params(axis="x", rotation=15, labelsize=14)
    ax.tick_params(axis="y", labelsize=14)
    plt.tight_layout()

    out_png = os.path.join(OUT_DIR, "loadreal_5g.png")
    fig.savefig(out_png, dpi=300, bbox_inches="tight")
    plt.close()
    print("Saved:", out_png)


if __name__ == "__main__":
    run()
