// Model files: a curated catalog, Scorpion's own library, one-time download,
// import, uninstall and reinstall. Scorpion only uses models it manages itself
// (no sharing with other apps), so every model can be removed and re-added at
// any time. After a model file is on disk Scorpion never touches the network again.
import fs from 'node:fs';
import path from 'node:path';
import { createModelDownloader } from 'node-llama-cpp';
import { paths } from './store.js';
import { downloadFile } from './fetcher.js';

// `skill` is what scripts/model-check.mjs measured with Scorpion's real agent:
//   agent  - passed both the calculator and the Build-mode file test
//   tools  - calls simple tools correctly, but failed the Build-mode file test
//   chat   - failed the tool tests; use it for conversation only
// Entries without `skill` haven't been through that check.
// tier: how capable it is, 1 to 3. thinks: it thinks before it answers (the
// Thinking switch in the chat turns that down or off). activeGB: what it reads
// for each word when that is much less than its file (mixture of experts);
// speed.js uses these to work out how fast it answers on a computer.
export const CATALOG = [
  {
    id: 'qwen3.5-4b',
    kind: 'chat',
    name: 'Qwen3.5 4B',
    uri: 'hf:unsloth/Qwen3.5-4B-GGUF/Qwen3.5-4B-Q4_K_M.gguf',
    size: '2.7 GB',
    skill: 'agent',
    tier: 2,
    thinks: true,
    note: 'Recommended. Passed every agent test and writes the best Haitian Creole of the Qwen models; thinks briefly first (the Thinking switch in the chat turns that down or off). Apache-2.0.',
  },
  {
    id: 'qwen3-1.7b',
    kind: 'chat',
    name: 'Qwen3 1.7B',
    uri: 'hf:unsloth/Qwen3-1.7B-GGUF/Qwen3-1.7B-Q4_K_M.gguf',
    size: '1.1 GB',
    skill: 'chat',
    tier: 1,
    thinks: true,
    note: 'Only for computers where the 4B models are too slow: about twice as fast, fine for conversation, but it did poorly in the agent tests, so it is unreliable with tools and long jobs. Scorpion picks it by itself only when nothing better runs comfortably. Apache-2.0.',
  },
  {
    id: 'lfm3-1.7b',
    kind: 'chat',
    name: 'LFM3 1.7B',
    uri: 'hf:LiquidAI/LFM3-1.7B-GGUF/LFM3-1.7B-Q4_K_M.gguf',
    size: '1.1 GB',
    skill: 'tools',
    tier: 1,
    thinks: true,
    note: 'A small multilingual model from Liquid AI (English, French, Spanish, German, Italian, Portuguese, Arabic, Chinese, Japanese, Korean, Hindi, Russian, Vietnamese, Thai, Indonesian and Polish; not Haitian Creole). Quick: about 0.2 s to the first words with Thinking off. Calls simple tools but failed the Build-mode file test, and it thinks at length, so use Quick or Off for talking. LFM Open License v1.0 (not Apache or MIT): read it before commercial use.',
  },
  // More models, downloaded from the Ollama registry (a direct link to the model file; the
  // checksum is checked). They have not been through the agent check, so Scorpion never picks
  // one by itself: you choose them. Too big for a release file, so they are never bundled.
  {
    id: 'gemma4-e4b', kind: 'chat', name: 'Gemma 4 E4B', file: 'gemma4-e4b.gguf', size: '5.1 GB', bytes: 5493439296,
    url: 'https://registry.ollama.ai/v2/library/gemma4/blobs/sha256:370c2879f17648d337b0ab4e208fdce348e24d1060064e93d7645daafd56d39c',
    sha256: '370c2879f17648d337b0ab4e208fdce348e24d1060064e93d7645daafd56d39c',
    note: 'Google Gemma 4, the 4-billion "effective" size. Chats and calls tools well in Scorpion.',
  },
  {
    id: 'deepseek-v4.1-flash-9b', kind: 'chat', name: 'DeepSeek V4.1 Flash 9B', file: 'deepseek-v4.1-flash-1017-9b.gguf', size: '5.2 GB', bytes: 5627045536,
    url: 'https://registry.ollama.ai/v2/eriktonon/deepseek-v4.1-flash-1017/blobs/sha256:3fe913419f9942a4432c025df608699032912efc9a9550b9b45d6bc88c8124b1',
    sha256: '3fe913419f9942a4432c025df608699032912efc9a9550b9b45d6bc88c8124b1',
    note: 'A 9B DeepSeek model for reasoning (community build on the Ollama registry).',
  },
  {
    id: 'mimo-v2.6', kind: 'chat', name: 'MiMo V2.6', file: 'mimo-v2.6.gguf', size: '5.2 GB', bytes: 5629105568,
    url: 'https://registry.ollama.ai/v2/library/mimo-v2.6/blobs/sha256:8f367423ee68d5712710ceda6a21a840ee6b4ff507065aebad155ce92789ccbc',
    sha256: '8f367423ee68d5712710ceda6a21a840ee6b4ff507065aebad155ce92789ccbc',
    note: 'Xiaomi MiMo V2.6, a reasoning model.',
  },
  {
    id: 'qwen3.5-9b-defiant-fable',
    kind: 'chat',
    name: 'Qwen3.5 9B Defiant Fable',
    uri: 'hf:DavidAU/Qwen3.5-9B-The-Defiant-Fable-Uncensored-Heretic-NEO-IMATRIX-MAX-MTP-GGUF/Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-MTP-IQ4_NL.gguf',
    size: '6.3 GB',
    tier: 3,
    thinks: true,
    note: 'A community fine-tune of Qwen3.5 9B (DavidAU, IQ4_NL, uncensored). Bigger and slower than Qwen3.5 4B: it needs a computer with about 8 GB of memory to spare. It has not been through the agent check, so Scorpion never picks it by itself. Too big to come with the installer or the USB system: download it here.',
  },
  {
    id: 'qwopus3.5-9b-v3',
    kind: 'chat',
    name: 'Qwopus3.5 9B v3 (abliterated)',
    uri: 'hf:mradermacher/Huihui-Qwopus3.5-9B-v3-abliterated-i1-GGUF/Huihui-Qwopus3.5-9B-v3-abliterated.i1-Q6_K.gguf',
    size: '6.9 GB',
    tier: 3,
    thinks: true,
    note: 'An abliterated Qwen3.5 9B by Huihui (Qwopus v3), quantized to Q6_K with an importance matrix by mradermacher. Apache-2.0. Bigger and slower than Qwen3.5 4B: it needs about 8 GB of memory to spare. It has not been through the agent check, so Scorpion never picks it by itself. Too big to come with the installer or the USB system: download it here.',
  },
  {
    id: 'embeddinggemma-2', kind: 'embedding', name: 'EmbeddingGemma 2 (740M)', file: 'embeddinggemma-2-740m.gguf', size: '290 MB', bytes: 303957280,
    url: 'https://registry.ollama.ai/v2/library/embeddinggemma-2/blobs/sha256:111e84992a0406bacb70d11dddd8874001c783cc56b82c462ec82a2f5b8d08b1',
    sha256: '111e84992a0406bacb70d11dddd8874001c783cc56b82c462ec82a2f5b8d08b1',
    note: 'For Chat with documents: turns your files into something Scorpion can search.',
  },
];

