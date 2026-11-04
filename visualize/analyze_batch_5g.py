"""
Batch fluency analysis for 5G only.
Same logic as analyze_batch.py but only processes the "5g" network.
Output: results/summary_5g.md (does not touch other summary files).
"""
import os
import sys

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _SCRIPT_DIR)
from analyze_batch import collect_network_data, add_change_columns, format_table

RESULTS_DIR = os.path.join(_SCRIPT_DIR, "results")

def main():
    os.makedirs(RESULTS_DIR, exist_ok=True)
    rows = collect_network_data("5g")
    if not any(r.get("fps") is not None for r in rows):
        print("No 5g data found", file=sys.stderr)
        sys.exit(1)
    add_change_columns(rows)
    out_path = os.path.join(RESULTS_DIR, "summary_5g.md")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(format_table(rows))
    print(f"Wrote {out_path}")

if __name__ == "__main__":
    main()
