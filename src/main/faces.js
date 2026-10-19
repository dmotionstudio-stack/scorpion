// Face recognition, on this computer only. The pipeline follows SeetaFace2
// (detect → 5 landmarks → align → face print → compare, plus tracking and a
// quality check) with open models on the ONNX engine Scorpion already ships:
//   YuNet (OpenCV Zoo, MIT) finds faces and 5 landmarks per face;
//   SFace (OpenCV Zoo, Apache-2.0) turns an aligned 112×112 face into a
//   128-number face print. Two prints of the same person have a cosine
//   similarity above ~0.36.
// People you enroll are stored as face prints (and a small thumbnail) in
// faces.json in Scorpion's data folder. Photos themselves are never copied.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MODELS = {
  detector: { file: 'face_detection_yunet_2023mar.onnx', url: 'https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx', bytes: 232589 },
  recognizer: { file: 'face_recognition_sface_2021dec.onnx', url: 'https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx', bytes: 38696353 },
};
export const FACE_DOWNLOAD_BYTES = MODELS.detector.bytes + MODELS.recognizer.bytes;
const SIZE = 640; // YuNet's fixed input
const SCORE_MIN = 0.6;
export const SAME_PERSON = 0.363; // SFace's published cosine threshold
export const UNLOCK = 0.5; // stricter, for face lock
const MAX_PRINTS = 12;
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff']);

let modelDir = null;
let dataFile = null;
let ort = null;
let det = null;
let rec = null;
let installing = null;

export function initFaces(modelsDir, dataDir) {
  modelDir = path.join(modelsDir, 'faces');
  dataFile = path.join(dataDir, 'faces.json');
}

const marker = () => path.join(modelDir, 'installed.json');
export function faceStatus() {
  const installed = Boolean(modelDir) && fs.existsSync(marker()) && Object.values(MODELS).every((m) => fs.existsSync(path.join(modelDir, m.file)));
  return { installed, installing: Boolean(installing), bytes: FACE_DOWNLOAD_BYTES, people: listPeople() };
}

