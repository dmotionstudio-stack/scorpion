// PC cleaner (Windows): finds junk in a fixed list of safe places, says what
// each takes, and deletes only what it is asked to. Ported from the user's
// Agent-Cleaner.ps1, with its allowlist:
//   - every deletion target is checked against the allowlisted roots first;
//   - %TEMP%\claude* (live agent sessions) is never touched;
//   - files in use are skipped, never forced;
//   - Downloads and the Recycle Bin are only reported.
// What it leaves to Windows or to that script on purpose: emptying the Recycle
// Bin (permanent, so the user does it), DISM and Windows Update's services.
// The pc_cleaner tool (tools.js) asks the user before it deletes anything.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DAY = 86_400_000;
// A name like claude, claude-1234 or claudeXYZ in the path: never.
const NEVER = /\\claude($|\\|-)/i;

// Names matching a pattern with * (case-insensitive), as the script's -like.
const like = (name, pattern) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i').test(name);

// The categories, with their places under the given environment.
// A root: { dir, skip: [name patterns], olderThanDays, only: [name patterns] }.
export function categoryList(env = process.env) {
  const local = env.LOCALAPPDATA || '';
  const win = env.SystemRoot || 'C:\\Windows';
  const user = env.USERPROFILE || '';
  const temp = env.TEMP || path.join(local, 'Temp');
  const edge = path.join(local, 'Microsoft', 'Edge', 'User Data', 'Default');
  const chrome = path.join(local, 'Google', 'Chrome', 'User Data', 'Default');
  const explorer = path.join(local, 'Microsoft', 'Windows', 'Explorer');
  return [
    { id: 'Temp', name: 'Your temp folder (not Claude or Scorpion sessions)', roots: [{ dir: temp, skip: ['claude*'] }], unattended: true },
    { id: 'CrashDumps', name: 'Crash dumps and error reports', roots: [{ dir: path.join(local, 'CrashDumps') }, { dir: path.join(local, 'Microsoft', 'Windows', 'WER') }], unattended: true },
    { id: 'PackageCaches', name: 'npm, pip and uv download caches', roots: [{ dir: path.join(local, 'npm-cache') }, { dir: path.join(local, 'pip', 'cache') }, { dir: path.join(local, 'uv', 'cache') }], unattended: true },
    { id: 'BrowserCaches', name: 'Edge and Chrome caches', roots: [{ dir: path.join(edge, 'Cache') }, { dir: path.join(edge, 'Code Cache') }, { dir: path.join(chrome, 'Cache') }, { dir: path.join(chrome, 'Code Cache') }], unattended: true },
    { id: 'ThumbCaches', name: 'Thumbnail and icon caches', roots: [{ dir: explorer, only: ['thumbcache_*.db', 'iconcache_*.db'], files: true }], unattended: true },
    { id: 'WinTemp', name: 'Windows temp folder', needsAdmin: true, roots: [{ dir: path.join(win, 'Temp') }] },
    { id: 'Prefetch', name: 'Windows Prefetch', needsAdmin: true, roots: [{ dir: path.join(win, 'Prefetch') }] },
    { id: 'DoCache', name: 'Delivery Optimization cache', needsAdmin: true, roots: [{ dir: path.join(win, 'ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization') }] },
    { id: 'CbsLogs', name: 'Windows component logs older than 7 days', needsAdmin: true, roots: [{ dir: path.join(win, 'Logs', 'CBS'), olderThanDays: 7 }] },
    { id: 'RecycleBin', name: 'Recycle Bin (reported only: empty it yourself)', reportOnly: true, roots: [] },
    { id: 'StaleInstallers', name: 'Installers in Downloads older than 30 days (reported only)', reportOnly: true, roots: [{ dir: path.join(user, 'Downloads'), only: ['*.msi', '*.exe'], olderThanDays: 30, recursive: true }] },
  ];
}

const allowedRoots = (cats) => cats.filter((c) => !c.reportOnly).flatMap((c) => c.roots.map((r) => path.resolve(r.dir)));

