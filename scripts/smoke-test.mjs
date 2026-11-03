// A check of the packaged app, as people get it (the release workflow runs it
// after building, on each system): node scripts/smoke-test.mjs [release dir]
//
// Starts the built Scorpion with a fresh data folder (older settings in it, to
// be brought up to date) and checks, through Chrome's debugging protocol:
//   - its window and page load, and the page reaches Scorpion
//   - the model engine runs in a process of its own and reports the hardware
//   - Windows: the native helper builds and lists the open windows
//   - the settings were brought up to the current version
// Then stops it. Exits 1 with what failed.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const releaseDir = path.resolve(process.argv[2] || 'release');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The built app's program.
function findApp() {
  if (process.platform === 'win32') return path.join(releaseDir, 'win-unpacked', 'Scorpion.exe');
  if (process.platform === 'darwin') {
    for (const d of fs.readdirSync(releaseDir)) {
      const exe = path.join(releaseDir, d, 'Scorpion.app', 'Contents', 'MacOS', 'Scorpion');
      if (d.startsWith('mac') && fs.existsSync(exe)) return exe;
    }
  }
  const exe = path.join(releaseDir, 'linux-unpacked', 'scorpion');
  return exe;
}
// The command lines of the processes running now.
function commandLines() {
  if (process.platform === 'win32') {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }'], { encoding: 'utf8', maxBuffer: 32 << 20 });
  }
  return execFileSync('ps', ['-axo', 'command'], { encoding: 'utf8', maxBuffer: 32 << 20 });
}

const app = findApp();
if (!fs.existsSync(app)) { console.error(`No built app at ${app}`); process.exit(1); }
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-smoke-'));
// Settings as an older Scorpion left them: the removed stones taskbar, no version.
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({
  welcomeDone: true, fullModeAtStart: false, taskbarAlwaysOn: false, summonDot: false, railAway: false,
  handsAlwaysOn: false, stage: false, appsFull: false, taskbar: { layout: 'gravity' },
}));
const PORT = 9333;
const proc = spawn(app, [`--remote-debugging-port=${PORT}`], { env: { ...process.env, SCORPION_DATA_DIR: data }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
proc.stdout.on('data', (d) => { log += d; });
proc.stderr.on('data', (d) => { log += d; });

const problems = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) problems.push(what); };
try {
  // The page.
  let target = null;
  for (let i = 0; i < 120 && !target; i++) {
    await sleep(1000);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page' && t.url.startsWith('scorpion://app/index')); } catch { /* not yet */ }
  }
  check(Boolean(target), 'the window and its page load');
  if (!target) throw new Error('no page');
  const sock = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { sock.addEventListener('open', r, { once: true }); sock.addEventListener('error', j, { once: true }); });
  let n = 0;
  const run = (expression) => new Promise((resolve) => {
    const id = ++n;
    sock.addEventListener('message', function h(e) {
      const m = JSON.parse(e.data);
      if (m.id !== id) return;
      sock.removeEventListener('message', h);
      resolve(m.result?.exceptionDetails ? { error: m.result.exceptionDetails.exception?.description } : m.result?.result?.value);
    });
    sock.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  for (let i = 0; i < 60 && (await run('typeof window.scorpion?.state')) !== 'function'; i++) await sleep(500);
  check((await run('typeof window.scorpion?.state')) === 'function', 'the page reaches Scorpion');

  // The engine: hardware from it, and it is a process of its own.
  const st = await run('window.scorpion.state().then((s) => JSON.stringify({ hardware: s.hardware, version: s.settings?.settingsVersion, layout: s.settings?.taskbar?.layout }))');
  const s = typeof st === 'string' ? JSON.parse(st) : {};
  check(Boolean(s.hardware && s.hardware.ram > 0 && s.hardware.gpu), `the model engine reports the hardware (${s.hardware ? `${s.hardware.gpu}, ${Math.round(s.hardware.ram / 2 ** 30)} GB` : JSON.stringify(st)})`);
  check(commandLines().includes('engine-process.js'), 'the model engine runs in a process of its own');

  // The settings, brought up to date.
  check(s.version >= 1 && s.layout === 'orbit', `older settings were brought up to date (version ${s.version}, layout ${s.layout})`);

  // Windows: the native helper.
  if (process.platform === 'win32') {
    const wins = await run('window.scorpion.shellWindows().then((l) => l.length)');
    const bin = path.join(data, 'bin');
    const built = fs.existsSync(bin) && fs.readdirSync(bin).some((f) => /^scorpion-helper-[0-9a-f]+\.exe$/.test(f));
    check(Number.isInteger(wins), `the open windows are listed (${wins})`);
    check(built, 'the Windows helper was built');
  }
  sock.close();
} catch (err) {
  problems.push(err.message);
} finally {
  proc.kill();
  await sleep(1500);
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
if (problems.length) {
  console.error(`\nThe packaged app failed ${problems.length} check(s). Its output:\n${log.split('\n').slice(-40).join('\n')}`);
  process.exit(1);
}
console.log('\nThe packaged app works.');
process.exit(0);
