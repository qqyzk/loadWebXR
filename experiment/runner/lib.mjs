// Shared pieces of the experiment runner and the offline probe.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXP_DIR = path.resolve(HERE, '..');
export const SERVE_ROOT = path.resolve(EXP_DIR, '..', 'realCase');

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function adb (args) {
  return execSync(`adb ${args}`, { encoding: 'utf8' }).trim();
}

// Simple command-line parser: --some-option value / --flag, typed by the defaults.
export function parseArgs (argv, defaults) {
  const opts = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(key in defaults)) { throw new Error(`unknown option ${argv[i]}`); }
    if (typeof defaults[key] === 'boolean') { opts[key] = true; continue; }
    const value = argv[++i];
    opts[key] = typeof defaults[key] === 'number' ? Number(value) : value;
  }
  return opts;
}

export function loadPages () {
  return JSON.parse(fs.readFileSync(path.join(EXP_DIR, 'pages.json'), 'utf8'));
}

// ------------------------------------------------------------ static server

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon'
};

// Static file server for code/realCase (HTTP/1.1 keep-alive, no caching).
export function startServer (port) {
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { rel = '/'; }
    const file = path.join(SERVE_ROOT, path.normalize(rel));
    if (!file.startsWith(SERVE_ROOT)) { res.writeHead(403).end(); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404).end(); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-store'
      });
      fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

// ------------------------------------------------------------------ browser

// Desktop runs emulate a Pixel 6 held in portrait (CSS 412x915, DPR 2.625), the
// orientation of the experiments. preflight re-probes with the exact viewport the
// phone reports.
export const MOBILE_VIEWPORT = { width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true };

// viewport: 'WxH' (CSS pixels; mobile emulation is kept), default MOBILE_VIEWPORT.
export function viewportFromString (text) {
  if (!text) { return MOBILE_VIEWPORT; }
  const [width, height] = text.split('x').map(Number);
  return { ...MOBILE_VIEWPORT, width, height };
}

export async function openBrowser ({ target, port, chrome, headful, viewport }) {
  if (target === 'desktop') {
    return puppeteer.launch({
      executablePath: chrome,
      headless: !headful,
      defaultViewport: viewportFromString(viewport),
      args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']
    });
  }
  adb('forward tcp:9222 localabstract:chrome_devtools_remote');
  adb(`reverse tcp:${port} tcp:${port}`);
  try { adb('shell svc power stayon usb'); } catch { /* optional */ }
  return puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
}

export async function closeBrowser (browser, target) {
  if (target === 'desktop') { await browser.close(); } else { browser.disconnect(); }
}

export const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
