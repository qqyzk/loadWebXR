#!/usr/bin/env bash
# Switch A-Frame ablation version: copy -prism / -no-chunk / -priority-only / -profile to unsuffixed names
# so index.js and components/index.js (which import a-assets.js, gltf-model.js, sound.js) load the right variant.
#
# Usage: ./switch-version.sh <prism|no-chunk|priority-only|profile>
# Run from aframe-master. Then run npm run build (or your build command).

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE="${SCRIPT_DIR}/src/core"
COMP="${SCRIPT_DIR}/src/components"

case "$1" in
  prism)
    cp "${CORE}/a-assets-prism.js" "${CORE}/a-assets.js"
    cp "${COMP}/gltf-model-prism.js" "${COMP}/gltf-model.js"
    cp "${COMP}/sound-prism.js" "${COMP}/sound.js"
    echo "Switched to prism (priority + greedy + chunking)."
    ;;
  no-chunk)
    cp "${CORE}/a-assets-no-chunk.js" "${CORE}/a-assets.js"
    cp "${COMP}/gltf-model-prism.js" "${COMP}/gltf-model.js"
    cp "${COMP}/sound-prism.js" "${COMP}/sound.js"
    echo "Switched to no-chunk (priority + greedy, no chunking)."
    ;;
  priority-only)
    cp "${CORE}/a-assets-priority-only.js" "${CORE}/a-assets.js"
    cp "${COMP}/gltf-model-priority-only.js" "${COMP}/gltf-model.js"
    cp "${COMP}/sound-priority-only.js" "${COMP}/sound.js"
    echo "Switched to priority-only (priority only, concurrent scene tasks)."
    ;;
  profile)
    cp "${CORE}/a-assets-profile.js" "${CORE}/a-assets.js"
    cp "${COMP}/gltf-model-prism.js" "${COMP}/gltf-model.js"
    cp "${COMP}/sound-prism.js" "${COMP}/sound.js"
    echo "Switched to profile (no-chunk + scene/network task timing JSON to console)."
    ;;
  *)
    echo "Usage: $0 <prism|no-chunk|priority-only|profile>"
    exit 1
    ;;
esac
