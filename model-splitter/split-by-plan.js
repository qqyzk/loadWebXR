#!/usr/bin/env node

/**
 * PrismLoader model chunker (Node CLI, batch by chunk_plan).
 *
 *  - Input: a chunk_plan JSON file (from visualize/analyze_profile_for_chunking.py)
 *    and an application root directory.
 *  - For each entry where is3DModel && needChunk && k > 1:
 *      * Resolve the GLB/GLTF path: appRoot + src (relative).
 *      * Load the model with three.js GLTFLoader.
 *      * Analyze total vertices / triangles.
 *      * Compute per-chunk capacity:
 *            V_max = floor(V_total / k)
 *            F_max = floor(F_total / k)
 *      * Greedily pack meshes into chunks under V_max/F_max.
 *      * Export each chunk as a GLB file with a deterministic name.
 *
 * 实现说明:
 *  - 本脚本作为 ES module 运行, 直接从
 *      ../model-converter-tools/node_modules/three
 *    导入 three 及其 JSM loader/exporter, 避免依赖顶层 node_modules。
 */

// Node 下 three.js JSM 依赖的浏览器全局：self、FileReader、ProgressEvent
if (typeof globalThis.self === 'undefined') {
  globalThis.self = globalThis;
}
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
        .then(buf => {
          that._result = buf;
          that._done();
        })
        .catch(() => {
          if (that.onerror) that.onerror();
        });
    }
    readAsDataURL (blob) {
      const that = this;
      Promise.resolve(blob.arrayBuffer ? blob.arrayBuffer() : blob)
        .then(buf => {
          const b = Buffer.from(buf);
          that._result = 'data:application/octet-stream;base64,' + b.toString('base64');
          that._done();
        })
        .catch(() => {
          if (that.onerror) that.onerror();
        });
    }
  };
}

// Node 下 GLTFExporter 需要 canvas（用于把纹理导出为图片）；GLTFLoader 需要能解码 GLB 内嵌图片。
// 若存在 document 或 OffscreenCanvas 则说明在浏览器或已有 polyfill，无需处理。
let nodeTextureDecoder = null;
if (typeof globalThis.document === 'undefined' && typeof globalThis.OffscreenCanvas === 'undefined') {
  try {
    const canvasMod = await import('canvas');
    const createCanvas = canvasMod.default?.createCanvas ?? canvasMod.createCanvas;
    const ImageData = canvasMod.ImageData ?? canvasMod.default?.ImageData;
    if (createCanvas) {
      globalThis.document = {
        createElement (tag) {
            if (tag === 'canvas') {
            const c = createCanvas(1, 1);
            if (typeof c.convertToBlob !== 'function') {
              c.convertToBlob = function (opts = {}) {
                const mime = opts.type || 'image/png';
                const config = mime === 'image/jpeg' && opts.quality != null ? { quality: opts.quality } : undefined;
                const buf = c.toBuffer(mime, config);
                return Promise.resolve(new Blob([buf], { type: mime }));
              };
            }
            return c;
          }
          return null;
        }
      };
    }
    if (ImageData && typeof globalThis.ImageData === 'undefined') {
      globalThis.ImageData = ImageData;
    }
  } catch (_) {
    console.warn('model-splitter: 未安装 "canvas" 包，导出 GLB 时纹理可能丢失。可运行: npm install canvas（需在 model-splitter 或项目根目录）');
  }
  try {
    const sharp = (await import('sharp')).default;
    nodeTextureDecoder = sharp;
  } catch (_) {
    console.warn('model-splitter: 未安装 "sharp" 包，Node 下从 GLB 加载的纹理可能为空。可运行: npm install sharp（需在 model-splitter 或项目根目录）');
  }
}

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const threePath = path.join(__dirname, '..', 'model-converter-tools', 'node_modules', 'three');
const threeModule = await import(pathToFileURL(path.join(threePath, 'build', 'three.module.js')).href);
const THREE = threeModule.default && threeModule.default.Group ? threeModule.default : threeModule;
const { GLTFLoader } = await import(pathToFileURL(path.join(threePath, 'examples', 'jsm', 'loaders', 'GLTFLoader.js')).href);
const { GLTFExporter } = await import(pathToFileURL(path.join(threePath, 'examples', 'jsm', 'exporters', 'GLTFExporter.js')).href);
const { clone: cloneWithSkeleton } = await import(pathToFileURL(path.join(threePath, 'examples', 'jsm', 'utils', 'SkeletonUtils.js')).href);

