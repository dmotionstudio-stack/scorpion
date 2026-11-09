// What Scorpion's Files screen lists. With no folder it is the top of the
// computer: your usual folders, then the drives on Windows ("This PC") or, on
// a Mac, the startup disk and whatever is mounted under /Volumes (USB sticks,
// other disks, network shares). With a folder, its contents.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLACES = { win32: ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos'], darwin: ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Movies'] };

// The top level. `io` is for tests: { exists, readdir, realpath }.
export function rootItems({ platform = process.platform, home = os.homedir(), io = {} } = {}) {
  const exists = io.exists || fs.existsSync;
  // Paths are built the way that system writes them, whichever system this runs on.
  const P = platform === 'win32' ? path.win32 : path.posix;
  const places = (PLACES[platform] || PLACES.win32).map((n) => ({ name: n, path: P.join(home, n), dir: true })).filter((p) => exists(p.path));
  const drives = [];
  if (platform === 'darwin') {
    drives.push({ name: 'Macintosh HD', path: '/', dir: true });
    const readdir = io.readdir || ((d) => fs.readdirSync(d));
    const realpath = io.realpath || fs.realpathSync;
    let volumes = [];
    try { volumes = readdir('/Volumes'); } catch { /* none mounted */ }
    for (const name of volumes) {
      if (name.startsWith('.')) continue;
      const p = `/Volumes/${name}`;
      let real = p;
      try { real = realpath(p); } catch { /* a share that went away */ continue; }
      if (real === '/') continue; // the startup disk, listed above under its own name
      drives.push({ name, path: p, dir: true });
    }
  } else if (platform === 'win32') {
    for (let c = 67; c <= 90; c++) { const d = `${String.fromCharCode(c)}:\\`; if (exists(d)) drives.push({ name: d, path: d, dir: true }); }
  }
  return [...places, ...drives];
}

// A folder for the Files screen; no folder means the top of the computer.
export function listFolder(dir, opts = {}) {
  if (!dir) return { dir: null, parent: null, items: rootItems(opts) };
  const items = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    let st = null;
    try { st = fs.statSync(p); } catch { /* no access */ }
    if (!st) continue;
    items.push({ name: e.name, path: p, dir: st.isDirectory(), size: st.isDirectory() ? null : st.size, modified: st.mtimeMs, hidden: e.name.startsWith('.') || /^(desktop\.ini|thumbs\.db|\$recycle\.bin|system volume information)$/i.test(e.name) });
  }
  items.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const parent = path.dirname(dir);
  return { dir, parent: parent === dir ? '' : parent, items };
}
