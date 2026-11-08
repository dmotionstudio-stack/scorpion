// Finds model files on this computer. A model is a GGUF file: it starts with
// the four bytes "GGUF", so a file only counts when it does (a renamed video
// or a test fixture isn't offered). Two kinds of search:
//   common places  the folders other model tools use (Downloads, LM Studio,
//                  GPT4All, Jan, the Hugging Face cache, Ollama...)
//   whole computer every drive, skipping system and program folders
// Nothing is changed: the search only reads folder listings and the first
// four bytes of candidates. Ollama keeps models as extension-less blobs named
// by hash; its manifests say which blob is which model, so those are found too.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isEmbeddingFile } from './models.js';

const MB = 1024 * 1024;
// Folders never worth looking inside, wherever they are (build output, system bins).
const SKIP = new Set(['node_modules', '.git', '$recycle.bin', 'system volume information', 'winsxs', '$windows.~bt', 'msocache']);
// And the system's own folders, only at the top of a drive (so a folder you named
// "Library" or "System" further down is still searched).
const SKIP_TOP = new Set(['windows', 'program files', 'program files (x86)', 'programdata', 'recovery',
  'system', 'library', 'private', 'usr', 'bin', 'sbin', 'etc', 'dev', 'proc', 'sys', 'var', 'lib', 'lib64', 'snap', 'applications', 'cores']);

// Where other model tools keep models, and the usual places a download lands.
export function commonFolders({ platform = process.platform, home = os.homedir(), env = process.env, exists = fs.existsSync } = {}) {
  const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const list = [
    ...['Downloads', 'Documents', 'Desktop', 'models', 'Models'].map((n) => path.join(home, n)),
    path.join(home, '.lmstudio', 'models'), path.join(home, '.cache', 'lm-studio', 'models'), path.join(home, '.cache', 'huggingface', 'hub'),
    path.join(home, '.cache', 'gpt4all'), path.join(home, '.ollama', 'models'), path.join(home, 'jan', 'models'), path.join(home, '.jan', 'models'),
    path.join(home, 'llama.cpp', 'models'), path.join(home, 'text-generation-webui', 'models'),
  ];
  if (platform === 'win32') {
    list.push(path.join(local, 'nomic.ai', 'GPT4All'), path.join(roaming, 'jan', 'data', 'models'), path.join(roaming, 'LM Studio', 'models'));
    for (let c = 67; c <= 90; c++) for (const n of ['Models', 'models', 'AI', 'LLM']) list.push(`${String.fromCharCode(c)}:\\${n}`);
  } else if (platform === 'darwin') {
    list.push(path.join(home, 'Library', 'Application Support', 'nomic.ai', 'GPT4All'), path.join(home, 'Library', 'Application Support', 'jan', 'data', 'models'), '/Volumes');
  } else {
    list.push(path.join(home, '.local', 'share', 'nomic.ai', 'GPT4All'), '/usr/share/scorpion/models', '/media', '/mnt');
  }
  // One entry per folder (Windows and macOS don't tell Models from models).
  const seen = new Set();
  return list.map((d) => path.resolve(d)).filter((d) => {
    const key = platform === 'linux' ? d : d.toLowerCase();
    return !seen.has(key) && seen.add(key);
  }).filter((d) => exists(d));
}

// The top of every place to look at in "whole computer".
export function wholeComputerRoots({ platform = process.platform, home = os.homedir(), exists = fs.existsSync } = {}) {
  if (platform === 'win32') {
    const drives = [];
    for (let c = 67; c <= 90; c++) { const d = `${String.fromCharCode(c)}:\\`; if (exists(d)) drives.push(d); }
    return drives;
  }
  return [home, '/Volumes', '/media', '/mnt'].filter((d) => exists(d));
}

// True when the file begins with "GGUF".
export function isGguf(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(4);
    return fs.readSync(fd, b, 0, 4, 0) === 4 && b.toString('latin1') === 'GGUF';
  } catch { return false; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
}

