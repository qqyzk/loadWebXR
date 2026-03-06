#!/usr/bin/env node
/**
 * Verify that chunked export recombines identically to original.
 *
 * Usage:
 *   node model-splitter/verify_recombine.js \
 *     --app-root /abs/path/to/app/root \
 *     --src item/Foo.glb \
 *     --chunks-dir /abs/path/to/output/item
 */

// Node 下 three.js JSM 依赖的浏览器全局：self、FileReader、ProgressEvent
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
if (typeof globalThis.ProgressEvent === 'undefined') {
  globalThis.ProgressEvent = class ProgressEvent extends Event {
    constructor (type, opts = {}) {
      super(type);
      this.lengthComputable = opts.lengthComputable ?? false;
      this.loaded = opts.loaded ?? 0;
      this.total = opts.total ?? 0;
    }
  };
}
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    constructor () {
      this._result = null;
      this.onload = null;
      this.onloadend = null;
      this.onerror = null;
    }
    get result () { return this._result; }
    _done () {
      if (this.onload) this.onload({ target: this });
      if (this.onloadend) this.onloadend({ target: this });
    }
    readAsArrayBuffer (blob) {
      const that = this;
      Promise.resolve(blob.arrayBuffer ? blob.arrayBuffer() : blob)
        .then(buf => { that._result = buf; that._done(); })
        .catch(() => { if (that.onerror) that.onerror(); });
    }
    readAsDataURL (blob) {
      const that = this;
      Promise.resolve(blob.arrayBuffer ? blob.arrayBuffer() : blob)
        .then(buf => {
          const b = Buffer.from(buf);
          that._result = 'data:application/octet-stream;base64,' + b.toString('base64');
          that._done();
        })
        .catch(() => { if (that.onerror) that.onerror(); });
    }
  };
}

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

// canvas 仅用于 exporter/loader 的纹理路径，不做渲染
try {
  if (typeof globalThis.document === 'undefined' && typeof globalThis.OffscreenCanvas === 'undefined') {
    const canvasMod = await import('canvas');
    const createCanvas = canvasMod.default?.createCanvas ?? canvasMod.createCanvas;
    const ImageData = canvasMod.ImageData ?? canvasMod.default?.ImageData;
    if (createCanvas) {
      globalThis.document = {
        createElement (tag) {
          if (tag === 'canvas') return createCanvas(1, 1);
          return null;
        }
      };
    }
    if (ImageData && typeof globalThis.ImageData === 'undefined') globalThis.ImageData = ImageData;
  }
} catch (_) {}

let sharp = null;
try { sharp = (await import('sharp')).default; } catch (_) {}

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const threePath = path.join(__dirname, '..', 'model-converter-tools', 'node_modules', 'three');
const threeModule = await import(pathToFileURL(path.join(threePath, 'build', 'three.module.js')).href);
const THREE = threeModule.default && threeModule.default.Group ? threeModule.default : threeModule;
const { GLTFLoader } = await import(pathToFileURL(path.join(threePath, 'examples', 'jsm', 'loaders', 'GLTFLoader.js')).href);

function parseArgs (argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--app-root') args.appRoot = argv[++i];
    else if (a === '--src') args.src = argv[++i];
    else if (a === '--chunks-dir') args.chunksDir = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  if (args.help || !args.appRoot || !args.src || !args.chunksDir) {
    console.log(`Usage:
  node model-splitter/verify_recombine.js \\
    --app-root /abs/path/to/app/root \\
    --src item/Foo.glb \\
    --chunks-dir /abs/path/to/output/item`);
    process.exit(1);
  }
  args.appRoot = path.resolve(args.appRoot);
  args.chunksDir = path.resolve(args.chunksDir);
  return args;
}

function mimeFromExt (uri) {
  const e = path.extname(uri).toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.webp') return 'image/webp';
  if (e === '.gif') return 'image/gif';
  return 'image/png';
}

