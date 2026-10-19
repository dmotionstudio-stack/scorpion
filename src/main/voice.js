// Speech, fully offline: Whisper turns the microphone into text and Kokoro
// reads replies aloud. Both run on ONNX Runtime in-process. The models are a
// one-time ~230 MB download into Scorpion's own model library; after that no
// network is ever used (remote loading stays switched off).
import fs from 'node:fs';
import path from 'node:path';

const WHISPER = { id: 'onnx-community/whisper-base', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' } };
const KOKORO = { id: 'onnx-community/Kokoro-82M-v1.0-ONNX', dtype: 'q8' };
// Files that must be present for each model to load offline.
const REQUIRED = {
  [WHISPER.id]: ['config.json', 'onnx/encoder_model.onnx', 'onnx/decoder_model_merged_quantized.onnx', 'tokenizer.json'],
  [KOKORO.id]: ['config.json', 'onnx/model_quantized.onnx', 'tokenizer.json'],
};
export const VOICE_DOWNLOAD_BYTES = 230 * 1024 ** 2;

// Kokoro's English voices, best first. The id prefix says the accent and
// gender (a = American, b = British; f = female, m = male).
export const VOICES = [
  { id: 'af_heart', name: 'Heart (US, female)' },
  { id: 'af_bella', name: 'Bella (US, female)' },
  { id: 'am_michael', name: 'Michael (US, male)' },
  { id: 'am_fenrir', name: 'Fenrir (US, male)' },
  { id: 'bf_emma', name: 'Emma (UK, female)' },
  { id: 'bm_george', name: 'George (UK, male)' },
  { id: 'bm_fable', name: 'Fable (UK, male)' },
];

// Whisper's language names for the "I speak" setting.
export const LANGUAGES = ['english', 'spanish', 'french', 'german', 'italian', 'portuguese', 'dutch', 'russian', 'chinese',
  'japanese', 'korean', 'arabic', 'hindi', 'turkish', 'polish', 'ukrainian', 'vietnamese', 'indonesian', 'thai', 'swedish'];

let dir = null;
let transformers = null;
let asr = null;
let tts = null;
let installing = null;

export function initVoice(modelsDir) {
  dir = path.join(modelsDir, 'voice');
}

async function lib(allowDownload = false) {
  transformers ??= await import('@huggingface/transformers');
  const { env } = transformers;
  env.cacheDir = dir;
  env.localModelPath = dir;
  env.allowRemoteModels = allowDownload;
  return transformers;
}

const has = (id) => REQUIRED[id].every((f) => fs.existsSync(path.join(dir, id, f)));
// Written only after both models downloaded and loaded, so a download cut off
// halfway (files written as they stream in) never counts as installed.
const marker = () => path.join(dir, 'installed.json');

export function voiceStatus() {
  const installed = Boolean(dir) && fs.existsSync(marker()) && has(WHISPER.id) && has(KOKORO.id);
  return { installed, installing: Boolean(installing), voices: VOICES, languages: LANGUAGES, bytes: VOICE_DOWNLOAD_BYTES };
}

// One-time download of both models. onProgress gets { file, loaded, total, done }.
export function installVoice(onProgress) {
  installing ??= (async () => {
    const totals = new Map();
    const report = (p) => {
      if (p.status !== 'progress' && p.status !== 'done') return;
      totals.set(p.file, { loaded: p.loaded ?? p.total ?? 0, total: p.total ?? 0 });
      let loaded = 0, total = 0;
      for (const t of totals.values()) { loaded += t.loaded; total += t.total; }
      onProgress?.({ loaded, total: Math.max(total, VOICE_DOWNLOAD_BYTES), done: false });
    };
    try {
      // Start clean: leftovers of an interrupted download would be reused.
      await unloadVoice();
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      await lib(true);
      asr = await loadAsr(report, true);
      tts = await loadTts(report, true);
      fs.writeFileSync(marker(), JSON.stringify({ whisper: WHISPER.id, kokoro: KOKORO.id, at: new Date().toISOString() }));
      onProgress?.({ done: true });
    } catch (err) {
      await unloadVoice();
      fs.rmSync(dir, { recursive: true, force: true });
      throw err;
    } finally {
      transformers.env.allowRemoteModels = false;
      installing = null;
    }
  })();
  return installing;
}

export async function uninstallVoice() {
  await unloadVoice();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

export async function unloadVoice() {
  await asr?.dispose?.().catch(() => {});
  asr = null;
  tts = null;
}

async function loadAsr(progress_callback, download = false) {
  const { pipeline } = await lib(download);
  return pipeline('automatic-speech-recognition', WHISPER.id, { dtype: WHISPER.dtype, device: 'cpu', progress_callback });
}

async function loadTts(progress_callback, download = false) {
  await lib(download);
  const { KokoroTTS } = await import('kokoro-js');
  return KokoroTTS.from_pretrained(KOKORO.id, { dtype: KOKORO.dtype, device: 'cpu', progress_callback });
}

// Load both models ahead of time (they take a few seconds), so the first
// spoken sentence or transcription doesn't wait for them.
let warming = null;
export function warmUp() {
  if (!voiceStatus().installed || installing) return Promise.resolve();
  warming ??= (async () => {
    tts ??= await loadTts();
    asr ??= await loadAsr();
  })().catch(() => {}).finally(() => { warming = null; });
  return warming;
}

function needInstalled() {
  if (!voiceStatus().installed) throw new Error('Voice is not installed. Open Settings → Voice and click Install.');
}

// pcm: 16 kHz mono Float32Array from the microphone.
export async function transcribe(pcm, language = 'english') {
  needInstalled();
  asr ??= await loadAsr();
  const audio = pcm instanceof Float32Array ? pcm : new Float32Array(pcm);
  if (audio.length < 16000 * 0.3 || loudness(audio) < 0.004) return ''; // silence: Whisper would invent words
  const out = await asr(audio, { language, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
  return cleanTranscript(out.text);
}

export function loudness(audio) {
  let sum = 0;
  for (const v of audio) sum += v * v;
  return audio.length ? Math.sqrt(sum / audio.length) : 0;
}

// Whisper writes these for silence or noise instead of nothing.
const NOISE = /^[\s.]*$|^\s*[[(](blank_audio|music|silence|noise|inaudible|applause)[\])]\s*$/i;
export function cleanTranscript(text) {
  const t = String(text ?? '').trim();
  return NOISE.test(t) ? '' : t;
}

// Returns { sampleRate, audio: Float32Array } for one piece of text.
export async function speak(text, { voice = 'af_heart', speed = 1 } = {}) {
  needInstalled();
  tts ??= await loadTts();
  const spoken = speakable(text);
  if (!spoken) return { sampleRate: 24000, audio: new Float32Array(0) };
  const known = VOICES.some((v) => v.id === voice) ? voice : 'af_heart';
  const out = await tts.generate(spoken, { voice: known, speed: Math.min(Math.max(Number(speed) || 1, 0.5), 2) });
  return { sampleRate: out.sampling_rate, audio: out.audio };
}

// Markdown and code read badly aloud: keep the words, drop the syntax.
export function speakable(text) {
  return String(text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/g, ' ')
    .replace(/```[\s\S]*?(```|$)/g, ' (code shown on screen) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' a link ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~|#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
