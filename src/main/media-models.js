// The media library's models, on ONNX Runtime like everything else:
//   CLIP ViT-B/32 (OpenAI, MIT): pictures and phrases as 512-number vectors,
//     used for objects, scenes, landmarks, video actions and search by words;
//   AST (MIT CSAIL, BSD-3) fine-tuned on AudioSet: 527 sound labels,
//     used for music genres and other sounds.
// One-time download into Scorpion's model library; remote loading stays off
// afterwards. Counted as installed only once a model has loaded (marker file).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MEDIA_MODELS = {
  clip: { id: 'Xenova/clip-vit-base-patch32', bytes: 160 * 1024 ** 2, label: 'Pictures and video (CLIP)' },
  audio: { id: 'Xenova/ast-finetuned-audioset-10-10-0.4593', bytes: 92 * 1024 ** 2, label: 'Music and sounds (AST)' },
};

let dir = null;
let tf = null;
const loaded = {};
const installing = {};
const textCache = new Map();
// Leave half the processor for everything else while the library scans;
// low-CPU mode uses a single thread.
let threads = Math.max(2, Math.floor(os.cpus().length / 2));
export function setLowCpu(on) {
  const want = on ? 1 : Math.max(2, Math.floor(os.cpus().length / 2));
  if (want === threads) return;
  threads = want;
  for (const k of Object.keys(loaded)) delete loaded[k]; // reloaded with the new thread count
}

export function initMediaModels(modelsDir) {
  dir = path.join(modelsDir, 'media');
}

const marker = (key) => path.join(dir, `${key}.installed.json`);
export function mediaModelStatus() {
  return Object.fromEntries(Object.entries(MEDIA_MODELS).map(([k, m]) => [k, { installed: Boolean(dir) && fs.existsSync(marker(k)), installing: Boolean(installing[k]), bytes: m.bytes, label: m.label }]));
}

async function lib(allowDownload) {
  tf ??= await import('@huggingface/transformers');
  tf.env.cacheDir = dir;
  tf.env.localModelPath = dir;
  tf.env.allowRemoteModels = allowDownload;
  return tf;
}

async function load(key, progress_callback, download = false) {
  const t = await lib(download);
  const opts = { dtype: 'q8', device: 'cpu', progress_callback, session_options: { intraOpNumThreads: threads } };
  if (key === 'clip') {
    const id = MEDIA_MODELS.clip.id;
    const [processor, vision, tokenizer, text] = await Promise.all([
      t.AutoProcessor.from_pretrained(id, { progress_callback }),
      t.CLIPVisionModelWithProjection.from_pretrained(id, opts),
      t.AutoTokenizer.from_pretrained(id, { progress_callback }),
      t.CLIPTextModelWithProjection.from_pretrained(id, opts),
    ]);
    return { processor, vision, tokenizer, text };
  }
  return t.pipeline('audio-classification', MEDIA_MODELS.audio.id, opts);
}

// Downloads the given models (keys of MEDIA_MODELS). onProgress: { loaded, total, done }.
export async function installMediaModels(keys, onProgress) {
  fs.mkdirSync(dir, { recursive: true });
  const want = keys.filter((k) => MEDIA_MODELS[k] && !mediaModelStatus()[k].installed);
  const total = want.reduce((n, k) => n + MEDIA_MODELS[k].bytes, 0);
  const files = new Map();
  const report = (p) => {
    if (p.status !== 'progress') return;
    files.set(p.file + p.name, p.loaded ?? 0);
    let got = 0;
    for (const v of files.values()) got += v;
    onProgress?.({ loaded: Math.min(got, total), total, done: false });
  };
  try {
    for (const k of want) {
      installing[k] = true;
      try {
        loaded[k] = await load(k, report, true);
        fs.writeFileSync(marker(k), JSON.stringify({ model: MEDIA_MODELS[k].id, at: new Date().toISOString() }));
      } finally {
        installing[k] = false;
      }
    }
  } finally {
    if (tf) tf.env.allowRemoteModels = false;
  }
  onProgress?.({ done: true });
  return mediaModelStatus();
}

export async function uninstallMediaModels() {
  for (const k of Object.keys(loaded)) delete loaded[k];
  textCache.clear();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

async function get(key) {
  if (!mediaModelStatus()[key].installed) throw new Error(`${MEDIA_MODELS[key].label} is not installed. Open Library → Settings and click Install.`);
  loaded[key] ??= await load(key);
  return loaded[key];
}

const unit = (data) => {
  let n = 0;
  for (const x of data) n += x * x;
  n = Math.sqrt(n) || 1;
  return Array.from(data, (x) => x / n);
};

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// img: { data, width, height, channels } (RGB or RGBA bytes) → unit vector.
export async function embedImage(img) {
  const clip = await get('clip');
  const raw = new tf.RawImage(img.data instanceof Uint8ClampedArray ? img.data : new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength), img.width, img.height, img.channels);
  const { image_embeds } = await clip.vision(await clip.processor(img.channels === 4 ? raw.rgb() : raw));
  return unit(image_embeds.data);
}

// Phrases → unit vectors, cached (label lists are embedded once).
export async function embedTexts(texts) {
  const clip = await get('clip');
  const missing = [...new Set(texts.filter((t) => !textCache.has(t)))];
  for (let i = 0; i < missing.length; i += 64) {
    const batch = missing.slice(i, i + 64);
    const { text_embeds } = await clip.text(clip.tokenizer(batch, { padding: true, truncation: true }));
    const size = text_embeds.dims.at(-1);
    batch.forEach((t, j) => textCache.set(t, unit(text_embeds.data.slice(j * size, (j + 1) * size))));
  }
  return texts.map((t) => textCache.get(t));
}

// Softmax over CLIP similarities (CLIP's own temperature of 100).
export function zeroShot(vector, labelVectors) {
  const logits = labelVectors.map((v) => 100 * dot(vector, v));
  const max = Math.max(...logits);
  const ex = logits.map((l) => Math.exp(l - max));
  const sum = ex.reduce((a, b) => a + b, 0);
  return ex.map((e, i) => ({ p: e / sum, cos: logits[i] / 100 }));
}

// 16 kHz mono samples → every AudioSet label with its own probability.
// AudioSet is multi-label (a song is "Music" and "Jazz" and "Piano"), so each
// label gets a sigmoid; the pipeline's softmax would squeeze genres to ~2%.
export async function classifyAudio(pcm) {
  const clf = await get('audio');
  const inputs = await clf.processor(pcm instanceof Float32Array ? pcm : new Float32Array(pcm));
  const { logits } = await clf.model(inputs);
  const labels = clf.model.config.id2label;
  return Array.from(logits.data, (z, i) => ({ label: labels[i], score: 1 / (1 + Math.exp(-z)) }));
}