// The name a catalog model's file has in the library (without .gguf, lower case).
const stemOf = (c) => (c.file || c.uri.split('/').pop()).replace(/\.gguf$/i, '').toLowerCase();

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

// One model file as the Models page lists it. name: when the file's own name says
// nothing (Ollama keeps its models as hash-named blobs).
function modelEntry(file, source, name = null) {
  return {
    path: file,
    name: name || path.basename(file).replace(/\.gguf$/i, '').replace(/^hf_[^_]+_/, ''),
    bytes: fs.statSync(file).size,
    kind: isEmbeddingFile(file) || /embed/i.test(name || '') ? 'embedding' : 'chat',
    source,
  };
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
    out.push(modelEntry(file, source));
  }
  return out;
}

// The catalog entry a model file is (by its file name), or null.
export function catalogEntry(model) {
  return CATALOG.find((c) => c.kind === 'chat' && String(model.name || '').toLowerCase() === stemOf(c)) || null;
}
// What speed.js needs to know about a model file: its tier, whether it thinks, what it reads for each word.
export function speedInfo(model) {
  const c = catalogEntry(model);
  return { tier: c?.tier, thinks: Boolean(c?.thinks), activeBytes: c?.activeGB ? Math.round(c.activeGB * 1024 ** 3) : 0 };
}

