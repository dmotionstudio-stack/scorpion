// Face insights, ported from DeepFace (github.com/serengil/deepface, MIT) to
// Scorpion's own face engine, with DeepFace's ONNX models:
//   - expression: angry, disgust, fear, happy, sad, surprise, neutral (6 MB);
//   - liveness (anti-spoofing): is it a real face, or a photo or screen held to
//     the camera? Two MiniFASNet models from Minivision's Silent-Face-Anti-
//     Spoofing (Apache-2.0), as DeepFace combines them (3.5 MB);
//   - apparent age and gender, VGG-Face based (1 GB, optional download).
// DeepFace also guesses race; Scorpion deliberately leaves that out.
// Faces come from Scorpion's YuNet detector; the crops follow DeepFace's
// preprocessing exactly (eye-levelled face box letterboxed to 224×224, BGR in
// [0, 1]; 48×48 grey for expressions; 80×80 BGR crops at 2.7× and 4× the box
// for liveness).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = 'https://huggingface.co/serengil/deepface/resolve/main/';
export const MODELS = {
  emotion: { file: 'facial_expression_model_weights.onnx', bytes: 5947004, sha256: '2131942f16003c515f6b1fb09827f9eef111048f033bcc477fbb71f0d446f2a9', pack: 'insights' },
  spoofA: { file: '2.7_80x80_MiniFASNetV2.onnx', bytes: 1746407, sha256: '2e0b0bdcdaf2ed0e8ceae7a8588a8b029c0f1bf2b15876eee942b68ce51bbb29', pack: 'insights' },
  spoofB: { file: '4_0_0_80x80_MiniFASNetV1SE.onnx', bytes: 1745918, sha256: '1e2645be6e42759714f19ee23641366cf3d86cba5f169964880894a1fc188275', pack: 'insights' },
  age: { file: 'age_model_weights.onnx', bytes: 538693014, sha256: '6f86e67868ba5a4a8f266fcf8e9be2da66e731d6b7081a6a7c3cfed1d71eaca8', pack: 'demography' },
  gender: { file: 'gender_model_weights.onnx', bytes: 537070600, sha256: 'ca068552d066f0078cbf379514b9bf5462cbf92f79027ea91a523e1bae7e29ad', pack: 'demography' },
};
export const PACKS = {
  insights: { label: 'Expressions and liveness', bytes: MODELS.emotion.bytes + MODELS.spoofA.bytes + MODELS.spoofB.bytes },
  demography: { label: 'Age and gender', bytes: MODELS.age.bytes + MODELS.gender.bytes },
};
export const EMOTIONS = ['angry', 'disgust', 'fear', 'happy', 'sad', 'surprise', 'neutral'];
export const GENDERS = ['Woman', 'Man'];

let dir = null;
let ort = null;
const sessions = {};
const installing = {};

export function initFaceInsights(modelsDir) {
  dir = path.join(modelsDir, 'faces', 'deepface');
}

const has = (pack) => Boolean(dir) && Object.values(MODELS).filter((m) => m.pack === pack).every((m) => fs.existsSync(path.join(dir, m.file)));
export function insightsStatus() {
  return Object.fromEntries(Object.entries(PACKS).map(([k, p]) => [k, { installed: has(k), installing: Boolean(installing[k]), bytes: p.bytes, label: p.label }]));
}