// Whether a path is inside an allowlisted place (and not under a claude folder).
export function isAllowed(target, cats) {
  const full = path.resolve(target);
  if (NEVER.test(full)) return false;
  return allowedRoots(cats).some((r) => full.toLowerCase() === r.toLowerCase() || full.toLowerCase().startsWith(`${r.toLowerCase()}${path.sep}`));
}

// Bytes in a file or folder (links are not followed).
function sizeOf(p) {
  let st;
  try { st = fs.lstatSync(p); } catch { return 0; }
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  let sum = 0;
  let names = [];
  try { names = fs.readdirSync(p); } catch { return 0; }
  for (const n of names) sum += sizeOf(path.join(p, n));
  return sum;
}

// The children of a root this category would take (names that pass its filters).
function targets(root, now) {
  let names = [];
  try { names = fs.readdirSync(root.dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (root.skip?.some((p) => like(name, p))) continue;
    if (root.only && !root.only.some((p) => like(name, p))) continue;
    const full = path.join(root.dir, name);
    if (root.olderThanDays) {
      let st; try { st = fs.lstatSync(full); } catch { continue; }
      if (now - st.mtimeMs < root.olderThanDays * DAY) continue;
    }
    out.push(full);
  }
  return out;
}

// Installers older than 30 days anywhere under Downloads (the one recursive root).
function walkFiles(dir, only, olderMs, now, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) walkFiles(full, only, olderMs, now, out);
    else if (only.some((p) => like(e.name, p))) {
      let st; try { st = fs.statSync(full); } catch { continue; }
      if (now - st.mtimeMs >= olderMs) out.push({ path: full, bytes: st.size });
    }
  }
  return out;
}

let elevated;
// Whether Scorpion is running with administrator rights (fltmc only works then).
export function isElevated() {
  if (elevated === undefined) {
    try { execFileSync('fltmc', [], { stdio: 'ignore', windowsHide: true }); elevated = true; } catch { elevated = false; }
  }
  return elevated;
}