// ---------- models ----------
async function download(model, onBytes) {
  const res = await fetch(model.url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${model.file}`);
  const part = path.join(modelDir, `${model.file}.part`);
  const out = fs.createWriteStream(part);
  const reader = res.body.getReader();
  let got = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      onBytes(value.length);
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (got !== model.bytes) { fs.rmSync(part, { force: true }); throw new Error(`${model.file} is incomplete (${got} of ${model.bytes} bytes)`); }
  fs.renameSync(part, path.join(modelDir, model.file));
}

// One-time download (~39 MB). Counts as installed only once both models load.
export function installFaces(onProgress) {
  installing ??= (async () => {
    try {
      fs.mkdirSync(modelDir, { recursive: true });
      let loaded = 0;
      for (const m of Object.values(MODELS)) {
        if (fs.existsSync(path.join(modelDir, m.file)) && fs.statSync(path.join(modelDir, m.file)).size === m.bytes) { loaded += m.bytes; continue; }
        await download(m, (n) => { loaded += n; onProgress?.({ loaded, total: FACE_DOWNLOAD_BYTES }); });
      }
      await load();
      fs.writeFileSync(marker(), JSON.stringify({ models: Object.values(MODELS).map((m) => m.file), at: new Date().toISOString() }));
      onProgress?.({ done: true });
    } finally {
      installing = null;
    }
  })();
  return installing;
}

export async function uninstallFaces() {
  det = null;
  rec = null;
  if (modelDir) fs.rmSync(modelDir, { recursive: true, force: true });
}

async function load() {
  ort ??= (await import('onnxruntime-node')).default;
  const opt = { logSeverityLevel: 3 };
  det ??= await ort.InferenceSession.create(path.join(modelDir, MODELS.detector.file), opt);
  rec ??= await ort.InferenceSession.create(path.join(modelDir, MODELS.recognizer.file), opt);
}

async function ready() {
  if (!faceStatus().installed) throw new Error('Face recognition is not installed. Open Settings → People and click Install.');
  await load();
}

// ---------- detection (YuNet) ----------
// img: { data: Uint8Array|Uint8ClampedArray, width, height, channels (3 RGB or 4 RGBA) }
export async function detectFaces(img) {
  await ready();
  const { width: w, height: h, channels: c, data } = img;
  const scale = SIZE / Math.max(w, h);
  const sw = Math.round(w * scale);
  const sh = Math.round(h * scale);
  // Letterbox into 640×640, BGR, CHW, 0–255, bilinear.
  const input = new Float32Array(3 * SIZE * SIZE);
  for (let y = 0; y < sh; y++) {
    const fy = Math.min(h - 1, (y + 0.5) / scale - 0.5);
    const y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), wy = Math.max(0, fy - y0);
    for (let x = 0; x < sw; x++) {
      const fx = Math.min(w - 1, (x + 0.5) / scale - 0.5);
      const x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), wx = Math.max(0, fx - x0);
      for (let ch = 0; ch < 3; ch++) {
        const p = (yy, xx) => data[(yy * w + xx) * c + ch];
        const v = (p(y0, x0) * (1 - wx) + p(y0, x1) * wx) * (1 - wy) + (p(y1, x0) * (1 - wx) + p(y1, x1) * wx) * wy;
        input[(2 - ch) * SIZE * SIZE + y * SIZE + x] = v; // RGB → BGR planes
      }
    }
  }
  const out = await det.run({ input: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  const faces = [];
  for (const stride of [8, 16, 32]) {
    const cols = SIZE / stride;
    const cls = out[`cls_${stride}`].data, obj = out[`obj_${stride}`].data, bbox = out[`bbox_${stride}`].data, kps = out[`kps_${stride}`].data;
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
      if (score < SCORE_MIN) continue;
      const r = Math.floor(i / cols), col = i % cols;
      const cx = (col + bbox[i * 4]) * stride, cy = (r + bbox[i * 4 + 1]) * stride;
      const bw = Math.exp(bbox[i * 4 + 2]) * stride, bh = Math.exp(bbox[i * 4 + 3]) * stride;
      const landmarks = [];
      for (let k = 0; k < 5; k++) landmarks.push([(col + kps[i * 10 + k * 2]) * stride / scale, (r + kps[i * 10 + k * 2 + 1]) * stride / scale]);
      faces.push({ score, box: [(cx - bw / 2) / scale, (cy - bh / 2) / scale, bw / scale, bh / scale], landmarks });
    }
  }
  return nms(faces, 0.3).map((f) => ({ ...f, box: clipBox(f.box, w, h) }));
}

function iou(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a[2] * a[3] + b[2] * b[3] - inter || 1);
}
export { iou as boxOverlap };

function nms(faces, threshold) {
  const kept = [];
  for (const f of faces.sort((a, b) => b.score - a.score)) if (kept.every((k) => iou(k.box, f.box) < threshold)) kept.push(f);
  return kept;
}

const clipBox = ([x, y, bw, bh], w, h) => {
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  return [x0, y0, Math.min(w, x + bw) - x0, Math.min(h, y + bh) - y0];
};

// ---------- alignment ----------
// The standard 112×112 positions of right eye, left eye, nose, right and left
// mouth corners that SFace (like ArcFace) was trained on.
const TEMPLATE = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];

// Least-squares similarity transform (scale, rotation, shift) from src to dst.
export function similarity(src, dst) {
  const n = src.length;
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { sx += src[i][0]; sy += src[i][1]; dx += dst[i][0]; dy += dst[i][1]; }
  sx /= n; sy /= n; dx /= n; dy /= n;
  let a = 0, b = 0, norm = 0;
  for (let i = 0; i < n; i++) {
    const px = src[i][0] - sx, py = src[i][1] - sy, qx = dst[i][0] - dx, qy = dst[i][1] - dy;
    a += px * qx + py * qy;
    b += px * qy - py * qx;
    norm += px * px + py * py;
  }
  a /= norm; b /= norm;
  // dst = [a -b; b a] · src + t
  return { a, b, tx: dx - (a * sx - b * sy), ty: dy - (b * sx + a * sy) };
}

// Aligned face as RGB planes (CHW, 0–255), the input SFace expects.
function align(img, landmarks) {
  const { a, b, tx, ty } = similarity(landmarks, TEMPLATE);
  const det2 = a * a + b * b;
  const { width: w, height: h, channels: c, data } = img;
  const out = new Float32Array(3 * 112 * 112);
  for (let y = 0; y < 112; y++) {
    for (let x = 0; x < 112; x++) {
      // Inverse map: src = M⁻¹ (dst − t)
      const u = x - tx, v = y - ty;
      const fx = (a * u + b * v) / det2, fy = (-b * u + a * v) / det2;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), wx = fx - x0, wy = fy - y0;
      for (let ch = 0; ch < 3; ch++) {
        const p = (yy, xx) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : data[(yy * w + xx) * c + ch]);
        out[ch * 112 * 112 + y * 112 + x] = (p(y0, x0) * (1 - wx) + p(y0, x0 + 1) * wx) * (1 - wy) + (p(y0 + 1, x0) * (1 - wx) + p(y0 + 1, x0 + 1) * wx) * wy;
      }
    }
  }
  return out;
}

async function facePrint(aligned) {
  const out = await rec.run({ data: new ort.Tensor('float32', aligned, [1, 3, 112, 112]) });
  const v = Float32Array.from(out.fc1.data);
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => x / n);
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ---------- quality (like SeetaFace2's QualityAssessor) ----------
export function faceQuality(face, aligned) {
  const issues = [];
  const size = Math.min(face.box[2], face.box[3]);
  if (size < 48) issues.push('too small');
  // Brightness and sharpness on the aligned face's grey image.
  const gray = new Float32Array(112 * 112);
  let mean = 0;
  for (let i = 0; i < gray.length; i++) { gray[i] = 0.299 * aligned[i] + 0.587 * aligned[gray.length + i] + 0.114 * aligned[2 * gray.length + i]; mean += gray[i]; }
  mean /= gray.length;
  if (mean < 50) issues.push('too dark');
  if (mean > 215) issues.push('too bright');
  let lap = 0, lapMean = 0;
  const lv = [];
  for (let y = 1; y < 111; y++) for (let x = 1; x < 111; x++) {
    const i = y * 112 + x;
    const l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - 112] - gray[i + 112];
    lv.push(l);
    lapMean += l;
  }
  lapMean /= lv.length;
  for (const l of lv) lap += (l - lapMean) ** 2;
  const sharpness = lap / lv.length;
  if (sharpness < 25) issues.push('blurry');
  // Pose from the landmarks: eyes level and the nose between them.
  const [re, le, nose] = face.landmarks;
  const eyeDist = Math.hypot(le[0] - re[0], le[1] - re[1]) || 1;
  const roll = Math.abs(Math.atan2(le[1] - re[1], le[0] - re[0])) * 180 / Math.PI;
  const yaw = Math.abs((nose[0] - (re[0] + le[0]) / 2) / eyeDist);
  if (roll > 25 || yaw > 0.35) issues.push('not facing the camera');
  const score = Math.max(0, Math.min(1, (Math.min(size, 160) / 160) * 0.35 + Math.min(sharpness, 150) / 150 * 0.35 + (1 - Math.min(yaw, 0.5) * 2) * 0.3));
  return { score: +score.toFixed(2), ok: issues.length === 0, issues, size: Math.round(size), brightness: Math.round(mean), sharpness: Math.round(sharpness) };
}

// ---------- people ----------
function readPeople() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')).people || []; } catch { return []; }
}
function writePeople(people) {
  fs.writeFileSync(dataFile, JSON.stringify({ people }, null, 1));
}
export function listPeople() {
  if (!dataFile) return [];
  return readPeople().map((p) => ({ id: p.id, name: p.name, owner: Boolean(p.owner), samples: p.prints.length, thumb: p.thumb || null }));
}
export function removePerson(id) { writePeople(readPeople().filter((p) => p.id !== id)); }
export function renamePerson(id, name) { writePeople(readPeople().map((p) => (p.id === id ? { ...p, name: String(name).trim().slice(0, 60) || p.name } : p))); }
export function setOwner(id, owner) { writePeople(readPeople().map((p) => (p.id === id ? { ...p, owner: Boolean(owner) } : p))); }

// Who is this face print? Best match above the threshold, or null.
export function identify(print, threshold = SAME_PERSON, people = readPeople()) {
  let best = null;
  for (const p of people) {
    const sim = Math.max(...p.prints.map((q) => cosine(print, q)));
    if (sim >= threshold && (!best || sim > best.similarity)) best = { id: p.id, name: p.name, owner: Boolean(p.owner), similarity: +sim.toFixed(3) };
  }
  return best;
}

// ---------- images ----------
async function decodeFile(file, maxSide = 1600) {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(file).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

async function thumbnail(img, box) {
  const sharp = (await import('sharp')).default;
  const pad = 0.25;
  const x = Math.max(0, Math.round(box[0] - box[2] * pad)), y = Math.max(0, Math.round(box[1] - box[3] * pad));
  const wdt = Math.min(img.width - x, Math.round(box[2] * (1 + 2 * pad))), hgt = Math.min(img.height - y, Math.round(box[3] * (1 + 2 * pad)));
  const buf = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: img.channels } })
    .extract({ left: x, top: y, width: Math.max(1, wdt), height: Math.max(1, hgt) }).resize(96, 96, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

// Every face in an image, with who it is and its quality.
export async function analyzeImage(img, { people = readPeople() } = {}) {
  const faces = await detectFaces(img);
  const out = [];
  for (const f of faces) {
    const aligned = align(img, f.landmarks);
    const print = await facePrint(aligned);
    out.push({ box: f.box.map(Math.round), score: +f.score.toFixed(3), landmarks: f.landmarks.map(([x, y]) => [Math.round(x), Math.round(y)]), person: identify(print, SAME_PERSON, people), quality: faceQuality(f, aligned), print });
  }
  return out;
}

export async function analyzeFile(file) {
  return analyzeImage(await decodeFile(file));
}

// A camera frame from the page (RGBA). Prints are left out of the reply.
export async function analyzeFrame({ data, width, height }) {
  const faces = await analyzeImage({ data: data instanceof Uint8Array || data instanceof Uint8ClampedArray ? data : new Uint8Array(data), width, height, channels: 4 });
  return faces.map(({ print, ...f }) => f);
}

// Enroll a person from image files and/or camera frames. The largest good
// face of each picture is used; poor ones are skipped with the reason.
export async function enroll({ id = null, name, files = [], frames = [] }) {
  await ready();
  const people = readPeople();
  let person = id ? people.find((p) => p.id === id) : null;
  if (!person) {
    person = { id: crypto.randomUUID(), name: String(name || 'Person').trim().slice(0, 60), owner: people.length === 0, prints: [], thumb: null, createdAt: Date.now() };
    people.push(person);
  }
  const skipped = [];
  let added = 0;
  const sources = [...files.map((f) => ({ label: path.basename(f), load: () => decodeFile(f) })),
    ...frames.map((f, i) => ({ label: `camera shot ${i + 1}`, load: async () => ({ data: new Uint8Array(f.data), width: f.width, height: f.height, channels: 4 }) }))];
  for (const s of sources) {
    let img;
    try { img = await s.load(); } catch { skipped.push(`${s.label}: can't be opened as an image`); continue; }
    const faces = await detectFaces(img);
    if (!faces.length) { skipped.push(`${s.label}: no face found`); continue; }
    const f = faces.sort((p, q) => q.box[2] * q.box[3] - p.box[2] * p.box[3])[0];
    const aligned = align(img, f.landmarks);
    const q = faceQuality(f, aligned);
    if (!q.ok) { skipped.push(`${s.label}: face ${q.issues.join(', ')}`); continue; }
    person.prints.push(await facePrint(aligned));
    if (person.prints.length > MAX_PRINTS) person.prints.shift();
    person.thumb ??= await thumbnail(img, f.box).catch(() => null);
    added++;
  }
  if (!person.prints.length) {
    writePeople(people.filter((p) => p.id !== person.id));
    return { person: null, added, skipped };
  }
  writePeople(people);
  return { person: { id: person.id, name: person.name, samples: person.prints.length }, added, skipped };
}