function inlineGLTFBuffers (filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.gltf') return fs.readFileSync(filePath);

  const dir = path.dirname(filePath);
  const fileBase = path.basename(filePath);
  const mChunk = /^(.*)_chunk_(\d+)\.gltf$/i.exec(fileBase);
  const chunkModelBase = mChunk ? mChunk[1] : null;
  const chunkIndex = mChunk ? parseInt(mChunk[2], 10) : null;
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let modified = false;

  if (json.buffers && Array.isArray(json.buffers)) {
    for (const buf of json.buffers) {
      const uri = buf.uri;
      if (!uri || typeof uri !== 'string' || uri.startsWith('data:')) continue;
      let binPath = path.resolve(dir, uri);
      if (!fs.existsSync(binPath) && chunkModelBase && Number.isFinite(chunkIndex)) {
        // model-splitter 在 results 目录下输出时，为避免不同模型覆盖 bin，会写成 <base>_chunk_N.bin；
        // 但 glTF 内部为了与运行时 split 目录命名一致，会引用 model_chunk_N.bin。
        // 验证脚本在这里把引用重定向到本地实际存在的 bin。
        const fallback = path.resolve(dir, `${chunkModelBase}_chunk_${chunkIndex}.bin`);
        if (fs.existsSync(fallback)) binPath = fallback;
      }
      if (!fs.existsSync(binPath)) continue;
      const binData = fs.readFileSync(binPath);
      buf.uri = 'data:application/octet-stream;base64,' + binData.toString('base64');
      modified = true;
    }
  }

  if (json.images && Array.isArray(json.images)) {
    for (const img of json.images) {
      const uri = img.uri;
      if (!uri || typeof uri !== 'string' || uri.startsWith('data:')) continue;
      const imgPath = path.resolve(dir, uri);
      if (!fs.existsSync(imgPath)) continue;
      const imgData = fs.readFileSync(imgPath);
      const mime = mimeFromExt(uri);
      img.uri = 'data:' + mime + ';base64,' + imgData.toString('base64');
      modified = true;
    }
  }

  if (!modified) return fs.readFileSync(filePath);
  return Buffer.from(JSON.stringify(json), 'utf8');
}

async function createNodeTextureLoader () {
  if (!sharp) return null;
  let resolveObjectURL = null;
  try {
    const nodeBuffer = await import('node:buffer');
    resolveObjectURL = nodeBuffer.resolveObjectURL;
  } catch (_) {}

  return {
    load (url, onLoad, _onProgress, onError) {
      const u = typeof url === 'string' ? url : '';
      const isBlob = u.startsWith('blob:');
      const isDataUri = u.startsWith('data:');
      if (!isBlob && !isDataUri) {
        if (onError) onError(new Error('NodeTextureLoader only supports blob: or data: URLs'));
        return;
      }
      (async () => {
        try {
          let buf;
          if (isDataUri) {
            const m = /^data:[^;]+;base64,(.+)$/.exec(u);
            if (!m) throw new Error('Invalid data URI');
            buf = Buffer.from(m[1], 'base64');
          } else {
            const resolved = resolveObjectURL ? resolveObjectURL(u) : null;
            if (resolved) {
              const ab = resolved.arrayBuffer ? await resolved.arrayBuffer() : resolved;
              buf = Buffer.from(ab);
            } else {
              const res = await fetch(u);
              if (!res.ok) throw new Error(`fetch ${u}: ${res.status}`);
              buf = Buffer.from(await res.arrayBuffer());
            }
          }
          const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          const rgba = new Uint8ClampedArray(data);
          const texture = new THREE.DataTexture(rgba, info.width, info.height);
          texture.format = THREE.RGBAFormat;
          texture.flipY = true;
          texture.needsUpdate = true;
          if (onLoad) onLoad(texture);
        } catch (err) {
          if (onError) onError(err);
        }
      })();
    }
  };
}

