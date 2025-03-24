#!/bin/bash
npm run dist:max
cp -f dist/aframe-master.js ../realCase/EllieTale-WebXR-main/lib/my-aframe.js
echo "OK!"