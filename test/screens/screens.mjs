// Picture tests: opens Scorpion with fresh data, takes a picture of each main
// screen, and compares it with the picture kept in test/screens/baseline.
// GitHub Actions runs it on Linux under Xvfb (.github/workflows/screens.yml),
// so the baselines are Linux pictures; on another system use --out only.
//
//   node test/screens/screens.mjs --out shots                     pictures only
//   node test/screens/screens.mjs --out shots --compare test/screens/baseline
//
// A screen fails when more than 1% of its pixels changed. A screen with no
// baseline yet is reported, not failed. For each screen that changed, shots/
// gets the new picture and <name>.diff.png with the changes in red.
// No dependencies: Electron is driven over its DevTools protocol, and the
// pictures are compared in its own page.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const OUT = path.resolve(arg('--out') || 'shots');
const BASELINE = arg('--compare') && path.resolve(arg('--compare'));
const FAIL_AT = 0.01; // share of pixels that may change
const PORT = 9333;
const W = 1280, H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The screens: a name and how to get there from the home screen.
const SCREENS = [
  { name: 'home', go: '' },
  { name: 'chat', go: `document.querySelector('#new-chat').click()` },
  { name: 'settings', go: `document.querySelector('#open-settings').click(); document.querySelector('[data-view=settings]').click()` },
  { name: 'models', go: `document.querySelector('#open-settings').click(); document.querySelector('[data-view=models]').click()` },
  { name: 'memory', go: `document.querySelector('#open-settings').click(); document.querySelector('[data-view=memory]').click()` },
  { name: 'palette', go: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); const i = document.querySelector('#pal-input'); i.value = 'se'; i.dispatchEvent(new Event('input'))` },
  { name: 'home-bone', go: `document.documentElement.dataset.theme = 'bone'` },
  { name: 'edge', go: `location.href = 'scorpion://app/edge.html'`, size: [76, H], settle: 2500 },
];

// The same moment every time (10:00 on 15 January, then running), and no motion.
const STEADY = `(() => {
  const Real = Date, start = Real.now(), at = new Real(2026, 0, 15, 10, 0, 0).getTime();
  const now = () => at + (Real.now() - start);
  globalThis.Date = class extends Real { constructor(...a) { super(...(a.length ? a : [now()])); } static now() { return now(); } };
  addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style');
    s.textContent = '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; caret-color: transparent !important; }';
    document.head.appendChild(s);
  });
})()`;

// Compares two PNGs (base64) in the page: the share of pixels that changed, and a picture of them.
const COMPARE = `async (a, b) => {
  const load = async (b64) => createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
  const [x, y] = await Promise.all([load(a), load(b)]);
  if (x.width !== y.width || x.height !== y.height) return { share: 1, size: [x.width, x.height, y.width, y.height] };
  const px = (img) => { const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height); };
  const p = px(x), q = px(y), out = new ImageData(p.width, p.height);
  let changed = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    const d = Math.max(Math.abs(p.data[i] - q.data[i]), Math.abs(p.data[i + 1] - q.data[i + 1]), Math.abs(p.data[i + 2] - q.data[i + 2]));
    const grey = (q.data[i] + q.data[i + 1] + q.data[i + 2]) / 12;
    if (d > 32) { changed++; out.data.set([255, 0, 0, 255], i); } else out.data.set([grey, grey, grey, 255], i);
  }
  const c = new OffscreenCanvas(p.width, p.height);
  c.getContext('2d').putImageData(out, 0, 0);
  const blob = await c.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { share: changed / (p.width * p.height), diff: btoa(s) };
}`;

fs.mkdirSync(OUT, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-screens-'));
const store = await import(new URL('../../src/main/store.js', import.meta.url));
store.initStore(data);
store.updateSettings({ welcomeDone: true, fullModeAtStart: false, taskbarAlwaysOn: false, handsAlwaysOn: false, wakeWord: false });

const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const app = spawn(electron, [ROOT, `--remote-debugging-port=${PORT}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], {
  env: { ...process.env, SCORPION_DATA_DIR: data }, stdio: ['ignore', 'inherit', 'inherit'],
});

let failed = 0;
let sock;
try {
  let target;
  for (let i = 0; i < 120 && !target; i++) {
    await sleep(500);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.url.startsWith('scorpion://app/index')); } catch { /* not up yet */ }
  }
  if (!target) throw new Error("Scorpion's window didn't open");
  sock = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { sock.addEventListener('open', r, { once: true }); sock.addEventListener('error', j, { once: true }); });
  let n = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++n;
    sock.addEventListener('message', function on(e) {
      const m = JSON.parse(e.data);
      if (m.id !== id) return;
      sock.removeEventListener('message', on);
      if (m.error) reject(new Error(`${method}: ${m.error.message}`)); else resolve(m.result);
    });
    sock.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const errors = [];
  sock.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0]); });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STEADY });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  for (const screen of SCREENS) {
    const [w, h] = screen.size || [W, H];
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    // Each screen starts from a fresh page on the home screen.
    await send('Page.navigate', { url: 'scorpion://app/index.html' });
    await sleep(4000);
    if (screen.go) await ev(screen.go);
    await sleep(screen.settle || 1500);
    const shot = (await send('Page.captureScreenshot', { format: 'png' })).data;
    fs.writeFileSync(path.join(OUT, `${screen.name}.png`), Buffer.from(shot, 'base64'));
    const base = BASELINE && path.join(BASELINE, `${screen.name}.png`);
    if (!base) { console.log(`${screen.name}: taken`); continue; }
    if (!fs.existsSync(base)) { console.log(`${screen.name}: no baseline yet (the new picture is in ${OUT})`); continue; }
    // Compared in Scorpion's page (it has the canvas), back on index.html.
    await send('Page.navigate', { url: 'scorpion://app/index.html' });
    await sleep(1500);
    const r = await ev(`(${COMPARE})(${JSON.stringify(fs.readFileSync(base).toString('base64'))}, ${JSON.stringify(shot)})`);
    const pct = (r.share * 100).toFixed(2);
    if (r.size) { failed++; console.log(`${screen.name}: FAILED, the size changed (${r.size.join(' × ')})`); continue; }
    if (r.share > 0) fs.writeFileSync(path.join(OUT, `${screen.name}.diff.png`), Buffer.from(r.diff, 'base64'));
    if (r.share > FAIL_AT) { failed++; console.log(`${screen.name}: FAILED, ${pct}% of it changed (see ${screen.name}.diff.png)`); }
    else console.log(`${screen.name}: ok (${pct}% changed)`);
  }
  if (errors.length) { failed++; console.log(`Page errors:\n  ${[...new Set(errors)].join('\n  ')}`); }
} catch (err) {
  failed++;
  console.error(err.message);
} finally {
  sock?.close();
  app.kill();
  await sleep(500);
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 3 });
}
console.log(failed ? `${failed} problem(s).` : 'All screens as expected.');
process.exit(failed ? 1 : 0);
