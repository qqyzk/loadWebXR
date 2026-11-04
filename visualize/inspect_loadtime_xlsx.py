"""
Inspect results/loadtime.xlsx: sheet names and first rows.
Run: python3.12 code/visualize/inspect_loadtime_xlsx.py
Requires: pip install openpyxl  (e.g. in a venv: python3.12 -m venv .venv && .venv/bin/pip install openpyxl)
"""
import os
import sys

try:
    import openpyxl
except ImportError:
    print("Install openpyxl: pip install openpyxl", file=sys.stderr)
    sys.exit(1)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
XLSX_PATH = os.path.join(REPO_ROOT, "results", "loadtime.xlsx")

def main():
    if not os.path.isfile(XLSX_PATH):
        print("File not found:", XLSX_PATH)
        return
    wb = openpyxl.load_workbook(XLSX_PATH, read_only=True, data_only=True)
    print("Sheet names:", wb.sheetnames)
    for name in wb.sheetnames:
        ws = wb[name]
        rows = list(ws.iter_rows(values_only=True))[:12]
        print(f"\n--- Sheet: {name} ({len(rows)} rows shown) ---")
        for i, row in enumerate(rows):
            print(i, row)
    wb.close()

if __name__ == "__main__":
    main()