// Downloads a pack, checking each file's size and SHA-256.
export async function installInsights(pack, onProgress) {
  if (!PACKS[pack]) throw new Error(`Unknown pack ${pack}`);
  if (installing[pack]) return installing[pack];
  installing[pack] = (async () => {
    fs.mkdirSync(dir, { recursive: true });
    const files = Object.values(MODELS).filter((m) => m.pack === pack && !fs.existsSync(path.join(dir, m.file)));
    const total = files.reduce((n, m) => n + m.bytes, 0);
    let done = 0;
    for (const m of files) {
      const res = await fetch(BASE + m.file);
      if (!res.ok) throw new Error(`Download failed (${res.status}) for ${m.file}`);
      const part = path.join(dir, `${m.file}.part`);
      const out = fs.createWriteStream(part);
      const hash = crypto.createHash('sha256');
      try {
        for await (const chunk of res.body) {
          hash.update(chunk);
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          done += chunk.length;
          onProgress?.({ loaded: done, total });
        }
        await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
      } catch (err) {
        out.destroy();
        fs.rmSync(part, { force: true });
        throw err;
      }
      if (hash.digest('hex') !== m.sha256) { fs.rmSync(part, { force: true }); throw new Error(`${m.file} did not download correctly; try again`); }
      fs.renameSync(part, path.join(dir, m.file));
    }
    onProgress?.({ done: true });
    return insightsStatus();
  })();
  try { return await installing[pack]; } finally { delete installing[pack]; }
}

export function uninstallInsights(pack) {
  for (const [key, m] of Object.entries(MODELS)) {
    if (m.pack !== pack) continue;
    delete sessions[key];
    fs.rmSync(path.join(dir, m.file), { force: true });
  }
  return insightsStatus();
}

async function session(key) {
  if (sessions[key]) return sessions[key];
  if (!fs.existsSync(path.join(dir, MODELS[key].file))) return null;
  ort ??= (await import('onnxruntime-node')).default;
  sessions[key] = await ort.InferenceSession.create(path.join(dir, MODELS[key].file), { logSeverityLevel: 3 });
  return sessions[key];
}

async function run(key, data, dims) {
  const s = await session(key);
  if (!s) return null;
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', data, dims) });
  return Array.from(out[s.outputNames[0]].data);
}

// ---------- crops (pure functions, tested) ----------
// Bilinear sample of one channel; outside the image is black.
function sample(img, x, y, ch) {
  const { width: w, height: h, channels: c, data } = img;
  const x0 = Math.floor(x), y0 = Math.floor(y), wx = x - x0, wy = y - y0;
  const p = (yy, xx) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : data[(yy * w + xx) * c + ch]);
  return (p(y0, x0) * (1 - wx) + p(y0, x0 + 1) * wx) * (1 - wy) + (p(y0 + 1, x0) * (1 - wx) + p(y0 + 1, x0 + 1) * wx) * wy;
}

// DeepFace's face for age, gender and expression: the detected box, turned so
// the eyes are level, letterboxed (black bars) into size×size, BGR in [0, 1],
// channels last.
export function faceCrop(img, face, size = 224) {
  const [bx, by, bw, bh] = face.box;
  const [e1, e2] = face.landmarks || [];
  const angle = e1 && e2 ? Math.atan2(e2[1] - e1[1], e2[0] - e1[0]) : 0;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const cx = bx + bw / 2, cy = by + bh / 2;
  const s = size / Math.max(bw, bh);
  const cw = bw * s, chh = bh * s, offX = (size - cw) / 2, offY = (size - chh) / 2;
  const out = new Float32Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x < offX || x >= offX + cw || y < offY || y >= offY + chh) continue; // padding stays 0
      const lx = (x + 0.5 - offX) / s - bw / 2, ly = (y + 0.5 - offY) / s - bh / 2;
      const sx = cx + lx * cos - ly * sin - 0.5, sy = cy + lx * sin + ly * cos - 0.5;
      const o = (y * size + x) * 3;
      for (let ch = 0; ch < 3; ch++) out[o + (2 - ch)] = sample(img, sx, sy, ch) / 255; // RGB → BGR
    }
  }
  return out;
}

// 48×48 grey from a BGR [0, 1] crop (OpenCV's BGR2GRAY weights, bilinear resize).
export function greyCrop(bgr, size = 224, to = 48) {
  const out = new Float32Array(to * to);
  const scale = size / to;
  const g = (x, y) => { const i = (Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))) * 3; return 0.114 * bgr[i] + 0.587 * bgr[i + 1] + 0.299 * bgr[i + 2]; };
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      const fx = (x + 0.5) * scale - 0.5, fy = (y + 0.5) * scale - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), wx = fx - x0, wy = fy - y0;
      out[y * to + x] = (g(x0, y0) * (1 - wx) + g(x0 + 1, y0) * wx) * (1 - wy) + (g(x0, y0 + 1) * (1 - wx) + g(x0 + 1, y0 + 1) * wx) * wy;
    }
  }
  return out;
}

