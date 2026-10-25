// Model files: a curated catalog, Scorpion's own library, one-time download,
// import, uninstall and reinstall. Scorpion only uses models it manages itself
// (no sharing with other apps), so every model can be removed and re-added at
// any time. After a model file is on disk Scorpion never touches the network again.
import fs from 'node:fs';
import path from 'node:path';
import { createModelDownloader } from 'node-llama-cpp';
import { paths } from './store.js';

// `skill` is what scripts/model-check.mjs measured with Scorpion's real agent:
//   agent  - passed both the calculator and the Build-mode file test
//   tools  - calls simple tools correctly, but failed the Build-mode file test
//   chat   - failed the tool tests; use it for conversation only
// Entries without `skill` haven't been through that check.
export const CATALOG = [
  {
    id: 'qwen3-4b',
    kind: 'chat',
    name: 'Qwen3 4B Instruct',
    uri: 'hf:unsloth/Qwen3-4B-Instruct-2507-GGUF/Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
    size: '2.5 GB',
    skill: 'agent',
    note: 'Recommended. Passed every agent test, and the fastest reply of the 4B models. Apache-2.0.',
  },
  {
    id: 'qwen3.5-4b',
    kind: 'chat',
    name: 'Qwen3.5 4B',
    uri: 'hf:unsloth/Qwen3.5-4B-GGUF/Qwen3.5-4B-Q4_K_M.gguf',
    size: '2.7 GB',
    skill: 'agent',
    note: 'Newest Qwen (2026). Passed every agent test and writes the best Haitian Creole of the Qwen models; thinks briefly first, so about a quarter slower than Qwen3 4B. Apache-2.0.',
  },
  {
    id: 'gemma3-4b',
    kind: 'chat',
    name: 'Gemma 3 4B',
    uri: 'hf:bartowski/google_gemma-3-4b-it-GGUF/google_gemma-3-4b-it-Q4_K_M.gguf',
    size: '2.3 GB',
    skill: 'tools',
    note: 'Best for other languages: the most natural Haitian Creole, French and Spanish in our tests. Good writing. Gemma licence.',
  },
  {
    id: 'gpt-oss-20b',
    kind: 'chat',
    name: 'gpt-oss 20B',
    uri: 'hf:ggml-org/gpt-oss-20b-GGUF/gpt-oss-20b-MXFP4.gguf',
    size: '12.1 GB',
    skill: 'agent',
    note: 'OpenAI\'s open model: the smartest here, for harder questions. Needs 16 GB RAM; on a small graphics card it runs on the processor (about 20 tokens/sec on a laptop). Apache-2.0.',
  },
  {
    id: 'llama3.2-3b',
    kind: 'chat',
    name: 'Llama 3.2 3B Instruct',
    uri: 'hf:bartowski/Llama-3.2-3B-Instruct-GGUF/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    size: '2.0 GB',
    note: 'Fast general chat.',
  },
  {
    id: 'llama3.2-1b',
    kind: 'chat',
    name: 'Llama 3.2 1B Instruct',
    uri: 'hf:bartowski/Llama-3.2-1B-Instruct-GGUF/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    size: '0.8 GB',
    skill: 'tools',
    note: 'Fastest tested (~120 tokens/sec on a laptop GPU). Llama licence.',
  },
  {
    id: 'gemma3-1b',
    kind: 'chat',
    name: 'Gemma 3 1B',
    uri: 'hf:bartowski/google_gemma-3-1b-it-GGUF/google_gemma-3-1b-it-Q4_K_M.gguf',
    size: '0.8 GB',
    skill: 'chat',
    note: 'Very fast everyday chat. Gemma licence.',
  },
  {
    id: 'nomic-embed',
    kind: 'embedding',
    name: 'Nomic Embed v1.5',
    uri: 'hf:nomic-ai/nomic-embed-text-v1.5-GGUF/nomic-embed-text-v1.5.Q8_0.gguf',
    size: '140 MB',
    note: 'Needed for "chat with documents".',
  },
];

const EMBED_HINTS = ['embed', 'bge-', 'e5-', 'gte-', 'minilm'];

export function isEmbeddingFile(file) {
  const n = path.basename(file).toLowerCase();
  return EMBED_HINTS.some((h) => n.includes(h));
}

// Models shipped inside the installer (extraResources → <resources>/models), and
// a dev-time folder, so a fully offline build can come with a model preinstalled.
// Models that come with Scorpion: inside the app, and on Scorpion OS the
// built-in model in /usr/share/scorpion/models.
function bundledDirs(resourcesPath, appRoot) {
  const dirs = [path.join(resourcesPath || '', 'models'), path.join(appRoot, 'resources', 'models')];
  if (process.platform === 'linux') dirs.push('/usr/share/scorpion/models');
  return dirs;
}