// Ollama's models: manifests name them, blobs hold them.
function ollamaModels(root) {
  const out = [];
  const manifests = path.join(root, 'manifests');
  const walk = (dir, trail) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p, [...trail, e.name]); continue; }
      try {
        const layers = JSON.parse(fs.readFileSync(p, 'utf8')).layers || [];
        const layer = layers.find((l) => l.mediaType === 'application/vnd.ollama.image.model');
        if (!layer?.digest) continue;
        // registry.ollama.ai/library/llama3/8b -> "llama3:8b"; other registries keep their owner
        const parts = trail.slice(1); // drops the registry host
        const owner = parts[0] === 'library' ? '' : `${parts[0]}/`;
        out.push({ file: path.join(root, 'blobs', layer.digest.replace(':', '-')), name: `${owner}${parts.slice(1).join('/')}:${e.name} (Ollama)` });
      } catch { /* not a manifest */ }
    }
  };
  walk(manifests, []);
  return out;
}

// Walks the roots (never following links) and returns the models found.
//   known: Set of paths already listed in Scorpion (left out)
//   minBytes: smaller files are not models (test files, vocabularies)
//   maxMs: the longest the search runs; it returns what it has, stopped: true
//   onProgress({ folders, found, current }): now and then
export async function scanForModels({ roots, known = new Set(), minBytes = 20 * MB, maxMs = 180_000, signal, onProgress } = {}) {
  const started = Date.now();
  const found = new Map(); // normalized path -> model
  const seenKnown = new Set([...known].map((p) => path.resolve(p).toLowerCase()));
  let folders = 0;
  let stopped = false;
  let lastTick = 0;
  const tick = async (current) => {
    folders += 1;
    if (Date.now() - lastTick > 250) { lastTick = Date.now(); onProgress?.({ folders, found: found.size, current }); await new Promise((r) => setImmediate(r)); }
    if (signal?.aborted || Date.now() - started > maxMs) stopped = true;
  };
  const add = (file, name) => {
    const key = path.resolve(file).toLowerCase();
    if (found.has(key) || seenKnown.has(key)) return;
    let st; try { st = fs.statSync(file); } catch { return; }
    if (!st.isFile() || st.size < minBytes || !isGguf(file)) return;
    found.set(key, { path: file, name: name || path.basename(file).replace(/\.gguf$/i, ''), bytes: st.size, kind: isEmbeddingFile(file) || /embed/i.test(name || '') ? 'embedding' : 'chat', folder: path.dirname(file) });
  };
  const visit = async (dir, depth) => {
    if (stopped || depth > 12) return;
    await tick(dir);
    if (stopped) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const atTop = path.parse(dir).root === dir; // C:\ or /
    for (const e of entries) {
      if (stopped) return;
      if (e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        const lower = e.name.toLowerCase();
        if (SKIP.has(lower) || (atTop && SKIP_TOP.has(lower))) continue;
        await visit(p, depth + 1);
      } else if (/\.gguf$/i.test(e.name)) {
        // The later parts of a split model load through part 1.
        const shard = e.name.match(/-(\d{5})-of-\d{5}\.gguf$/i);
        if (!shard || shard[1] === '00001') add(p);
      }
    }
  };
  for (const root of roots) {
    if (stopped) break;
    // Ollama's folder is blobs, not .gguf files: read its manifests.
    if (/[\\/]\.ollama[\\/]models$/i.test(root) || (fs.existsSync(path.join(root, 'manifests')) && fs.existsSync(path.join(root, 'blobs')))) {
      for (const m of ollamaModels(root)) add(m.file, m.name);
    }
    await visit(root, 0);
  }
  onProgress?.({ folders, found: found.size, current: '' });
  const models = [...found.values()].sort((a, b) => b.bytes - a.bytes);
  return { models, folders, ms: Date.now() - started, stopped };
}
