// Speech, fully offline: Whisper turns the microphone into text and Kokoro
// reads English replies aloud; Meta's MMS voices speak other languages. All
// run on ONNX Runtime in-process. The base install is a one-time ~230 MB
// download into Scorpion's own model library, plus ~38 MB per extra language
// voice; after that no network is ever used (remote loading stays off).
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

// The languages Scorpion listens to (Whisper code), replies in, and speaks:
// 'kokoro' (English), an MMS voice code (one ~38 MB download each), or
// 'system' (the computer's own voice for that language, if it has one).
// Haitian Creole has no ready-made MMS voice yet, so the French one stands in.
export const LANGUAGES = [
  { id: 'en', name: 'English', native: 'English', speech: 'kokoro' },
  { id: 'fr', name: 'French', native: 'Français', speech: 'fra' },
  { id: 'ht', name: 'Haitian Creole', native: 'Kreyòl ayisyen', speech: 'fra', approximate: true },
  { id: 'es', name: 'Spanish', native: 'Español', speech: 'spa' },
  { id: 'pt', name: 'Portuguese', native: 'Português', speech: 'por' },
  { id: 'de', name: 'German', native: 'Deutsch', speech: 'deu' },
  { id: 'it', name: 'Italian', native: 'Italiano', speech: 'system' },
  { id: 'ru', name: 'Russian', native: 'Русский', speech: 'rus' },
  { id: 'ar', name: 'Arabic', native: 'العربية', speech: 'ara' },
  { id: 'hi', name: 'Hindi', native: 'हिन्दी', speech: 'hin' },
  { id: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', speech: 'vie' },
  { id: 'ko', name: 'Korean', native: '한국어', speech: 'kor' },
  { id: 'ro', name: 'Romanian', native: 'Română', speech: 'ron' },
  { id: 'yo', name: 'Yoruba', native: 'Yorùbá', speech: 'yor' },
  { id: 'zh', name: 'Chinese', native: '中文', speech: 'system' },
  { id: 'ja', name: 'Japanese', native: '日本語', speech: 'system' },
  { id: 'nl', name: 'Dutch', native: 'Nederlands', speech: 'system' },
  { id: 'pl', name: 'Polish', native: 'Polski', speech: 'system' },
  { id: 'tr', name: 'Turkish', native: 'Türkçe', speech: 'system' },
  { id: 'uk', name: 'Ukrainian', native: 'Українська', speech: 'system' },
  { id: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', speech: 'system' },
  { id: 'sw', name: 'Swahili', native: 'Kiswahili', speech: 'system' },
];
export const MMS_VOICE_BYTES = 38 * 1024 ** 2;
const mmsId = (code) => `Xenova/mms-tts-${code}`;

// Settings from before languages had codes stored Whisper's English names.
export function languageOf(value) {
  const v = String(value || 'en').toLowerCase();
  return LANGUAGES.find((l) => l.id === v || l.name.toLowerCase() === v) || LANGUAGES[0];
}

let dir = null;
let transformers = null;
let asr = null;
let tts = null;
let installing = null;
const mms = new Map(); // MMS voice code -> loaded pipeline
const mmsInstalling = new Map();

// Scorpion OS ships the voice ready in a read-only system folder. The user's
// own folder wins once a voice is installed there, and every download goes
// there (a language voice first copies the system one over).
let userDir = null;
const SYSTEM_VOICE = process.platform === 'linux' ? '/usr/share/scorpion/voice' : null;
const complete = (d) => Boolean(d) && fs.existsSync(path.join(d, 'installed.json'));
export function initVoice(modelsDir) {
  userDir = path.join(modelsDir, 'voice');
  dir = !complete(userDir) && complete(SYSTEM_VOICE) ? SYSTEM_VOICE : userDir;
}
// Before writing: the user's folder, with the system voice copied in.
function writableDir({ copySystem = false } = {}) {
  if (dir === userDir) return;
  if (copySystem) fs.cpSync(dir, userDir, { recursive: true });
  dir = userDir;
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

const mmsMarker = (code) => path.join(dir, `voice-${code}.json`);
const mmsReady = (code) => Boolean(dir) && fs.existsSync(mmsMarker(code));

export function voiceStatus() {
  const installed = Boolean(dir) && fs.existsSync(marker()) && has(WHISPER.id) && has(KOKORO.id);
  return {
    installed,
    installing: Boolean(installing),
    voices: VOICES,
    languages: LANGUAGES.map((l) => ({ ...l, voiceReady: l.speech === 'kokoro' ? installed : l.speech === 'system' ? true : mmsReady(l.speech) })),
    bytes: VOICE_DOWNLOAD_BYTES,
    languageVoiceBytes: MMS_VOICE_BYTES,
  };
}

async function loadMms(code, progress_callback, download = false) {
  const { pipeline } = await lib(download);
  return pipeline('text-to-speech', mmsId(code), { dtype: 'q8', device: 'cpu', progress_callback });
}

// Downloads one language's MMS voice (~38 MB). Same rule as installVoice:
// the marker is written only once the voice has loaded.
export function installLanguageVoice(languageId, onProgress) {
  const code = languageOf(languageId).speech;
  if (code === 'kokoro' || code === 'system' || mmsReady(code)) return Promise.resolve();
  if (!mmsInstalling.has(code)) {
    mmsInstalling.set(code, (async () => {
      writableDir({ copySystem: true });
      const report = (p) => { if (p.status === 'progress') onProgress?.({ loaded: p.loaded ?? 0, total: Math.max(p.total ?? 0, MMS_VOICE_BYTES), done: false }); };
      try {
        fs.rmSync(path.join(dir, mmsId(code)), { recursive: true, force: true });
        mms.set(code, await loadMms(code, report, true));
        fs.writeFileSync(mmsMarker(code), JSON.stringify({ model: mmsId(code), at: new Date().toISOString() }));
        onProgress?.({ done: true });
      } catch (err) {
        fs.rmSync(path.join(dir, mmsId(code)), { recursive: true, force: true });
        throw err;
      } finally {
        transformers.env.allowRemoteModels = false;
        mmsInstalling.delete(code);
      }
    })());
  }
  return mmsInstalling.get(code);
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
      writableDir();
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
  // The system's own voice (Scorpion OS) stays; only the user's is removed.
  if (dir && dir === userDir) fs.rmSync(dir, { recursive: true, force: true });
}

export async function unloadVoice() {
  await asr?.dispose?.().catch(() => {});
  asr = null;
  tts = null;
  for (const p of mms.values()) await p?.dispose?.().catch(() => {});
  mms.clear();
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
export function warmUp(language = 'en') {
  if (!voiceStatus().installed || installing) return Promise.resolve();
  const code = languageOf(language).speech;
  warming ??= (async () => {
    if (code === 'kokoro') tts ??= await loadTts();
    else if (mmsReady(code) && !mms.has(code)) mms.set(code, await loadMms(code));
    asr ??= await loadAsr();
  })().catch(() => {}).finally(() => { warming = null; });
  return warming;
}

function needInstalled() {
  if (!voiceStatus().installed) throw new Error('Voice is not installed. Open Settings → Voice and click Install.');
}

// pcm: 16 kHz mono Float32Array from the microphone.
export async function transcribe(pcm, language = 'en') {
  needInstalled();
  asr ??= await loadAsr();
  const audio = pcm instanceof Float32Array ? pcm : new Float32Array(pcm);
  if (audio.length < 16000 * 0.3 || loudness(audio) < 0.004) return ''; // silence: Whisper would invent words
  const out = await asr(audio, { language: languageOf(language).id, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
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

// Returns { sampleRate, audio: Float32Array } for one piece of text, or
// { system, text, lang } when the computer's own voice should say it.
export async function speak(text, { voice = 'af_heart', speed = 1, language = 'en' } = {}) {
  needInstalled();
  const lang = languageOf(language);
  const spoken = speakable(text, lang.id);
  if (!spoken) return { sampleRate: 24000, audio: new Float32Array(0) };
  if (lang.speech !== 'kokoro') {
    if (lang.speech === 'system' || !mmsReady(lang.speech)) return { system: true, text: spoken, lang: lang.id };
    if (!mms.has(lang.speech)) mms.set(lang.speech, await loadMms(lang.speech));
    const out = await mms.get(lang.speech)(spoken);
    return { sampleRate: out.sampling_rate, audio: out.audio };
  }
  tts ??= await loadTts();
  const known = VOICES.some((v) => v.id === voice) ? voice : 'af_heart';
  const out = await tts.generate(spoken, { voice: known, speed: Math.min(Math.max(Number(speed) || 1, 0.5), 2) });
  return { sampleRate: out.sampling_rate, audio: out.audio };
}

// Markdown and code read badly aloud: keep the words, drop the syntax.
export function speakable(text, language = 'en') {
  return String(text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/g, ' ')
    .replace(/```[\s\S]*?(```|$)/g, language === 'en' ? ' (code shown on screen) ' : ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, language === 'en' ? ' a link ' : ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~|#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