function printUsageAndExit () {
  console.log(`用法:
  node model-splitter/split-by-plan.js \\
    --chunk-plan path/to/chunk_plan_profile_4g.json \\
    --app-root /abs/path/to/app/root \\
    [--output-root /abs/path/for/output]

参数说明:
  --chunk-plan   来自 analyze_profile_for_chunking.py 的 JSON 输出
  --app-root     应用根目录, chunk_plan 中的 src 会被视为相对该目录的路径 (可省略, 对 tale/hallo/mus 使用内置默认值)
  --output-root  可选, 分块后的模型输出根目录(默认: model-splitter/results/<tale|hallo|mus>)
`);
  process.exit(1);
}

function inferDefaults (args) {
  // 从 chunk-plan 路径中推断场景(tale / hallo / mus), 并据此给出默认 appRoot 与 outputRoot
  const planPath = path.resolve(args.chunkPlan);
  const norm = planPath.split(path.sep);
  let scenario = null;
  if (norm.includes('tale')) scenario = 'tale';
  else if (norm.includes('hallo')) scenario = 'hallo';
  else if (norm.includes('mus')) scenario = 'mus';

  // 默认 appRoot（与 HTML 中 src="item/..." 等相对路径一致）
  if (!args.appRoot && scenario) {
    if (scenario === 'tale') {
      // EllieTale: 模型在 realCase/EllieTale-WebXR-main/item/ 下
      args.appRoot = path.resolve(__dirname, '..', 'realCase', 'EllieTale-WebXR-main');
    } else if (scenario === 'hallo') {
      args.appRoot = path.resolve(__dirname, '..', 'realCase', 'hallovreen-master');
    } else if (scenario === 'mus') {
      args.appRoot = path.resolve(__dirname, '..', 'realCase', 'Virtual-Reality-Museum-master');
    }
  }

  // 默认 outputRoot: model-splitter/results/<scenario?>
  if (!args.outputRoot) {
    const baseResults = path.resolve(__dirname, 'results');
    args.outputRoot = scenario ? path.join(baseResults, scenario) : baseResults;
  }
}

function parseArgs (argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--chunk-plan') {
      args.chunkPlan = argv[++i];
    } else if (a === '--app-root') {
      args.appRoot = argv[++i];
    } else if (a === '--output-root') {
      args.outputRoot = argv[++i];
    } else if (a === '--help' || a === '-h') {
      printUsageAndExit();
    }
  }
  if (!args.chunkPlan) {
    printUsageAndExit();
  }
  inferDefaults(args);
  if (args.appRoot) {
    args.appRoot = path.resolve(args.appRoot);
  }
  args.outputRoot = path.resolve(args.outputRoot);
  return args;
}

function loadChunkPlan (chunkPlanPath) {
  const raw = fs.readFileSync(chunkPlanPath, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error('chunk_plan JSON 顶层必须是数组');
  }
  return data;
}