// Position in the catalog (recommended first); unknown files sort last.
export function catalogRank(model) {
  const i = CATALOG.findIndex((c) => model.name.toLowerCase() === stemOf(c));
  return i === -1 ? CATALOG.length : i;
}

// linked: models found on this computer and used where they are ({ path, name? });
// one that has since gone is simply not listed.
export function listLocalModels({ resourcesPath, appRoot, linked = [] }) {
  fs.mkdirSync(paths.models, { recursive: true });
  const seen = new Set();
  return [
    ...bundledDirs(resourcesPath, appRoot).flatMap((d) => scan(d, 'bundled')),
    ...scan(paths.models, 'library'),
    ...linked.filter((l) => l?.path && fs.existsSync(l.path)).map((l) => modelEntry(l.path, 'linked', l.name || null)),
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
    if (item.url) return await downloadDirect(item, controller.signal, onProgress);
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

// A catalog model with a direct link: written under a temporary name, its size and SHA-256 checked, then moved into place.
async function downloadDirect(item, signal, onProgress) {
  fs.mkdirSync(paths.models, { recursive: true });
  const final = path.join(paths.models, item.file);
  if (fs.existsSync(final)) return final;
  const r = await downloadFile(item.url, paths.models, { signal, name: `${item.file}.download`, onProgress: ({ done, total }) => onProgress?.({ id: item.id, totalSize: total || item.bytes, downloadedSize: done }) });
  if (r.bytes !== item.bytes || r.sha256 !== item.sha256) {
    fs.rmSync(r.path, { force: true });
    throw new Error(`${item.name} did not download correctly (the file does not match); try again.`);
  }
  fs.renameSync(r.path, final);
  return final;
}

// Download a model from a Hugging Face address (hf:user/repo/file.gguf), into the library.
export async function downloadUri(uri, onProgress) {
  if (!/^hf:[^/\s]+\/[^/\s]+\/\S+\.gguf$/i.test(String(uri))) throw new Error('That is not a model address (hf:user/repo/file.gguf).');
  const downloader = await createModelDownloader({
    modelUri: uri, dirPath: paths.models, showCliProgress: false, skipExisting: true,
    onProgress: ({ totalSize, downloadedSize }) => onProgress?.({ totalSize, downloadedSize }),
  });
  try { return await downloader.download(); } catch (err) { removePartial(downloader.entrypointFilePath); throw err; }
}

function removePartial(file) {
  if (file) fs.rmSync(`${file}.ipull`, { force: true });
}

// The library file for a catalog entry, if it's installed.
export function catalogFileName(item) {
  return stemOf(item);
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
// Copies a model file into Scorpion's library. name: a model whose file has no
// .gguf name (Ollama's blobs) is copied under that name.
export async function importModel(srcPath, name = null) {
  if (!name && !srcPath.toLowerCase().endsWith('.gguf')) throw new Error('Pick a .gguf model file');
  fs.mkdirSync(paths.models, { recursive: true });
  const fileName = name ? `${String(name).replace(/\s*\(Ollama\)$/i, '').replace(/[^\w.+-]+/g, '-').replace(/^-+|-+$/g, '') || 'model'}.gguf` : path.basename(srcPath);
  const dest = path.join(paths.models, fileName);
  if (path.resolve(dest) === path.resolve(srcPath)) return dest;
  // Already copied (same size): nothing to do.
  if (fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(srcPath).size) return dest;
  await fs.promises.copyFile(srcPath, dest);
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
