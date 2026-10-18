// Model files: a curated catalog, local discovery, one-time download, and import.
// After a model file is on disk Kenzo never touches the network again.
import fs from 'node:fs';
import path from 'node:path';
import { createModelDownloader } from 'node-llama-cpp';
import { paths } from './store.js';

export const CATALOG = [
  {
    id: 'qwen3-4b',
    kind: 'chat',
    name: 'Qwen3 4B Instruct',
    uri: 'hf:unsloth/Qwen3-4B-Instruct-2507-GGUF/Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
    size: '2.5 GB',
    note: 'Recommended. Strong tool use for agent work. 8 GB RAM.',
  },
  {
    id: 'qwen2.5-7b',
    kind: 'chat',
    name: 'Qwen2.5 7B Instruct',
    uri: 'hf:bartowski/Qwen2.5-7B-Instruct-GGUF/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    size: '4.7 GB',
    note: 'Smarter, slower. 16 GB RAM or a GPU.',
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
    id: 'qwen2.5-1.5b',
    kind: 'chat',
    name: 'Qwen2.5 1.5B Instruct',
    uri: 'hf:bartowski/Qwen2.5-1.5B-Instruct-GGUF/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
    size: '1.0 GB',
    note: 'For older or low-memory computers.',
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
function bundledDirs(resourcesPath, appRoot) {
  return [path.join(resourcesPath || '', 'models'), path.join(appRoot, 'resources', 'models')];
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
    return await downloader.download({ signal: controller.signal });
  } finally {
    active.delete(id);
  }
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

export function deleteModel(file) {
  const rel = path.relative(paths.models, path.resolve(file));
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Only library models can be deleted');
  fs.rmSync(file, { force: true });
}
