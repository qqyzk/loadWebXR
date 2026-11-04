#!/usr/bin/env python3
"""Export heterogeneity tables from loadtime.xlsx and smoth.xlsx (Local Wifi).
Run: .venv/bin/python code/export_hetero_tables.py
"""
from pathlib import Path
import openpyxl

root = Path(__file__).resolve().parent.parent
results_dir = root / "results"
loadtime_path = results_dir / "loadtime.xlsx"
smoth_path = results_dir / "smoth.xlsx"
summary_192_path = root / "code" / "visualize" / "results" / "summary_192.md"

# Config order: primary (192 = Pixel 6 + Chrome), firefox, safari, nova
CONFIG_LABELS = {
    "192": "Pixel~6 + Chrome",
    "firefox": "Pixel~6 + Firefox",
    "safari": "iPhone~12 + Safari",
    "nova": "Nova~3 + Chrome",
}
APP_MAP = {"EllieTale": "ET", "Halloween": "HW", "Museum": "VM"}


def load_ttff():
    """Load TTFF (ms), return dict (config, app, method) -> mean ttff_ms."""
    wb = openpyxl.load_workbook(loadtime_path, read_only=True, data_only=True)
    out = {}
    for sheet in ["192", "firefox", "safari", "nova"]:
        if sheet not in wb.sheetnames:
            continue
        ws = wb[sheet]
        rows = list(ws.iter_rows(values_only=True))
        # rows[0] = header: app_name, method, run_id, ttff_ms, ...
        by_key = {}  # (app, method) -> list of ttff_ms
        for r in rows[1:]:
            if not r or r[0] is None:
                continue
            app_name, method, run_id, ttff_ms = r[0], r[1], r[2], r[3]
            if ttff_ms is None:
                continue
            key = (app_name, method)
            by_key.setdefault(key, []).append(ttff_ms)
        for (app_name, method), vals in by_key.items():
            out[(sheet, app_name, method)] = sum(vals) / len(vals)
    wb.close()
    return out


def load_smooth():
    """Load FTSD, MaxFT, Top3-FT for PrismLoader.
    Pixel+Chrome (192) from summary_192.md; firefox, safari, nova from smoth.xlsx."""
    out = {}  # (config, app) -> (fstd, max_ft, avg_max_ft)
    # --- 192: from summary_192.md, min max_ft over prism, prism_20, prism_30, prism_50, no-chunk ---
    PRISM_NAMES_192 = ("prism", "prism_20", "prism_30", "prism_50", "no-chunk")
    if summary_192_path.exists():
        by_app = {}
        with open(summary_192_path) as f:
            for line in f:
                line = line.strip()
                if not line.startswith("|") or "|---" in line:
                    continue
                parts = [p.strip() for p in line.split("|") if p.strip()]
                if len(parts) < 6 or parts[0] not in PRISM_NAMES_192:
                    continue
                app_key = parts[1]
                try:
                    fstd, max_ft, avg_ft = float(parts[3]), float(parts[4]), float(parts[5])
                except (ValueError, IndexError):
                    continue
                app_name = {"tale": "EllieTale", "hallo": "Halloween", "mus": "Museum"}[app_key]
                by_app.setdefault(app_name, []).append((fstd, max_ft, avg_ft))
        for app_name, vals in by_app.items():
            best = min(vals, key=lambda x: x[1])
            out[("192", app_name)] = best
    # --- firefox, safari, nova: from smoth.xlsx, min max_ft over prism_50, prism_30, prism_20, no-chunk ---
    PRISM_NAMES_XLSX = ("prism_50", "prism_30", "prism_20", "no-chunk")
    wb = openpyxl.load_workbook(smoth_path, read_only=True, data_only=True)
    for sheet in ["firefox", "safari", "nova"]:
        if sheet not in wb.sheetnames:
            continue
        ws = wb[sheet]
        rows = list(ws.iter_rows(values_only=True))
        by_app = {}
        for r in rows[1:]:
            if not r or len(r) <= 4:
                continue
            name, app = r[0], r[1]
            if name not in PRISM_NAMES_XLSX:
                continue
            max_ft = r[3]
            if max_ft is None:
                continue
            fstd, avg_ft = r[2], r[4]
            app_name = {"tale": "EllieTale", "hallo": "Halloween", "mus": "Museum"}[app]
            by_app.setdefault(app_name, []).append((fstd, max_ft, avg_ft))
        for app_name, vals in by_app.items():
            best = min(vals, key=lambda x: x[1])
            out[(sheet, app_name)] = best
    wb.close()
    return out


