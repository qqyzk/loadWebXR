#!/usr/bin/env bash
#
# Build one A-Frame bundle per loader variant into experiment/bundles/.
#
#   experiment/bundles/my-aframe-<variant>.js
#
# - prism / no-chunk / priority-only / progressive: built from aframe-master/src on
#   the current branch (switch-version.sh + webpack).
# - baseline: the compiled bundle committed on the `baseline` branch, i.e. the
#   exact file used for the original baseline measurements (no branch switch).
#
# After building, aframe-master is switched back to prism so that the usual
# workflow (update.sh) keeps working.
#
# Usage: experiment/build_bundles.sh [variant ...]   (default: all)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AFRAME="$ROOT/aframe-master"
OUT="$SCRIPT_DIR/bundles"
mkdir -p "$OUT"

ALL_VARIANTS=(baseline prism no-chunk priority-only progressive)
if [[ $# -gt 0 ]]; then VARIANTS=("$@"); else VARIANTS=("${ALL_VARIANTS[@]}"); fi

for v in "${VARIANTS[@]}"; do
  if [[ "$v" == "baseline" ]]; then
    git -C "$ROOT" show baseline:realCase/hallovreen-master/mylib/my-aframe.js > "$OUT/my-aframe-baseline.js"
    echo "[bundle] baseline <- git baseline:realCase/hallovreen-master/mylib/my-aframe.js"
    continue
  fi
  (cd "$AFRAME" && sh switch-version.sh "$v" >/dev/null && npx webpack --config webpack.config.cjs >/tmp/build_bundles_webpack.log 2>&1) \
    || { echo "[error] build failed for $v, see /tmp/build_bundles_webpack.log"; exit 1; }
  cp "$AFRAME/dist/aframe-master.js" "$OUT/my-aframe-$v.js"
  echo "[bundle] $v <- aframe-master/src (switch-version.sh $v)"
done

(cd "$AFRAME" && sh switch-version.sh prism >/dev/null)
echo "[aframe] aframe-master switched back to prism"
(cd "$OUT" && shasum my-aframe-*.js)
