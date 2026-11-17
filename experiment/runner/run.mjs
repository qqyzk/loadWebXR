#!/usr/bin/env node
/**
 * Automated experiment runner.
 *
 * For each run: open a new tab, clear and disable the browser cache, apply the
 * network throttling preset (the same CDP command the DevTools throttling menu
 * uses), open the experiment page, click the start button, wait for
 * window.__exp.done and save window.__exp to
 *   experiment/results/<session>/<app>/<config>/run_<NN>.json
 *
 * Runs are scheduled in rounds: every round runs each selected page once, in a
 * shuffled order (seeded by the session name), so device drift is spread evenly
 * over all configurations. Existing result files are skipped, so an interrupted
 * session can be resumed with the same command.
 *
 * Targets:
 *   --target android   Chrome on an Android phone over USB (adb forward/reverse)
 *   --target desktop   local desktop Chrome (smoke tests of the harness)
 *
 * Pages are served by the built-in server; by default the phone reaches it over
 * USB (adb reverse, http://localhost:<port>). With --host <Mac LAN IP> the phone
 * loads the pages over the local Wi-Fi instead (the "Local Wifi" condition, used
 * with --network none); USB is then only used to drive Chrome.
 *
 * Example:
 *   node run.mjs --session pixel6-main-fast4g --set main --target android --network fast4g --runs 10
 *   node run.mjs --session pixel6-main-wifi --set main --network none --host 192.168.1.10 --runs 10
 *   node run.mjs --session smoke-x --set main --target desktop --network fast4g --runs 1 --apps hallo
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  EXP_DIR, DEFAULT_CHROME, adb, closeBrowser, loadPages, openBrowser, parseArgs, sleep, startServer
} from './lib.mjs';

// Chrome DevTools presets (devtools-frontend front_end/core/sdk/NetworkManager.ts).
// Throughput in bytes/s, latency in ms; passed to Network.emulateNetworkConditions
// exactly as DevTools does.
const NETWORKS = {
  none: null,
  fast4g: { latency: 60 * 2.75, downloadThroughput: 9 * 1000 * 1000 / 8 * 0.9, uploadThroughput: 1.5 * 1000 * 1000 / 8 * 0.9, connectionType: 'cellular4g' },
  slow4g: { latency: 150 * 3.75, downloadThroughput: 1.6 * 1000 * 1000 / 8 * 0.9, uploadThroughput: 750 * 1000 / 8 * 0.9, connectionType: 'cellular3g' },
  '3g': { latency: 400 * 5, downloadThroughput: 500 * 1000 / 8 * 0.8, uploadThroughput: 500 * 1000 / 8 * 0.8, connectionType: 'cellular3g' }
};

const DEFAULTS = {
  session: null,
  set: 'main',
  target: 'android',
  network: 'fast4g',
  runs: 10,
  apps: null,
  configs: null,
  port: 8080,
  host: 'localhost',
  cooldown: 20,
  settle: 2,
  timeout: 300,
  maxTemp: 38,
  chrome: DEFAULT_CHROME,
  headful: false,
  dryRun: false
};

// ---------------------------------------------------------------- utilities

function seededRandom (seedText) {
  let h = 2166136261;
  for (const ch of seedText) { h = Math.imul(h ^ ch.charCodeAt(0), 16777619); }
  return () => {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle (items, rand) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function batteryTemp () {
  const m = adb('shell dumpsys battery').match(/temperature:\s*(\d+)/);
  return m ? Number(m[1]) / 10 : null;
}

// ------------------------------------------------------------------- one run

async function runOnce (browser, page, opts, url) {
  const tab = await browser.newPage();
  const consoleErrors = [];
  tab.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  tab.on('console', (msg) => { if (msg.type() === 'error') { consoleErrors.push(msg.text()); } });
  try {
    const cdp = await tab.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.clearBrowserCache');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const net = NETWORKS[opts.network];
    if (net) { await cdp.send('Network.emulateNetworkConditions', { offline: false, ...net }); }

    const timeout = opts.timeout * 1000;
    await tab.goto(url, { waitUntil: 'load', timeout });
    // tale fetches its scene (html/Beach*.html) on page load; wait for it.
    const waitScene = page.app === 'tale' && page.set !== 'stages';
    await tab.waitForFunction(
      (waitScene) => window.__exp && window.__exp.ready &&
        (!waitScene || (window.gameHTMLFile && window.gameHTMLFile.environment)),
      { timeout, polling: 200 }, waitScene);
    await sleep(opts.settle * 1000);

    const pageConfig = await tab.evaluate(() => window.__exp.page);
    if (!pageConfig || pageConfig.config !== page.config || pageConfig.app !== page.app) {
      throw new Error(`page reports ${JSON.stringify(pageConfig && { app: pageConfig.app, config: pageConfig.config })}, expected ${page.app}/${page.config}`);
    }

    await tab.click('#ttff-start-button');
    await tab.waitForFunction(() => window.__exp.done, { timeout, polling: 250 });
    const exp = await tab.evaluate(() => window.__exp);
    return { exp, consoleErrors };
  } catch (err) {
    // Keep whatever the page measured so far for diagnosis.
    err.partial = await tab.evaluate(() => {
      const e = window.__exp;
      if (!e) { return null; }
      return { ...e, page: null, renderTimes: e.renderTimes.length, frames: null, resources: null, visibility: null };
    }).catch(() => null);
    err.consoleErrors = consoleErrors;
    throw err;
  } finally {
    await tab.close().catch(() => {});
  }
}

// --------------------------------------------------------------------- main

async function main () {
  const opts = parseArgs(process.argv.slice(2), DEFAULTS);
  if (!opts.session) { throw new Error('--session <name> is required'); }
  if (!(opts.network in NETWORKS)) { throw new Error(`unknown network ${opts.network}`); }

  let pages = loadPages().filter((p) => p.set === opts.set);
  if (opts.apps) { const s = new Set(opts.apps.split(',')); pages = pages.filter((p) => s.has(p.app)); }
  if (opts.configs) { const s = new Set(opts.configs.split(',')); pages = pages.filter((p) => s.has(p.config)); }
  if (!pages.length) { throw new Error('no pages selected'); }

  const outRoot = path.join(EXP_DIR, 'results', opts.session);
  const rand = seededRandom(opts.session);
  const schedule = [];
  for (let r = 1; r <= opts.runs; r++) {
    for (const p of shuffle(pages, rand)) {
      const file = path.join(outRoot, p.app, p.config, `run_${String(r).padStart(2, '0')}.json`);
      schedule.push({ round: r, page: p, file });
    }
  }
  const todo = schedule.filter((s) => !fs.existsSync(s.file));
  console.log(`[runner] session ${opts.session} (set ${opts.set}): ${pages.length} pages x ${opts.runs} rounds, ${todo.length} runs to do`);
  if (opts.dryRun) { todo.forEach((s) => console.log(`  round ${s.round} ${s.page.app}/${s.page.config}`)); return; }

  const server = await startServer(opts.port);
  const browser = await openBrowser(opts);
  const browserVersion = await browser.version();
  fs.mkdirSync(outRoot, { recursive: true });
  const failLog = path.join(outRoot, 'failures.jsonl');
  const t0 = Date.now();

  try {
    for (let i = 0; i < todo.length; i++) {
      const { round, page, file } = todo[i];
      if (opts.target === 'android') {
        let temp = batteryTemp();
        while (temp !== null && temp > opts.maxTemp) {
          console.log(`[runner] battery ${temp} C > ${opts.maxTemp} C, waiting`);
          await sleep(15000);
          temp = batteryTemp();
        }
      }
      const url = `http://${opts.host}:${opts.port}${page.url}`;
      const meta = {
        session: opts.session, set: opts.set, round, app: page.app, config: page.config, bundle: page.bundle,
        chunkProfile: page.chunkProfile, network: opts.network, throttling: NETWORKS[opts.network], host: opts.host,
        target: opts.target, browserVersion, url, startedAt: new Date().toISOString(),
        batteryTemp: opts.target === 'android' ? batteryTemp() : null
      };
      const label = `[${i + 1}/${todo.length}] round ${round} ${page.app}/${page.config}`;
      try {
        const { exp, consoleErrors } = await runOnce(browser, page, opts, url);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ meta, consoleErrors, exp }) + '\n');
        const eta = ((Date.now() - t0) / (i + 1)) * (todo.length - i - 1) / 60000;
        const ttff = exp.ttff === null ? 'n/a' : `${exp.ttff.toFixed(0)} ms`;
        console.log(`${label}: TTFF ${ttff}, frames ${exp.frames ? exp.frames.length : '-'}${exp.timedOut ? ' (timed out)' : ''}, ETA ${eta.toFixed(0)} min`);
      } catch (err) {
        console.log(`${label}: FAILED ${err.message}`);
        fs.appendFileSync(failLog, JSON.stringify({
          ...meta, error: err.message, consoleErrors: err.consoleErrors || [], partial: err.partial || null
        }) + '\n');
      }
      if (i < todo.length - 1) { await sleep(opts.cooldown * 1000); }
    }
  } finally {
    await closeBrowser(browser, opts.target);
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
