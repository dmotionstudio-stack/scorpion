// The constellation launcher's side in the main process: the projects file,
// recent files (suggestions), previews (a window's live thumbnail, a
// document's thumbnail), icons for files and folders, opening items, and
// import/export of the shared format.
import fs from 'node:fs';
import path from 'node:path';
import * as win from './windows-control.js';
import { FORMAT, exportData, importData, newProject, newNode, markUsed } from '../renderer/constellation-core.js';

let deps = null; // { app, shell, nativeImage, desktopCapturer, dialog, dataDir, launchApp, getWindow }
const file = () => path.join(deps.dataDir, 'constellations.json');

export function initConstellations(d) { deps = d; }

// The saved projects; the first time, one to start from with the apps pinned
// to the taskbar.
export function load(starterApps = []) {
  try {
    const d = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (Array.isArray(d.projects)) return d;
  } catch { /* first run */ }
  const p = newProject('Everyday');
  for (const a of starterApps) p.nodes.push(newNode('app', a.id, a.name));
  const data = { format: FORMAT, projects: [p] };
  save(data);
  return data;
}

export function save(data) {
  if (!data || !Array.isArray(data.projects)) throw new Error('Nothing to save');
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ format: FORMAT, projects: data.projects }));
  fs.renameSync(tmp, file());
  return true;
}

export async function exportTo(data) {
  const r = await deps.dialog.showSaveDialog(deps.getWindow(), { title: 'Export constellations', defaultPath: 'scorpion-constellations.json', filters: [{ name: 'Constellations', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(exportData(data), null, 2));
  return r.filePath;
}

export async function importFrom(data) {
  const r = await deps.dialog.showOpenDialog(deps.getWindow(), { title: 'Import constellations', properties: ['openFile'], filters: [{ name: 'Constellations', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const merged = importData(fs.readFileSync(r.filePaths[0], 'utf8'), data);
  save(merged);
  return merged;
}

// Files or folders to add, from a dialog.
export async function pick(kind) {
  const r = await deps.dialog.showOpenDialog(deps.getWindow(), { title: kind === 'folder' ? 'Add folders' : 'Add files', properties: [kind === 'folder' ? 'openDirectory' : 'openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
}

// The suggestions, newest first: files and folders opened recently (Windows
// keeps a shortcut to each in its Recent folder, unless that is turned off in
// its privacy settings), and the files changed most recently in Desktop,
// Documents, Downloads and Pictures (and one level of folders inside them).
export async function recent(limit = 30) {
  if (process.platform !== 'win32') return [];
  const opened = await win.runPs(`$sh = New-Object -ComObject WScript.Shell
    Get-ChildItem -Path "$env:APPDATA\\Microsoft\\Windows\\Recent" -Filter '*.lnk' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First ${limit * 2} | ForEach-Object {
      $t = $sh.CreateShortcut($_.FullName).TargetPath
      if ($t -and (Test-Path -LiteralPath $t)) { [pscustomobject]@{ path = $t; dir = (Test-Path -LiteralPath $t -PathType Container); at = [long]($_.LastWriteTime.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds } }
    } | Select-Object -First ${limit} | ConvertTo-Json -Compress`, { timeout: 30000 }).catch(() => '');
  let list = [];
  try { list = opened ? [].concat(JSON.parse(opened)) : []; } catch { /* none */ }
  const home = deps?.app?.getPath('home') || process.env.USERPROFILE || '';
  const changed = [];
  const look = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || /^(desktop\.ini|thumbs\.db)$/i.test(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth > 0) look(p, depth - 1); continue; }
      try { changed.push({ path: p, dir: false, at: fs.statSync(p).mtimeMs }); } catch { /* no access */ }
    }
  };
  for (const name of ['Desktop', 'Documents', 'Downloads', 'Pictures']) look(path.join(home, name), 1);
  const seen = new Set(list.map((x) => x.path.toLowerCase()));
  for (const c of changed.sort((a, b) => b.at - a.at)) if (!seen.has(c.path.toLowerCase())) { list.push(c); seen.add(c.path.toLowerCase()); }
  return list.sort((a, b) => b.at - a.at).slice(0, limit);
}

// Facts for a file or folder: missing ones show as eclipsed (a warning).
export function pathInfo(p) {
  try {
    const st = fs.statSync(p);
    return { exists: true, dir: st.isDirectory(), size: st.isDirectory() ? null : st.size, modified: st.mtimeMs };
  } catch { return { exists: false }; }
}

const icons = new Map();
// A file's or folder's icon (as Windows shows it).
export async function iconFor(p) {
  if (!icons.has(p)) icons.set(p, await deps.app.getFileIcon(p, { size: 'large' }).then((i) => (i.isEmpty() ? null : i.toDataURL())).catch(() => null));
  return icons.get(p);
}

// A preview: a running window's live thumbnail, or a document's thumbnail.
export async function preview({ hwnd, path: p } = {}) {
  if (hwnd) {
    const sources = await deps.desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 360, height: 220 } }).catch(() => []);
    const s = sources.find((x) => x.id.startsWith(`window:${hwnd}:`));
    return s && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null;
  }
  if (p && fs.existsSync(p)) {
    const img = await deps.nativeImage.createThumbnailFromPath(p, { width: 360, height: 220 }).catch(() => null);
    return img && !img.isEmpty() ? img.toDataURL() : null;
  }
  return null;
}

// Opens an item: an app, a file or folder, or a website (in the browser).
export async function open(node) {
  if (node.kind === 'app') return deps.launchApp({ id: node.target, name: node.label });
  if (node.kind === 'website') {
    const url = /^[a-z]+:\/\//i.test(node.target) ? node.target : `https://${node.target}`;
    if (!/^https?:\/\//i.test(url)) throw new Error('Only web addresses (http, https) can be opened.');
    return deps.shell.openExternal(url);
  }
  if (!fs.existsSync(node.target)) throw new Error(`${node.target} is not there any more.`);
  const err = await deps.shell.openPath(node.target);
  if (err) throw new Error(err);
  return true;
}

// Opening also counts as using it (relevance), saved with the projects.
export async function launch(data, projectId, nodeId) {
  const p = data.projects.find((x) => x.id === projectId);
  const n = p?.nodes.find((x) => x.id === nodeId);
  if (!n) throw new Error('That item is gone.');
  await open(n);
  markUsed(n);
  save(data);
  return data;
}