// ---------- folders of photos ----------
export function listImages(folder, { recursive = true, limit = 1000 } = {}) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (recursive && depth < 6 && !e.name.startsWith('.')) walk(full, depth + 1); }
      else if (IMAGE_EXT.has(path.extname(e.name).toLowerCase())) out.push(full);
    }
  };
  walk(folder, 0);
  return out;
}

// Groups photos by enrolled person; faces nobody enrolled are clustered into
// "Unknown person 1, 2, …" so the same stranger is grouped together.
export async function groupPhotos(folder, { recursive = true, onProgress } = {}) {
  await ready();
  const people = readPeople();
  const files = listImages(folder, { recursive });
  const byPerson = new Map();
  const unknown = []; // { centroid, files: Set }
  let noFaces = 0;
  let done = 0;
  for (const file of files) {
    let faces = [];
    try { faces = await analyzeImage(await decodeFile(file, 1280), { people }); } catch { /* unreadable image */ }
    if (!faces.length) noFaces++;
    for (const f of faces) {
      if (f.person) {
        if (!byPerson.has(f.person.name)) byPerson.set(f.person.name, new Set());
        byPerson.get(f.person.name).add(file);
      } else if (f.quality.size >= 40) {
        let group = unknown.find((u) => cosine(u.centroid, f.print) >= 0.42);
        if (!group) { group = { centroid: f.print, files: new Set() }; unknown.push(group); }
        group.files.add(file);
      }
    }
    onProgress?.(++done, files.length);
  }
  const groups = [...byPerson].map(([name, set]) => ({ name, photos: [...set] }));
  unknown.filter((u) => u.files.size >= 1).sort((a, b) => b.files.size - a.files.size)
    .forEach((u, i) => groups.push({ name: `Unknown person ${i + 1}`, unknown: true, photos: [...u.files] }));
  return { folder, scanned: files.length, withoutFaces: noFaces, groups };
}
