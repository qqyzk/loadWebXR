#!/bin/bash
npm run dist:max
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/realCase/EllieTale-WebXR-main/lib"
mkdir -p "$ROOT/realCase/hallovreen-master/mylib"
mkdir -p "$ROOT/realCase/Virtual-Reality-Museum-master/mylib"
mkdir -p "$ROOT/simulation/lib"
cp -f dist/aframe-master.js "$ROOT/realCase/EllieTale-WebXR-main/lib/my-aframe.js"
cp -f dist/aframe-master.js "$ROOT/realCase/hallovreen-master/mylib/my-aframe.js"
cp -f dist/aframe-master.js "$ROOT/realCase/Virtual-Reality-Museum-master/mylib/my-aframe.js"
cp -f dist/aframe-master.js "$ROOT/simulation/lib/my-aframe.js"
echo "OK!"