function scan(dir, source) {
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.gguf')) continue;
    const file = path.join(entry.parentPath ?? entry.path, entry.name);
    // Skip non-first shards of split models; llama.cpp loads them via part 1.
    const shard = entry.name.match(/-(\d{5})-of-\d{5}\.gguf$/i);
    if (shard && shard[1] !== '00001') continue;
    out.push({
      path: file,
      name: entry.name.replace(/\.gguf$/i, '').replace(/^hf_[^_]+_/, ''),
      bytes: fs.statSync(file).size,
      kind: isEmbeddingFile(file) ? 'embedding' : 'chat',
      source,
    });
  }
  return out;
}

// Position in the catalog (recommended first); unknown files sort last.
export function catalogRank(model) {
  const i = CATALOG.findIndex((c) => model.name.toLowerCase() === c.uri.split('/').pop().replace(/\.gguf$/i, '').toLowerCase());
  return i === -1 ? CATALOG.length : i;
}

export function listLocalModels({ resourcesPath, appRoot }) {
  fs.mkdirSync(paths.models, { recursive: true });
  const seen = new Set();
  return [
    ...bundledDirs(resourcesPath, appRoot).flatMap((d) => scan(d, 'bundled')),
    ...scan(paths.models, 'library'),
  ].filter((m) => !seen.has(m.path) && seen.add(m.path))
    .sort((a, b) => catalogRank(a) - catalogRank(b));
}

const active = new Map(); // catalog id -> AbortController

export async function downloadModel(id, onProgress) {
  const item = CATALOG.find((m) => m.id === id);
  if (!item) throw new Error(`Unknown model ${id}`);
  if (active.has(id)) throw new Error('Already downloading');
  const controller = new AbortController();
  active.set(id, controller);
  try {
    const downloader = await createModelDownloader({
      modelUri: item.uri,
      dirPath: paths.models,
      showCliProgress: false,
      skipExisting: true,
      onProgress: ({ totalSize, downloadedSize }) => onProgress?.({ id, totalSize, downloadedSize }),
    });
    try {
      return await downloader.download({ signal: controller.signal });
    } catch (err) {
      // A cancelled or failed download leaves a partial file; don't keep it.
      removePartial(downloader.entrypointFilePath);
      throw err;
    }
  } finally {
    active.delete(id);
  }
}

function removePartial(file) {
  if (file) fs.rmSync(`${file}.ipull`, { force: true });
}

// The library file for a catalog entry, if it's installed.
export function catalogFileName(item) {
  return item.uri.split('/').pop().replace(/.gguf$/i, '').toLowerCase();
}
export function findInstalled(item, list) {
  const want = catalogFileName(item);
  return list.find((m) => m.source === 'library' && m.name.toLowerCase() === want) || null;
}

// Partial downloads left from a crash or an older version are useless; clear
// them at start-up (no download can be running yet).
export function cleanPartialDownloads() {
  fs.mkdirSync(paths.models, { recursive: true });
  let removed = 0;
  for (const f of fs.readdirSync(paths.models)) {
    if (f.endsWith('.ipull')) { fs.rmSync(path.join(paths.models, f), { force: true }); removed++; }
  }
  return removed;
}

export function cancelDownload(id) {
  active.get(id)?.abort();
}

// Copy a .gguf the user picked (e.g. from a USB stick) into the library.
export async function importModel(srcPath) {
  if (!srcPath.toLowerCase().endsWith('.gguf')) throw new Error('Pick a .gguf model file');
  fs.mkdirSync(paths.models, { recursive: true });
  const dest = path.join(paths.models, path.basename(srcPath));
  if (path.resolve(dest) !== path.resolve(srcPath)) await fs.promises.copyFile(srcPath, dest);
  return dest;
}

// Uninstall: delete a model from Scorpion's library (plus any partial copy).
// Models bundled with the installer are read-only and come back on reinstall.
export function uninstallModel(file) {
  const rel = path.relative(paths.models, path.resolve(file));
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Only models in the Scorpion library can be uninstalled');
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}.ipull`, { force: true });
}
export const deleteModel = uninstallModel;

// Best default chat model for this computer. Models that fit in graphics
// memory come first (known recommended ones, then the largest that fits, as
// bigger is usually smarter); then the smallest of the rest, so a weak PC
// still starts with something usable. `fit(bytes)` comes from engine.modelFit.
const FIT_ORDER = { fast: 0, ok: 1, slow: 2, 'too-big': 3 };
export function pickDefaultChatModel(list, fit) {
  const chat = list.filter((m) => m.kind === 'chat').map((m) => ({ m, f: FIT_ORDER[fit(m.bytes)] ?? 2, rank: catalogRank(m) }));
  chat.sort((a, b) => a.f - b.f
    || (a.f <= 1 ? a.rank - b.rank || b.m.bytes - a.m.bytes : a.m.bytes - b.m.bytes));
  return chat[0]?.m ?? null;
}
