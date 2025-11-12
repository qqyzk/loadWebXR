#!/bin/bash
npm run dist:max
cp -f dist/aframe-master.js ../realCase/EllieTale-WebXR-main/lib/my-aframe.js
cp -f dist/aframe-master.js ../realCase/hallovreen-master/mylib/my-aframe.js
cp -f dist/aframe-master.js ../realCase/Virtual-Reality-Museum-master/mylib/my-aframe.js
cp -f dist/aframe-master.js ../simulation/lib/my-aframe.js
echo "OK!"