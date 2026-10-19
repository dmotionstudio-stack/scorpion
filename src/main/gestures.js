// Hand gestures for the Interact orb. MediaPipe's hand landmarker runs in the
// page on WebAssembly that ships with Scorpion; only its model is a one-time
// ~8 MB download into Scorpion's own model library. After that no network is
// used, and the camera is only on while gestures are switched on.
import fs from 'node:fs';
import path from 'node:path';

export const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export const MODEL_FILE = 'hand_landmarker.task';
export const GESTURES_DOWNLOAD_BYTES = 8 * 1024 ** 2;

let dir = null;
let installing = null;

export function initGestures(modelsDir) {
  dir = path.join(modelsDir, 'gestures');
}

export const modelPath = () => (dir ? path.join(dir, MODEL_FILE) : null);
// Written only after the page loaded the model, so a cut-off or damaged
// download never counts as installed.
const marker = () => path.join(dir, 'installed.json');

export function gesturesStatus() {
  const downloaded = Boolean(dir) && fs.existsSync(modelPath());
  return { installed: downloaded && fs.existsSync(marker()), downloaded, installing: Boolean(installing), bytes: GESTURES_DOWNLOAD_BYTES };
}

// Downloads the model. onProgress gets { loaded, total, done }.
export function installGestures(onProgress) {
  installing ??= (async () => {
    const part = `${modelPath()}.part`;
    try {
      // Start clean: a model that was downloaded but never loaded is suspect.
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const res = await fetch(MODEL_URL);
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
      const total = Number(res.headers.get('content-length')) || GESTURES_DOWNLOAD_BYTES;
      const out = fs.createWriteStream(part);
      let loaded = 0;
      try {
        for await (const chunk of res.body) {
          loaded += chunk.length;
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          onProgress?.({ loaded, total, done: false });
        }
      } finally {
        await new Promise((r) => out.end(r));
      }
      if (!looksLikeModel(part)) throw new Error('The downloaded hand model is damaged. Try again.');
      fs.renameSync(part, modelPath());
      onProgress?.({ done: true });
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw err;
    } finally {
      installing = null;
    }
  })();
  return installing;
}

// A .task model is a zip archive of a few small models (with a little padding
// before it), so a complete one ends with the zip's end-of-directory record.
export function looksLikeModel(file) {
  try {
    const { size } = fs.statSync(file);
    if (size < 1024 ** 2) return false;
    const tail = Buffer.alloc(1024);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, tail, 0, tail.length, size - tail.length); } finally { fs.closeSync(fd); }
    return tail.includes(Buffer.from('PK\x05\x06', 'latin1'));
  } catch {
    return false;
  }
}

// The page loaded the model: from now on it counts as installed.
export function markLoaded() {
  if (!fs.existsSync(modelPath())) throw new Error('The hand model is not downloaded.');
  fs.writeFileSync(marker(), JSON.stringify({ model: MODEL_URL, at: new Date().toISOString() }));
  return gesturesStatus();
}

export function uninstallGestures() {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  return gesturesStatus();
}
