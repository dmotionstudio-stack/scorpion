// Scorpion's helper on Windows (win-helper.cs): one small program, kept
// running, that lists windows, works them, moves the mouse and keeps the
// taskbar's room as an app bar, answering over a pipe in a millisecond or two
// where a PowerShell call takes tens or hundreds. It's compiled on first use
// with the C# compiler that comes with Windows (.NET Framework 4), kept in
// Scorpion's data folder, and compiled again when its source changes. Until
// initHelper() is called, or if it can't be built or keeps stopping, call()
// throws and windows-control.js does the same thing with PowerShell.
import { spawn, execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'win-helper.cs');
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

let dir = null; // where the compiled helper is kept
let proc = null;
let starting = null;
let failures = 0; // it stopped or couldn't be built: after three, PowerShell from then on
let seq = 0;
const waiting = new Map(); // id → { resolve, reject, timer }

export function initHelper(folder) { dir = folder; }
export const helperUsable = () => process.platform === 'win32' && Boolean(dir) && failures < 3;

// The compiled helper for this source (built if it isn't there yet).
async function build() {
  const source = fs.readFileSync(SOURCE, 'utf8'); // (also from inside app.asar)
  const hash = crypto.createHash('sha1').update(source).digest('hex').slice(0, 12);
  const exe = path.join(dir, `scorpion-helper-${hash}.exe`);
  if (fs.existsSync(exe)) return exe;
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, `scorpion-helper-${hash}.cs`);
  fs.writeFileSync(src, source);
  await new Promise((resolve, reject) => {
    execFile(CSC, ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', `/out:${exe}`, src], { windowsHide: true, timeout: 60_000 }, (err, out) => {
      if (err) reject(new Error(`The Windows helper didn't build: ${String(out || err.message).trim().slice(0, 400)}`)); else resolve();
    });
  });
  fs.rmSync(src, { force: true });
  // Helpers built from older sources aren't needed any more.
  for (const f of fs.readdirSync(dir)) if (/^scorpion-helper-[0-9a-f]+\.(exe|cs)$/.test(f) && !f.includes(hash)) fs.rmSync(path.join(dir, f), { force: true });
  return exe;
}

function stopped(err) {
  proc = null;
  starting = null;
  failures += 1;
  for (const [id, w] of waiting) { clearTimeout(w.timer); w.reject(err); waiting.delete(id); }
}

function start() {
  if (proc) return Promise.resolve(proc);
  starting ??= build().then((exe) => {
    const p = spawn(exe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let buf = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        const [id, status, ...rest] = line.split('\t');
        const w = waiting.get(id);
        if (!w) continue;
        waiting.delete(id);
        clearTimeout(w.timer);
        if (status === 'ok') w.resolve(rest.join('\t')); else w.reject(new Error(rest.join('\t') || 'The Windows helper failed'));
      }
    });
    p.on('exit', (code) => { if (proc === p) stopped(new Error(`The Windows helper stopped (exit ${code})`)); });
    p.on('error', (err) => { if (proc === p) stopped(err); });
    proc = p;
    return p;
  }).catch((err) => { stopped(err); throw err; });
  return starting;
}

// One request; resolves with the helper's answer (a string).
export async function call(cmd, ...args) {
  if (!helperUsable()) throw new Error('The Windows helper is not available');
  const p = await start();
  const id = String(++seq);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`The Windows helper didn't answer (${cmd})`)); }, 10_000);
    waiting.set(id, { resolve, reject, timer });
    p.stdin.write(`${[id, cmd, ...args.map((a) => String(a).replace(/[\t\r\n]/g, ' '))].join('\t')}\n`);
  });
}

// A list answer: records of fields.
export const rows = (text) => (text ? text.split('\x1e').map((r) => r.split('\x1f')) : []);

export function stopHelper() {
  if (proc) { try { proc.stdin.end(); } catch { /* gone */ } proc = null; }
}
