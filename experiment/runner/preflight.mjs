#!/usr/bin/env node
/**
 * Pre-flight check of the phone before a session (Android, USB debugging on,
 * Chrome open on the phone).
 *
 * Reports the device, Android and Chrome versions, battery level/temperature,
 * display refresh rate, and, through Chrome itself, the CSS viewport, device
 * pixel ratio and the measured requestAnimationFrame rate. It also checks that
 * the experiment server is reachable from the phone (adb reverse) and that the
 * Fast 4G throttling takes effect. The report is saved to
 * experiment/results/preflight-<timestamp>.json.
 *
 * Finally it re-runs the offline probe (probe.mjs) with the viewport the phone
 * reports and regenerates the pages (gen_pages.py), so the VIA order and the
 * visibility tracking use the orientation the phone is actually in. Keep the
 * phone in the same orientation for the whole session.
 *
 * Usage: node preflight.mjs [--port 8080] [--no-reprobe]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { EXP_DIR, adb, closeBrowser, openBrowser, parseArgs, startServer } from './lib.mjs';

const DEFAULTS = { port: 8080, noReprobe: false };

function prop (name) {
  try { return adb(`shell getprop ${name}`); } catch { return null; }
}

function deviceInfo () {
  const devices = adb('devices').split('\n').slice(1).filter((l) => l.trim().endsWith('device'));
  if (devices.length !== 1) {
    throw new Error(`expected exactly one adb device, found ${devices.length}:\n${adb('devices')}`);
  }
  const chrome = adb('shell dumpsys package com.android.chrome').match(/versionName=(\S+)/);
  const battery = adb('shell dumpsys battery');
  const display = adb('shell dumpsys display');
  const refresh = [...display.matchAll(/(?:refreshRate|renderFrameRate|fps)[=:\s]+([\d.]+)/g)].map((m) => Number(m[1]));
  const orientation = adb('shell dumpsys input').match(/SurfaceOrientation:\s*(\d)/);
  return {
    serial: devices[0].split('\t')[0],
    model: prop('ro.product.model'),
    android: prop('ro.build.version.release'),
    chrome: chrome ? chrome[1] : null,
    batteryLevel: Number((battery.match(/level:\s*(\d+)/) || [])[1]),
    batteryTemp: Number((battery.match(/temperature:\s*(\d+)/) || [])[1]) / 10,
    refreshRatesSeen: [...new Set(refresh)].sort((a, b) => a - b),
    surfaceOrientation: orientation ? Number(orientation[1]) : null // 0/2 portrait, 1/3 landscape
  };
}

async function main () {
  const opts = parseArgs(process.argv.slice(2), DEFAULTS);
  const report = { checkedAt: new Date().toISOString(), device: deviceInfo() };
  console.log('[device]', report.device);

  const server = await startServer(opts.port);
  const browser = await openBrowser({ target: 'android', port: opts.port });
  try {
    report.browserVersion = await browser.version();
    const tab = await browser.newPage();
    const cdp = await tab.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

    // Reachability and throttling: download the largest prism bundle unthrottled and with Fast 4G.
    const url = `http://localhost:${opts.port}/hallovreen-master/mylib/my-aframe-prism.js`;
    await tab.goto(`http://localhost:${opts.port}/hallovreen-master/index.html`, { waitUntil: 'domcontentloaded' });
    const fetchMs = () => tab.evaluate(async (u) => {
      const t0 = performance.now();
      const r = await fetch(u, { cache: 'no-store' });
      await r.arrayBuffer();
      return performance.now() - t0;
    }, url);
    report.fetchUnthrottledMs = await fetchMs();
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 165, downloadThroughput: 1012500, uploadThroughput: 168750, connectionType: 'cellular4g'
    });
    report.fetchFast4gMs = await fetchMs();
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

    // Viewport and frame rate as seen by the page.
    Object.assign(report, await tab.evaluate(() => new Promise((resolve) => {
      const times = [];
      function step (t) {
        times.push(t);
        if (times.length < 181) { requestAnimationFrame(step); return; }
        const d = times.slice(1).map((v, i) => v - times[i]).sort((a, b) => a - b);
        resolve({
          viewport: [window.innerWidth, window.innerHeight],
          devicePixelRatio: window.devicePixelRatio,
          rafMedianMs: d[Math.floor(d.length / 2)],
          rafFps: 1000 / d[Math.floor(d.length / 2)]
        });
      }
      requestAnimationFrame(step);
    })));
    await tab.close();
  } finally {
    await closeBrowser(browser, 'android');
    server.close();
  }

  const out = path.join(EXP_DIR, 'results', `preflight-${report.checkedAt.replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log('[page]', { viewport: report.viewport, dpr: report.devicePixelRatio, rafFps: report.rafFps.toFixed(1) });
  console.log('[network]', `bundle fetch: ${report.fetchUnthrottledMs.toFixed(0)} ms unthrottled, ${report.fetchFast4gMs.toFixed(0)} ms Fast 4G`);
  const [w, h] = report.viewport;
  if (w < h) { console.log('[warn] the phone is in portrait; the probe and VIA order will use portrait. Rotate to landscape and rerun preflight if the runs should be landscape.'); }
  if (!opts.noReprobe) {
    console.log(`[probe] re-probing with the phone viewport ${w}x${h} and regenerating pages`);
    execFileSync('node', [path.join(EXP_DIR, 'runner', 'probe.mjs'), '--viewport', `${w}x${h}`], { stdio: 'inherit' });
    execFileSync('/usr/bin/python3', [path.join(EXP_DIR, 'gen_pages.py')], { stdio: 'inherit' });
  }
  if (report.device.batteryTemp > 38) { console.log('[warn] battery temperature above 38 C; let the phone cool down'); }
  console.log(`[saved] ${path.relative(path.dirname(EXP_DIR), out)}`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
