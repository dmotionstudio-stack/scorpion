// Speech, fully offline: Whisper turns the microphone into text and Kokoro
// reads English replies aloud; Meta's MMS voices speak other languages. All
// run on ONNX Runtime in-process. The base install is a one-time ~230 MB
// download into Scorpion's own model library, plus ~38 MB per extra language
// voice; after that no network is ever used (remote loading stays off).
import fs from 'node:fs';
import path from 'node:path';
import { KOKORO_LANGUAGES, hasKokoroVoice, phonemes, voiceFor } from './g2p/index.js';

const WHISPER = { id: 'onnx-community/whisper-base', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' } };
// The better listener (Settings → Voice): Whisper Small, one download beside the base one. On noisy French, Spanish, Italian and
// Portuguese speech it makes about a quarter of the mistakes (2% of words wrong against 8%), and takes about three times as long to
// understand a sentence (3 s on a fast computer, against 1 s), so it is a choice and not the default.
const WHISPER_SMALL = { id: 'onnx-community/whisper-small', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } };
export const LISTENER_SMALL_BYTES = 260 * 1024 ** 2;
export const LISTENERS = ['base', 'small'];
const listenerModel = (level) => (level === 'small' ? WHISPER_SMALL : WHISPER);
const KOKORO = { id: 'onnx-community/Kokoro-82M-v1.0-ONNX', dtype: 'q8' };
// Files that must be present for each model to load offline.
const REQUIRED = {
  [WHISPER.id]: ['config.json', 'onnx/encoder_model.onnx', 'onnx/decoder_model_merged_quantized.onnx', 'tokenizer.json'],
  [KOKORO.id]: ['config.json', 'onnx/model_quantized.onnx', 'tokenizer.json'],
};
export const VOICE_DOWNLOAD_BYTES = 230 * 1024 ** 2;
// The faster voice: the same Kokoro model unquantized (fp32). The small 8-bit one is slower than real time on many processors
// (measured: 1.5 s to speak 1 s on a 14-core i9, against 0.7 s for this one), which is a pause after every sentence.
export const FAST_VOICE_BYTES = 310 * 1024 ** 2;

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
// 'kokoro' (the main voice model: English, and French, Spanish, Italian, Portuguese, Hindi and Haitian Creole through the letters-to-sounds
// rules in g2p/, with Kokoro's own voices for them, which need no download), an MMS voice code (one ~38 MB download each), or
// 'system' (the computer's own voice for that language, if it has one).
// Haitian Creole has no voice of its own anywhere: it is spoken with Kokoro's French voice, saying Creole sounds (g2p/ht.js).
export const LANGUAGES = [
  { id: 'en', name: 'English', native: 'English', speech: 'kokoro' },
  { id: 'fr', name: 'French', native: 'Français', speech: 'kokoro' },
  { id: 'ht', name: 'Haitian Creole', native: 'Kreyòl ayisyen', speech: 'kokoro', approximate: true },
  { id: 'es', name: 'Spanish', native: 'Español', speech: 'kokoro' },
  { id: 'pt', name: 'Portuguese', native: 'Português', speech: 'kokoro' },
  { id: 'de', name: 'German', native: 'Deutsch', speech: 'deu' },
  { id: 'it', name: 'Italian', native: 'Italiano', speech: 'kokoro' },
  { id: 'ru', name: 'Russian', native: 'Русский', speech: 'rus' },
  { id: 'ar', name: 'Arabic', native: 'العربية', speech: 'ara' },
  { id: 'hi', name: 'Hindi', native: 'हिन्दी', speech: 'kokoro' },
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
  // More languages: listened to by Whisper, answered in by the chat model, spoken by the computer's own voice for that language when it
  // has one (Windows: Settings, Time & language, Speech; macOS and Scorpion OS have their own).
  { id: 'el', name: 'Greek', native: 'Ελληνικά', speech: 'system' },
  { id: 'he', name: 'Hebrew', native: 'עברית', speech: 'system' },
  { id: 'th', name: 'Thai', native: 'ไทย', speech: 'system' },
  { id: 'bn', name: 'Bengali', native: 'বাংলা', speech: 'system' },
  { id: 'ur', name: 'Urdu', native: 'اردو', speech: 'system' },
  { id: 'fa', name: 'Persian', native: 'فارسی', speech: 'system' },
  { id: 'cs', name: 'Czech', native: 'Čeština', speech: 'system' },
  { id: 'sv', name: 'Swedish', native: 'Svenska', speech: 'system' },
  { id: 'da', name: 'Danish', native: 'Dansk', speech: 'system' },
  { id: 'no', name: 'Norwegian', native: 'Norsk', speech: 'system', bcp: 'nb' },
  { id: 'fi', name: 'Finnish', native: 'Suomi', speech: 'system' },
  { id: 'hu', name: 'Hungarian', native: 'Magyar', speech: 'system' },
  { id: 'ca', name: 'Catalan', native: 'Català', speech: 'system' },
  { id: 'ta', name: 'Tamil', native: 'தமிழ்', speech: 'system' },
  { id: 'tl', name: 'Filipino', native: 'Filipino', speech: 'system', bcp: 'fil' },
  { id: 'ms', name: 'Malay', native: 'Bahasa Melayu', speech: 'system' },
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
const asrs = new Map(); // listener level -> loaded Whisper pipeline
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
    languageVoices: Object.fromEntries(Object.entries(KOKORO_LANGUAGES).map(([id, l]) => [id, l.voices])),
    listeners: { small: { ready: smallReady(), bytes: LISTENER_SMALL_BYTES } },
    languages: LANGUAGES.map((l) => ({ ...l, voiceReady: l.speech === 'kokoro' ? installed : l.speech === 'system' ? true : mmsReady(l.speech) })),
    bytes: VOICE_DOWNLOAD_BYTES,
    fast: installed && fastReady(),
    fastBytes: FAST_VOICE_BYTES,
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
      asrs.set('base', await loadAsr('base', report, true));
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
  for (const a of asrs.values()) await a?.dispose?.().catch(() => {});
  asrs.clear();
  tts = null;
  for (const p of mms.values()) await p?.dispose?.().catch(() => {});
  mms.clear();
}