def load_smooth_unthrottled():
    """Load MaxFT for Unthrottled (priority-only). 192 from summary_192.md; others from smoth.xlsx."""
    out = {}  # (config, app) -> max_ft
    if summary_192_path.exists():
        with open(summary_192_path) as f:
            for line in f:
                line = line.strip()
                if not line.startswith("|") or "|---" in line:
                    continue
                parts = [p.strip() for p in line.split("|") if p.strip()]
                if len(parts) < 5 or parts[0] != "priority-only":
                    continue
                app_key = parts[1]
                try:
                    max_ft = float(parts[4])
                except (ValueError, IndexError):
                    continue
                app_name = {"tale": "EllieTale", "hallo": "Halloween", "mus": "Museum"}[app_key]
                out[("192", app_name)] = max_ft
    wb = openpyxl.load_workbook(smoth_path, read_only=True, data_only=True)
    for sheet in ["firefox", "safari", "nova"]:
        if sheet not in wb.sheetnames:
            continue
        ws = wb[sheet]
        rows = list(ws.iter_rows(values_only=True))
        for r in rows[1:]:
            if not r or len(r) <= 3:
                continue
            if r[0] != "priority-only":
                continue
            max_ft = r[3]
            if max_ft is None:
                continue
            app_name = {"tale": "EllieTale", "hallo": "Halloween", "mus": "Museum"}[r[1]]
            out[(sheet, app_name)] = max_ft
    wb.close()
    return out


def main():
    ttff = load_ttff()
    smooth = load_smooth()
    unthrottled = load_smooth_unthrottled()

    apps = ["EllieTale", "Halloween", "Museum"]
    app_short = {"EllieTale": "ET", "Halloween": "HW", "Museum": "VM"}
    configs = ["192", "firefox", "safari", "nova"]

    # --- Table 1: TTFF per app (Baseline, PrismLoader, % per row) ---
    print("=== TTFF table (per app), s + change % per app ===\n")
    for config in configs:
        label = CONFIG_LABELS[config].replace("~", " ")
        for i, app in enumerate(apps):
            b_ms = ttff.get((config, app, "baseline"))
            m_ms = ttff.get((config, app, "main"))
            if b_ms is not None and m_ms is not None:
                b_s = round(b_ms / 1000, 2)
                m_s = round(m_ms / 1000, 2)
                pct = round((m_ms - b_ms) / b_ms * 100)
                pct_s = f"(${pct}$\\,\\%)" if pct <= 0 else f"(+{pct}\\,\\%)"
            else:
                b_s = m_s = "--"
                pct_s = "--"
            config_cell = f"\\multirow{{3}}{{*}}{{{label}}}" if i == 0 else ""
            app_cell = app_short[app]
            print(f"  {config_cell} & {app_cell} & {b_s} & {m_s} {pct_s} \\\\")
        print("  \\midrule")

    # --- Table 2: MaxFT per app (Unthrottled, PrismLoader, % per row) ---
    print("\n=== MaxFT table (per app), ms + change % per app ===\n")
    for config in configs:
        label = CONFIG_LABELS[config].replace("~", " ")
        for i, app in enumerate(apps):
            u_ft = unthrottled.get((config, app))
            p_vals = smooth.get((config, app))
            p_ft = p_vals[1] if p_vals else None
            if u_ft is not None and p_ft is not None:
                u_s = round(u_ft, 1)
                p_s = round(p_ft, 1)
                pct = round((p_ft - u_ft) / u_ft * 100)
                pct_s = f"(${pct}$\\,\\%)" if pct <= 0 else f"(+{pct}\\,\\%)"
            else:
                u_s = p_s = "--"
                pct_s = "--"
            config_cell = f"\\multirow{{3}}{{*}}{{{label}}}" if i == 0 else ""
            app_cell = app_short[app]
            print(f"  {config_cell} & {app_cell} & {u_s} & {p_s} {pct_s} \\\\")
        print("  \\midrule")


if __name__ == "__main__":
    main()
