"""
Plot TTFF comparison (baseline vs main) for four network conditions from results/loadtime.xlsx.
Uses the "all" sheet only: columns app_name, method, run_id, ttff_ms where run_id is the network (192, 4g, slow, 3g).
Output: 4 separate PNGs (loadreal_4g.png, loadreal_slow.png, loadreal_3g.png, loadreal_192.png) for LaTeX subfigure layout.
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

# Font sizes aligned with results/analysis/plot_simulation and plot_ttff (larger for readability)
plt.rcParams["font.family"] = "serif"
plt.rcParams["font.serif"] = ["Times New Roman", "DejaVu Serif"]
plt.rcParams["axes.unicode_minus"] = False

# Paths
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
XLSX_PATH = os.path.join(REPO_ROOT, "results", "loadtime.xlsx")
OUT_DIR = os.path.join(REPO_ROOT, "load_webxr", "images")
# Order for subplots: 4g, slow, 3g, 192
NETWORKS = ["4g", "slow", "3g", "192"]
NETWORK_DISPLAY = {"4g": "Fast 4G", "slow": "Slow 4G", "3g": "3G", "192": "Local Wifi"}
# Short labels for figure (ET, HW, VM); paper explains abbreviations in real-case section
APP_DISPLAY = {"EllieTale": "ET", "Halloween": "HW", "Museum": "VM"}


def parse_ttff(val) -> float | None:
    """Parse ttff_ms: may be number or string like '8,785' or '8317.60'."""
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


def read_sheet(ws) -> list[dict]:
    """Read sheet into list of dicts; first row = headers."""
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
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
    if "app_name" not in key_map or "method" not in key_map or "ttff_ms" not in key_map:
        return []
    data = []
    for row in rows[1:]:
        if not row:
            continue
        app = row[key_map["app_name"]] if key_map["app_name"] < len(row) else None
        method = row[key_map["method"]] if key_map["method"] < len(row) else None
        ttff = parse_ttff(row[key_map["ttff_ms"]] if key_map["ttff_ms"] < len(row) else None)
        if app is None or method is None or ttff is None:
            continue
        rec = {"app_name": str(app).strip(), "method": str(method).strip().lower(), "ttff_ms": ttff}
        if "run_id" in key_map and key_map["run_id"] < len(row):
            rec["run_id"] = row[key_map["run_id"]]
        data.append(rec)
    return data


def aggregate_mean(records: list[dict]) -> dict[str, dict[str, dict[str, float]]]:
    """Aggregate: network -> app_name -> method -> mean_ttff (or single value)."""
    out = {}
    for r in records:
        net = str(r.get("run_id", "")).strip()
        if net not in NETWORKS:
            continue
        if net not in out:
            out[net] = {}
        app = r["app_name"]
        if app not in out[net]:
            out[net][app] = {"baseline": [], "main": []}
        method = "main" if "main" in r["method"] else "baseline"
        out[net][app][method].append(r["ttff_ms"])
    result = {}
    for net, apps in out.items():
        result[net] = {}
        for app, methods in apps.items():
            result[net][app] = {}
            for method, vals in methods.items():
                result[net][app][method] = sum(vals) / len(vals) if vals else 0.0
    return result


def run():
    wb = openpyxl.load_workbook(XLSX_PATH, read_only=True, data_only=True)
    if "all" not in wb.sheetnames:
        wb.close()
        raise SystemExit('Sheet "all" not found in workbook.')
    ws = wb["all"]
    all_records = read_sheet(ws)
    wb.close()
    if not all_records:
        raise SystemExit("No data found in sheet 'all'.")
    for r in all_records:
        r["run_id"] = str(r.get("run_id", "")).strip()
    agg = aggregate_mean(all_records)
    # Order: 4g, slow, 3g, 192 (same as NETWORKS for LaTeX subfigure order)
    panels = [(n, agg[n]) for n in NETWORKS if n in agg]
    if not panels:
        raise SystemExit("No data for any of 4g, slow, 3g, 192 in sheet 'all'.")

    app_order = ["EllieTale", "Halloween", "Museum"]
    os.makedirs(OUT_DIR, exist_ok=True)

    for idx, (net_label, app_data) in enumerate(panels):
        fig, ax = plt.subplots(figsize=(4, 3.5))
        apps = [a for a in app_order if a in app_data]
        if not apps:
            apps = sorted(app_data.keys())
        x = np.arange(len(apps))
        width = 0.35
        baseline_vals = [app_data[app].get("baseline", 0) for app in apps]
        main_vals = [app_data[app].get("main", 0) for app in apps]
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
        out_png = os.path.join(OUT_DIR, f"loadreal_{net_label}.png")
        fig.savefig(out_png, dpi=300, bbox_inches="tight")
        plt.close()
        print("Saved:", out_png)


if __name__ == "__main__":
    run()