async function loadAsr(level = 'base', progress_callback, download = false) {
  const { pipeline } = await lib(download);
  const m = listenerModel(level);
  return pipeline('automatic-speech-recognition', m.id, { dtype: m.dtype, device: 'cpu', progress_callback });
}

// Written once Whisper Small has downloaded AND loaded, so a download cut off halfway never counts.
const smallMarker = () => path.join(dir, 'listener-small.json');
export const smallReady = () => Boolean(dir) && fs.existsSync(smallMarker()) && fs.existsSync(path.join(dir, WHISPER_SMALL.id, 'onnx', 'decoder_model_merged_quantized.onnx'));
let smallInstalling = null;
export function installListener(level, onProgress) {
  if (level !== 'small') return Promise.resolve();
  if (!voiceStatus().installed) return Promise.reject(new Error('Install the voice first.'));
  if (smallReady()) return Promise.resolve();
  smallInstalling ??= (async () => {
    writableDir({ copySystem: true });
    const totals = new Map();
    const report = (p) => {
      if (p.status !== 'progress' && p.status !== 'done') return;
      totals.set(p.file, { loaded: p.loaded ?? p.total ?? 0, total: p.total ?? 0 });
      let loaded = 0, total = 0;
      for (const t of totals.values()) { loaded += t.loaded; total += t.total; }
      onProgress?.({ loaded, total: Math.max(total, LISTENER_SMALL_BYTES), done: false });
    };
    try {
      fs.rmSync(path.join(dir, WHISPER_SMALL.id), { recursive: true, force: true });
      asrs.set('small', await loadAsr('small', report, true));
      fs.writeFileSync(smallMarker(), JSON.stringify({ model: WHISPER_SMALL.id, at: new Date().toISOString() }));
      onProgress?.({ done: true });
    } catch (err) {
      fs.rmSync(path.join(dir, WHISPER_SMALL.id), { recursive: true, force: true });
      fs.rmSync(smallMarker(), { force: true });
      throw err;
    } finally {
      transformers.env.allowRemoteModels = false;
      smallInstalling = null;
    }
  })();
  return smallInstalling;
}

