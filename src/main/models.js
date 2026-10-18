// Model files: a curated catalog, local discovery, one-time download, and import.
// After a model file is on disk Kenzo never touches the network again.
import fs from 'node:fs';
import os from 'node:os';
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

// ---------- models already installed by Ollama ----------
// Ollama stores each model as content-addressed blobs plus a manifest per
// "name:tag". The manifest's `model` layer is a plain GGUF file, so Kenzo can
// load it in place (read-only, never copied or deleted).
function ollamaRoot() {
  const candidates = [process.env.OLLAMA_MODELS, path.join(os.homedir(), '.ollama', 'models')];
  return candidates.find((d) => d && fs.existsSync(path.join(d, 'manifests'))) || null;
}

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

export function scanOllama(root = ollamaRoot()) {
  if (!root) return [];
  const blob = (digest) => path.join(root, 'blobs', String(digest).replace(':', '-'));
  const out = [];
  const seen = new Set();
  // manifests/<host>/<namespace>/<model>/<tag>
  const base = path.join(root, 'manifests');
  for (const host of safeDir(base)) {
    for (const ns of safeDir(path.join(base, host))) {
      for (const model of safeDir(path.join(base, host, ns))) {
        for (const tag of safeDir(path.join(base, host, ns, model))) {
          let manifest = readJsonFile(path.join(base, host, ns, model, tag));
          // Newer manifest lists point at a per-runner manifest; take the GGUF one.
          if (manifest?.manifests) {
            const gguf = manifest.manifests.find((m) => m.format === 'gguf');
            manifest = gguf ? readJsonFile(blob(gguf.digest)) : null;
          }
          if (manifest?.format && manifest.format !== 'gguf') continue;
          const layer = manifest?.layers?.find((l) => l.mediaType === 'application/vnd.ollama.image.model');
          const file = layer && blob(layer.digest);
          if (!file || seen.has(file) || !fs.existsSync(file)) continue;
          seen.add(file);
          const name = `${ns === 'library' ? '' : `${ns}/`}${model}:${tag}`;
          out.push({ path: file, name, bytes: layer.size ?? fs.statSync(file).size, kind: isEmbeddingFile(name) ? 'embedding' : 'chat', source: 'ollama' });
        }
      }
    }
  }
  return out;
}

function safeDir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() || e.isFile()).map((e) => e.name); } catch { return []; }
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
    ...scanOllama(),
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