// MiniFASNet's crop (Silent-Face-Anti-Spoofing's _get_new_box): the box grown
// by `scale` around its centre, kept inside the image, resized to 80×80, BGR
// 0–255, channels last.
export function spoofBox(w, h, [x, y, bw, bh], scale) {
  const sc = Math.min((h - 1) / bh, (w - 1) / bw, scale);
  const nw = bw * sc, nh = bh * sc, cx = x + bw / 2, cy = y + bh / 2;
  let l = cx - nw / 2, t = cy - nh / 2, r = cx + nw / 2, b = cy + nh / 2;
  if (l < 0) { r -= l; l = 0; }
  if (t < 0) { b -= t; t = 0; }
  if (r > w - 1) { l -= r - w + 1; r = w - 1; }
  if (b > h - 1) { t -= b - h + 1; b = h - 1; }
  return [Math.trunc(l), Math.trunc(t), Math.trunc(r), Math.trunc(b)];
}
export function spoofCrop(img, box, scale, size = 80) {
  const [l, t, r, b] = spoofBox(img.width, img.height, box, scale);
  const cw = r - l + 1, chh = b - t + 1;
  const out = new Float32Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = l + Math.min(cw - 1, Math.max(0, (x + 0.5) * (cw / size) - 0.5));
      const sy = t + Math.min(chh - 1, Math.max(0, (y + 0.5) * (chh / size) - 0.5));
      const o = (y * size + x) * 3;
      for (let ch = 0; ch < 3; ch++) out[o + (2 - ch)] = sample(img, sx, sy, ch);
    }
  }
  return out;
}

// ---------- predictions ----------
const top = (probs, labels) => {
  let best = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
  return { label: labels[best], score: +probs[best].toFixed(3), scores: Object.fromEntries(labels.map((l, i) => [l, +probs[i].toFixed(3)])) };
};

// Apparent age: the expected value over the model's 0–100 classes.
export const apparentAge = (probs) => probs.reduce((s, p, i) => s + p * i, 0);

export async function expression(crop) {
  const p = await run('emotion', greyCrop(crop), [1, 48, 48, 1]);
  return p && top(p, EMOTIONS);
}

export async function ageAndGender(crop) {
  const a = await run('age', crop, [1, 224, 224, 3]);
  const g = await run('gender', crop, [1, 224, 224, 3]);
  return { age: a ? Math.round(apparentAge(a)) : null, gender: g ? top(g, GENDERS) : null };
}

// Real face, or a photo/screen? Class 1 of the two models' summed output is
// "real", as in DeepFace and Silent-Face-Anti-Spoofing.
export async function liveness(img, box) {
  const a = await run('spoofA', spoofCrop(img, box, 2.7), [1, 80, 80, 3]);
  const b = await run('spoofB', spoofCrop(img, box, 4), [1, 80, 80, 3]);
  if (!a || !b) return null;
  const sum = a.map((v, i) => v + b[i]);
  const label = sum.indexOf(Math.max(...sum));
  return { real: label === 1, score: +(sum[label] / 2).toFixed(3) };
}

// Everything about the faces Scorpion already found in an image.
//   faces: [{ box, landmarks, ... }] from faces.analyzeImage / detectFaces.
export async function describeFaces(img, faces, { demography = true, live = true } = {}) {
  const out = [];
  for (const f of faces) {
    const extra = {};
    if (has('insights')) {
      const crop = faceCrop(img, f);
      extra.expression = await expression(crop);
      if (live) extra.liveness = await liveness(img, f.box);
      if (demography && has('demography')) Object.assign(extra, await ageAndGender(crop));
    } else if (demography && has('demography')) {
      Object.assign(extra, await ageAndGender(faceCrop(img, f)));
    }
    out.push({ ...f, ...extra });
  }
  return out;
}
