#!/usr/bin/env python3
"""Read loadtime and smoth xlsx to inspect structure for heterogeneity tables.
Run: python3.12 code/read_hetero_results.py   (requires: pip install openpyxl or pandas)
"""
import sys
from pathlib import Path

def read_with_pandas(path):
    import pandas as pd
    xl = pd.ExcelFile(path)
    out = []
    for sheet in xl.sheet_names:
        df = pd.read_excel(path, sheet_name=sheet)
        out.append((sheet, df))
    return out

def read_with_openpyxl(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    out = []
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        out.append((sheet_name, rows))
    wb.close()
    return out

root = Path(__file__).resolve().parent.parent
results_dir = root / "results"
loadtime_path = results_dir / "loadtime.xlsx"
smoth_path = results_dir / "smoth.xlsx"

try:
    import pandas as pd
    use_pandas = True
except ImportError:
    use_pandas = False
    try:
        import openpyxl
    except ImportError:
        print("Install: pip install openpyxl  or  pip install pandas openpyxl")
        sys.exit(1)

for name, path in [("loadtime", loadtime_path), ("smoth", smoth_path)]:
    if not path.exists():
        print(f"{name}: NOT FOUND at {path}")
        continue
    print(f"\n=== {name}.xlsx ===")
    if use_pandas:
        for sheet_name, df in read_with_pandas(path):
            print(f"  Sheet: {sheet_name}")
            print(df.head(15).to_string())
            print(f"  shape: {df.shape}")
    else:
        for sheet_name, rows in read_with_openpyxl(path):
            print(f"  Sheet: {sheet_name}")
            for i, row in enumerate(rows[:12]):
                print(f"    {i}: {row}")
            if len(rows) > 12:
                print(f"    ... ({len(rows)} rows total)")