// What the Recycle Bin on the system drive holds (its files, as Windows keeps them).
export function recycleBinBytes(env = process.env) {
  try {
    const drive = env.SystemDrive || 'C:';
    // (The path's $ must reach PowerShell as it is: a single-quoted string.)
    const bin = `${drive}\\$Recycle.Bin`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-ChildItem -LiteralPath '${bin}' -Force -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum`], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
    return Number(out.trim()) || 0;
  } catch { return 0; }
}
// Free bytes on the system drive.
export function systemDriveFree(env = process.env) {
  try { const s = fs.statfsSync(`${env.SystemDrive || 'C:'}\\`); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

// deps: { env, now(), admin(), recycleBytes() -> bytes, logDir, freeBytes() }
export function createCleaner({ env = process.env, now = Date.now, admin = isElevated, recycleBytes = () => recycleBinBytes(env), logDir = null, freeBytes = () => systemDriveFree(env) } = {}) {
  const cats = categoryList(env);
  const byId = (id) => cats.find((c) => c.id.toLowerCase() === String(id).trim().toLowerCase());
  const bytesOf = (c) => {
    if (c.id === 'RecycleBin') return recycleBytes();
    if (c.id === 'StaleInstallers') return walkFiles(c.roots[0].dir, c.roots[0].only, c.roots[0].olderThanDays * DAY, now()).reduce((n, f) => n + f.bytes, 0);
    return c.roots.reduce((sum, r) => sum + targets(r, now()).reduce((n, t) => n + sizeOf(t), 0), 0);
  };
  const describe = (c) => ({ id: c.id, name: c.name, needsAdmin: Boolean(c.needsAdmin), reportOnly: Boolean(c.reportOnly), unattended: Boolean(c.unattended) });

  // Which categories a request means: "" or "all" is every one that can be
  // cleaned here, "safe" the ones fit for a run nobody watches, else ids.
  function pick(request) {
    const text = String(request || '').trim();
    if (!text || /^all$/i.test(text)) return cats.filter((c) => !c.reportOnly);
    if (/^safe$/i.test(text)) return cats.filter((c) => c.unattended);
    return text.split(/[,\s]+/).filter(Boolean).map((id) => {
      const c = byId(id);
      if (!c) throw new Error(`"${id}" isn't a cleaner category. They are: ${cats.map((x) => x.id).join(', ')}`);
      return c;
    });
  }

  // Nothing is deleted: the size of each category.
  function scan(request = '') {
    const chosen = request === '' || /^all$/i.test(String(request)) ? cats : pick(request);
    const rows = chosen.map((c) => ({ ...describe(c), bytes: bytesOf(c) }));
    return { rows, total: rows.filter((r) => !r.reportOnly).reduce((n, r) => n + r.bytes, 0) };
  }

  // Installers listed for the report-only category, biggest first.
  function staleInstallers(limit = 10) {
    const c = byId('StaleInstallers');
    return walkFiles(c.roots[0].dir, c.roots[0].only, c.roots[0].olderThanDays * DAY, now()).sort((a, b) => b.bytes - a.bytes).slice(0, limit);
  }

  // Deletes what is in the chosen categories (each only inside its allowlisted
  // places); what is locked, or needs rights Scorpion hasn't got, is skipped.
  function clean(request) {
    // Deleting is always asked for by name ("all" and "safe" included): a blank
    // request means nothing was chosen, not everything.
    if (!String(request ?? '').trim()) throw new Error('Say which categories to clean');
    const chosen = pick(request);
    if (!chosen.length) throw new Error('Say which categories to clean');
    const startFree = freeBytes?.() ?? null;
    const failures = [];
    const rows = [];
    let freed = 0;
    for (const c of chosen) {
      if (c.reportOnly) { rows.push({ id: c.id, status: 'only reported, never deleted', bytes: 0 }); continue; }
      if (c.needsAdmin && !admin()) { rows.push({ id: c.id, status: 'needs administrator rights: skipped', bytes: 0 }); continue; }
      let got = 0;
      for (const r of c.roots) {
        for (const t of targets(r, now())) {
          if (!isAllowed(t, cats)) { failures.push(`blocked, outside the allowlist: ${t}`); continue; }
          const size = sizeOf(t);
          try { fs.rmSync(t, { recursive: true, force: true, maxRetries: 0 }); if (!fs.existsSync(t)) got += size; else failures.push(`in use, skipped: ${t}`); } catch { failures.push(`in use, skipped: ${t}`); }
        }
      }
      freed += got;
      rows.push({ id: c.id, status: 'cleaned', bytes: got });
    }
    const endFree = freeBytes?.() ?? null;
    const log = writeLog(logDir, now(), { rows, freed, failures, startFree, endFree });
    return { rows, freed, failures: failures.length, startFree, endFree, log };
  }

  return { categories: () => cats.map(describe), scan, clean, staleInstallers, pick };
}

function writeLog(dir, at, { rows, freed, failures, startFree, endFree }) {
  if (!dir) return null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date(at).toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
    const file = path.join(dir, `cleaner-${stamp}.log`);
    const mb = (n) => (n / 1048576).toFixed(1);
    const lines = [`Scorpion PC cleaner, ${new Date(at).toISOString()}`, ...rows.map((r) => `  ${r.id}: ${r.status}${r.bytes ? `, freed ~${mb(r.bytes)} MB` : ''}`), `Freed ~${mb(freed)} MB`];
    if (startFree != null && endFree != null) lines.push(`Disk free: ${(startFree / 1073741824).toFixed(1)} GB -> ${(endFree / 1073741824).toFixed(1)} GB`);
    for (const f of failures) lines.push(`  ${f}`);
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    return file;
  } catch { return null; }
}

// "1.2 GB", "340 MB", "12 KB".
export function formatBytes(n) {
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