async function loadGLTFAsScene (filePath) {
  const loader = new GLTFLoader();
  const nodeLoader = await createNodeTextureLoader();
  if (nodeLoader) loader.textureLoader = nodeLoader;

  const buffer = inlineGLTFBuffers(filePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const resourcePath = pathToFileURL(path.resolve(path.dirname(filePath)) + path.sep).href;

  return new Promise((resolve, reject) => {
    loader.parse(
      arrayBuffer,
      resourcePath,
      (gltf) => resolve(gltf.scene || gltf.scenes[0]),
      (error) => reject(error)
    );
  });
}

function analyze (root) {
  let meshes = 0;
  let totalTriangles = 0;
  let multiMaterialMeshes = 0;
  let multiMaterialGroupsMissing = 0;

  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return;
    meshes++;
    const geom = child.geometry;
    const tri = geom.index ? geom.index.count / 3 : geom.attributes.position.count / 3;
    totalTriangles += tri;

    const isMultiMat = Array.isArray(child.material);
    if (isMultiMat) {
      multiMaterialMeshes++;
      const groups = Array.isArray(geom.groups) ? geom.groups : [];
      const distinct = new Set(groups.map(g => g.materialIndex ?? 0));
      if (groups.length === 0 || distinct.size <= 1) multiMaterialGroupsMissing++;
    }
  });

  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  return {
    meshes,
    totalTriangles: Math.floor(totalTriangles),
    bbox: { min: box.min.toArray(), max: box.max.toArray(), size: size.toArray(), center: center.toArray() },
    multiMaterialMeshes,
    multiMaterialGroupsMissing
  };
}

function combineLikePrism (chunkScenes) {
  const combined = chunkScenes[0];
  for (let i = 1; i < chunkScenes.length; i++) {
    const s = chunkScenes[i];
    while (s.children.length > 0) combined.add(s.children[0]);
  }
  return combined;
}

function vecDiff (a, b) {
  const d = [];
  for (let i = 0; i < a.length; i++) d.push(a[i] - b[i]);
  return d;
}

function maxAbs (arr) {
  let m = 0;
  for (const v of arr) m = Math.max(m, Math.abs(v));
  return m;
}

async function main () {
  const args = parseArgs(process.argv);
  const srcPath = path.join(args.appRoot, args.src);
  if (!fs.existsSync(srcPath)) throw new Error(`Original file not found: ${srcPath}`);

  const baseName = path.basename(args.src).replace(/\.gl[bt]f?$/i, '');
  const files = fs.readdirSync(args.chunksDir);
  const re = new RegExp('^' + baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_chunk_(\\d+)\\.gltf$');
  const idxs = files
    .map(f => {
      const m = re.exec(f);
      return m ? parseInt(m[1], 10) : null;
    })
    .filter(v => Number.isFinite(v));
  const maxIdx = idxs.length ? Math.max(...idxs) : 0;
  if (!maxIdx) throw new Error(`No chunk gltf found in: ${args.chunksDir} (baseName=${baseName})`);

  console.log(`Verify src=${args.src}`);
  console.log(`  chunksDir=${args.chunksDir}, chunks=${maxIdx}`);

  const originalScene = await loadGLTFAsScene(srcPath);
  const origInfo = analyze(originalScene);

  const chunkScenes = [];
  for (let i = 1; i <= maxIdx; i++) {
    const p = path.join(args.chunksDir, `${baseName}_chunk_${i}.gltf`);
    if (!fs.existsSync(p)) throw new Error(`Missing chunk: ${p}`);
    chunkScenes.push(await loadGLTFAsScene(p));
  }
  const combined = combineLikePrism(chunkScenes);
  const combInfo = analyze(combined);

  const eps = 1e-4;
  const sizeDiff = vecDiff(combInfo.bbox.size, origInfo.bbox.size);
  const centerDiff = vecDiff(combInfo.bbox.center, origInfo.bbox.center);
  const maxSizeDiff = maxAbs(sizeDiff);
  const maxCenterDiff = maxAbs(centerDiff);

  console.log('--- Original ---');
  console.log(JSON.stringify(origInfo, null, 2));
  console.log('--- Combined ---');
  console.log(JSON.stringify(combInfo, null, 2));
  console.log('--- Diff ---');
  console.log(JSON.stringify({
    trianglesDiff: combInfo.totalTriangles - origInfo.totalTriangles,
    bboxSizeDiff: sizeDiff,
    bboxCenterDiff: centerDiff,
    passBBox: maxSizeDiff <= eps && maxCenterDiff <= eps,
    eps
  }, null, 2));

  if (combInfo.totalTriangles !== origInfo.totalTriangles) process.exitCode = 2;
  if (maxSizeDiff > eps || maxCenterDiff > eps) process.exitCode = 3;
  if (combInfo.multiMaterialGroupsMissing > 0) process.exitCode = 4;
}

main().catch((e) => {
  console.error(e?.stack || e?.message || e);
  process.exit(1);
});