// Written once the faster voice has downloaded AND loaded, so a download cut off halfway never counts (the file alone would).
const fastMarker = () => path.join(dir, 'fast-voice.json');
export const fastReady = () => Boolean(dir) && fs.existsSync(fastMarker()) && fs.existsSync(path.join(dir, KOKORO.id, 'onnx', 'model.onnx'));

async function loadTts(progress_callback, download = false, dtype = fastReady() ? 'fp32' : KOKORO.dtype) {
  await lib(download);
  const { KokoroTTS } = await import('kokoro-js');
  return KokoroTTS.from_pretrained(KOKORO.id, { dtype, device: 'cpu', progress_callback });
}

// Downloads the faster voice (~310 MB) next to the installed one. Until it has loaded, nothing changes.
let fastInstalling = null;
export function installFastVoice(onProgress) {
  if (!voiceStatus().installed) return Promise.reject(new Error('Install the voice first.'));
  fastInstalling ??= (async () => {
    writableDir({ copySystem: true });
    const file = path.join(dir, KOKORO.id, 'onnx', 'model.onnx');
    const report = (p) => { if (p.status === 'progress' && /model\.onnx$/.test(p.file || '')) onProgress?.({ loaded: p.loaded ?? 0, total: Math.max(p.total ?? 0, FAST_VOICE_BYTES), done: false }); };
    try {
      fs.rmSync(file, { force: true });
      const loaded = await loadTts(report, true, 'fp32');
      fs.writeFileSync(fastMarker(), JSON.stringify({ dtype: 'fp32', at: new Date().toISOString() }));
      tts = loaded; // the next sentence is spoken with it
      onProgress?.({ done: true });
    } catch (err) {
      fs.rmSync(file, { force: true });
      fs.rmSync(fastMarker(), { force: true });
      throw err;
    } finally {
      transformers.env.allowRemoteModels = false;
      fastInstalling = null;
    }
  })();
  return fastInstalling;
}

// Load both models ahead of time (they take a few seconds), so the first
// spoken sentence or transcription doesn't wait for them.
let warming = null;
export function warmUp(language = 'en', listener = 'base') {
  if (!voiceStatus().installed || installing) return Promise.resolve();
  const code = languageOf(language).speech;
  warming ??= (async () => {
    if (code === 'kokoro') tts ??= await loadTts();
    else if (mmsReady(code) && !mms.has(code)) mms.set(code, await loadMms(code));
    const level = listener === 'small' && smallReady() ? 'small' : 'base';
    if (!asrs.has(level)) asrs.set(level, await loadAsr(level));
  })().catch(() => {}).finally(() => { warming = null; });
  return warming;
}

function needInstalled() {
  if (!voiceStatus().installed) throw new Error('Voice is not installed. Open Settings → Voice and click Install.');
}

// pcm: 16 kHz mono Float32Array from the microphone.
export async function transcribe(pcm, language = 'en', { listener = 'base' } = {}) {
  needInstalled();
  const level = listener === 'small' && smallReady() ? 'small' : 'base';
  if (!asrs.has(level)) asrs.set(level, await loadAsr(level));
  const asr = asrs.get(level);
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
    if (lang.speech === 'system' || !mmsReady(lang.speech)) return { system: true, text: spoken, lang: lang.bcp ?? lang.id };
    if (!mms.has(lang.speech)) mms.set(lang.speech, await loadMms(lang.speech));
    const out = await mms.get(lang.speech)(spoken);
    return { sampleRate: out.sampling_rate, audio: out.audio };
  }
  tts ??= await loadTts();
  const rate = Math.min(Math.max(Number(speed) || 1, 0.5), 2);
  // French, Spanish, Italian, Portuguese, Hindi and Haitian Creole: our own letters-to-sounds rules, then one of Kokoro's voices for the language.
  if (hasKokoroVoice(lang.id)) {
    const ids = tts.tokenizer(phonemes(lang.id, spoken), { truncation: true }).input_ids;
    const out = await tts.generate_from_ids(ids, { voice: voiceFor(lang.id, voice), speed: rate });
    return { sampleRate: out.sampling_rate, audio: out.audio };
  }
  const known = VOICES.some((v) => v.id === voice) ? voice : 'af_heart';
  const out = await tts.generate(spoken, { voice: known, speed: rate });
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