function groupBySrc (planEntries) {
  const map = new Map();
  for (const r of planEntries) {
    const key = r.src;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return map;
}

function pickModelConfig (records) {
  // 同一 src 可能有重复记录(来自不同 profile 或多次分析),
  // 策略: 选 needChunk && k>1 中 k 最大的那条.
  let chosen = null;
  for (const r of records) {
    if (!r.is3DModel || !r.needChunk || !r.k || r.k <= 1) continue;
    if (!chosen || r.k > chosen.k) chosen = r;
  }
  return chosen;
}

function analyzeModel (root) {
  let meshes = 0;
  let totalTriangles = 0;
  let totalVertices = 0;

  root.traverse((child) => {
    if (child.isMesh && child.geometry && child.geometry.attributes && child.geometry.attributes.position) {
      meshes++;
      const geom = child.geometry;
      const tri = geom.index ? geom.index.count / 3 : geom.attributes.position.count / 3;
      const vert = geom.attributes.position.count;
      totalTriangles += tri;
      totalVertices += vert;
    }
  });

  return {
    meshes,
    totalTriangles: Math.floor(totalTriangles),
    totalVertices
  };
}

/**
 * 在 Node 下用 sharp 解码 blob URL 得到像素数据，构造 DataTexture，保证导出时纹理不丢失。
 * 仅当 nodeTextureDecoder (sharp) 可用且 url 为 blob: 时使用。
 * 优先用 node:buffer.resolveObjectURL 取回 blob 内容（Node 18.17+），否则回退到 fetch(blobURL)。
 */
async function createNodeTextureLoader (THREE) {
  const sharp = nodeTextureDecoder;
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
          const { data, info } = await sharp(buf)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
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

/** 根据扩展名返回 MIME 类型 */
function mimeFromExt (uri) {
  const e = path.extname(uri).toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.webp') return 'image/webp';
  if (e === '.gif') return 'image/gif';
  return 'image/png';
}

/**
 * 对 .gltf 文件预处理：将外部 .bin 和纹理引用内联为 base64 data URI，
 * 解决 Node 下 FileLoader 无法 fetch file:// 的问题。
 */
function inlineGLTFBuffers (filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.gltf') return fs.readFileSync(filePath);

  const dir = path.dirname(filePath);
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let modified = false;

  if (json.buffers && Array.isArray(json.buffers)) {
    for (const buf of json.buffers) {
      const uri = buf.uri;
      if (!uri || typeof uri !== 'string' || uri.startsWith('data:')) continue;

      const binPath = path.resolve(dir, uri);
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
  const str = JSON.stringify(json);
  return Buffer.from(str, 'utf8');
}

async function loadGLTFAsScene (filePath) {
  const loader = new GLTFLoader();
  if (nodeTextureDecoder) {
    const nodeLoader = await createNodeTextureLoader(THREE);
    if (nodeLoader) loader.textureLoader = nodeLoader;
  }

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

/** SkinnedMesh 的骨骼根节点，用于导出时保留 skin 引用 */
function getSkeletonRoot (skeleton) {
  if (!skeleton?.bones?.length) return null;
  let b = skeleton.bones[0];
  while (b.parent && b.parent.isBone) b = b.parent;
  return b;
}

function splitSceneByK (root, stats, k) {
  const Vmax = Math.floor(stats.totalVertices / k);
  const Fmax = Math.floor(stats.totalTriangles / k);

  console.log(`  按 k=${k} 分块: V_max=${Vmax}, F_max=${Fmax}`);

  const meshes = [];
  root.traverse((child) => {
    if (child.isMesh && child.geometry && child.geometry.attributes && child.geometry.attributes.position) {
      meshes.push(child);
    }
  });

  meshes.sort((a, b) => {
    const aTri = a.geometry.index ? a.geometry.index.count / 3 : a.geometry.attributes.position.count / 3;
    const bTri = b.geometry.index ? b.geometry.index.count / 3 : b.geometry.attributes.position.count / 3;
    return bTri - aTri;
  });

  const chunks = [];
  let chunkIndex = 0;
  let currentGroup = new THREE.Group();
  let curTri = 0;
  let curVert = 0;
  let addedSkeletonRoots = new Set();

  for (const mesh of meshes) {
    const geom = mesh.geometry;
    const meshTri = geom.index ? geom.index.count / 3 : geom.attributes.position.count / 3;
    const meshVert = geom.attributes.position.count;

    const overTri = (curTri + meshTri > Fmax);
    const overVert = (curVert + meshVert > Vmax);

    if ((overTri || overVert) && currentGroup.children.length > 0) {
      chunks.push({
        group: currentGroup,
        triangles: curTri,
        vertices: curVert,
        index: chunkIndex++
      });
      currentGroup = new THREE.Group();
      curTri = 0;
      curVert = 0;
      addedSkeletonRoots = new Set();
    }

    // SkinnedMesh 需将骨骼根一并加入 chunk，否则导出后 skin.joints 引用缺失导致解析报错
    if (mesh.isSkinnedMesh && mesh.skeleton) {
      const skRoot = getSkeletonRoot(mesh.skeleton);
      if (skRoot && !addedSkeletonRoots.has(skRoot)) {
        currentGroup.add(skRoot);
        addedSkeletonRoots.add(skRoot);
      }
    }

    currentGroup.add(mesh);
    curTri += meshTri;
    curVert += meshVert;
  }

  if (currentGroup.children.length > 0) {
    chunks.push({
      group: currentGroup,
      triangles: curTri,
      vertices: curVert,
      index: chunkIndex++
    });
  }

  const sumTri = chunks.reduce((s, c) => s + c.triangles, 0);
  const sumVert = chunks.reduce((s, c) => s + c.vertices, 0);
  if (sumTri !== stats.totalTriangles) {
    console.warn(`  ⚠️ 三角形数不匹配: 分配=${sumTri}, 原始=${stats.totalTriangles}`);
  } else {
    console.log('  ✅ 三角形完整性检查通过');
  }
  if (sumVert !== stats.totalVertices) {
    console.warn(`  ⚠️ 顶点数不匹配: 分配=${sumVert}, 原始=${stats.totalVertices}`);
  } else {
    console.log('  ✅ 顶点数完整性检查通过');
  }

  console.log(`  实际生成 ${chunks.length} 个 chunk (目标 k=${k})`);
  return chunks;
}

async function exportChunks (chunks, baseName, outDir) {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const exporter = new GLTFExporter();

  for (const chunk of chunks) {
    const scene = new THREE.Scene();
    scene.add(chunk.group);

    const arrayBuffer = await new Promise((resolve, reject) => {
      exporter.parse(
        scene,
        (result) => resolve(result),
        (error) => reject(error),
        { binary: true }
      );
    });

    const buffer = arrayBuffer instanceof ArrayBuffer
      ? Buffer.from(arrayBuffer)
      : Buffer.from(arrayBuffer.buffer || arrayBuffer);

    const filename = `${baseName}_chunk_${chunk.index + 1}.glb`;
    const outPath = path.join(outDir, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`    写出 ${outPath} (${buffer.length} bytes, ${chunk.triangles} tri, ${chunk.vertices} vert)`);
  }
}

async function processOneModel (src, record, args) {
  const inputPath = path.join(args.appRoot, src);
  if (!fs.existsSync(inputPath)) {
    console.warn(`跳过 ${src}: 找不到文件 ${inputPath}`);
    return { src, requestedK: record.k, actualChunks: '跳过(文件不存在)' };
  }
  console.log(`\n处理模型: ${src}`);
  console.log(`  k=${record.k}, maxProcessTimeMs=${record.maxProcessTimeMs.toFixed(2)}`);

  let scene = await loadGLTFAsScene(inputPath);
  scene = cloneWithSkeleton(scene);
  const stats = analyzeModel(scene);
  console.log(`  模型信息: meshes=${stats.meshes}, triangles=${stats.totalTriangles}, vertices=${stats.totalVertices}`);

  const chunks = splitSceneByK(scene, stats, record.k);

  const baseName = path.basename(src).replace(/\.gl[bt]f?$/i, '');
  const outDir = args.outputRoot
    ? path.join(args.outputRoot, path.dirname(src))
    : path.dirname(inputPath);

  if (chunks.length <= 1) {
    console.log('  实际无法分割（单 mesh 或无法再分），不输出 chunk 文件');
    return { src, requestedK: record.k, actualChunks: '无法分割' };
  }

  await exportChunks(chunks, baseName, outDir);
  return { src, requestedK: record.k, actualChunks: chunks.length };
}

async function main () {
  const args = parseArgs(process.argv);
  const plan = loadChunkPlan(args.chunkPlan);

  const grouped = groupBySrc(plan);
  const targets = [];
  for (const [src, recs] of grouped.entries()) {
    const chosen = pickModelConfig(recs);
    if (chosen) {
      targets.push({ src, record: chosen });
    }
  }

  if (!targets.length) {
    console.log('chunk_plan 中没有需要分块的 3D 模型 (is3DModel && needChunk && k>1).');
    return;
  }

  console.log(`将处理 ${targets.length} 个模型:`);
  for (const t of targets) {
    console.log(`  - ${t.src} (k=${t.record.k})`);
  }

  const report = [];
  for (const t of targets) {
    try {
      const result = await processOneModel(t.src, t.record, args);
      if (result) report.push(result);
    } catch (e) {
      console.error(`处理 ${t.src} 时出错:`, e.message || e);
      report.push({ src: t.src, requestedK: t.record.k, actualChunks: `错误: ${e.message || e}` });
    }
  }

  const reportRows = report.map(r => ({
    模型: r.src,
    要求分成几块: r.requestedK,
    实际: r.actualChunks
  }));

  const reportPath = path.join(args.outputRoot, 'chunk_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(reportRows, null, 2), 'utf8');
  console.log('\n报告已写入: ' + reportPath);

  console.log('\n--- 汇总 ---');
  reportRows.forEach(r => {
    console.log(`  ${r.模型}: 要求 k=${r.要求分成几块}, 实际 ${r.实际}`);
  });
  console.log('\n全部处理完成。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


