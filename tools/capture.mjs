// Screenshot + boot verification driver. Starts the local static server, drives headless
// Chromium over the DevTools protocol, and:
//   1. boots the game with no query string — asserts the title renders, the canvas is not
//      blank, and no console errors were logged;
//   2. for every entry in shots.json, loads the staged scene, waits for __shotReady, and
//      captures a 1280x800 JPEG into screenshots/.
// Run: node tools/capture.mjs

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`;
const PORT = 9333;
const BASE = 'http://localhost:8080';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(120);
  }
}

const server = spawn('node', [join(root, 'serve.ts')], { stdio: 'ignore' });
const chrome = spawn(CHROME, [
  '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/ladle-chrome-${PORT}`, '--window-size=1280,800', 'about:blank',
], { stdio: 'ignore' });

let ws;
let msgId = 0;
const pending = new Map();
const consoleErrors = [];

function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

async function evaluate(sessionId, expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (res.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(res.exceptionDetails).slice(0, 400)}`);
  return res.result.value;
}

try {
  await waitFor(async () => {
    try { return (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { return false; }
  }, 15000, 'chrome devtools');
  await waitFor(async () => {
    try { return (await fetch(BASE)).ok; } catch { return false; }
  }, 15000, 'static server');

  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(JSON.stringify(msg.params.args).slice(0, 300));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(`exception: ${JSON.stringify(msg.params.exceptionDetails).slice(0, 300)}`);
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push(`log: ${msg.params.entry.text}`);
    }
  };

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Log.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);

  async function load(url) {
    await send('Page.navigate', { url }, sessionId);
    await sleep(150);
  }

  // 1) Boot test: the live game, title screen, no errors, non-blank canvas.
  await load(`${BASE}/`);
  await waitFor(() => evaluate(sessionId, 'Boolean(window.__ladle)'), 10000, 'game boot');
  await sleep(900);
  const bootScreen = await evaluate(sessionId, 'window.__ladle.state.screen');
  const pngLen = await evaluate(sessionId, "document.getElementById('game').toDataURL('image/png').length");
  console.log(`boot: screen=${bootScreen} canvasPngBytes=${pngLen}`);
  if (bootScreen !== 'title') throw new Error(`expected title screen, got ${bootScreen}`);
  if (!(pngLen > 30000)) throw new Error('canvas looks blank');

  // 2) The four staged screenshots.
  const shots = JSON.parse(readFileSync(join(root, 'shots.json'), 'utf8'));
  for (const shot of shots) {
    await load(`${BASE}/${shot.query}`);
    await waitFor(() => evaluate(sessionId, 'window.__shotReady === true'), 10000, `shot ${shot.name}`);
    await sleep(120);
    const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88, fromSurface: true }, sessionId);
    const out = join(root, 'screenshots', shot.name);
    writeFileSync(out, Buffer.from(data, 'base64'));
    console.log(`captured ${shot.name}: ${Buffer.from(data, 'base64').length} bytes`);
  }

  if (consoleErrors.length) {
    console.log('CONSOLE ERRORS:');
    for (const e of consoleErrors) console.log(' -', e);
    process.exitCode = 1;
  } else {
    console.log('console: no errors');
  }
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  chrome.kill('SIGKILL');
  server.kill('SIGKILL');
}
