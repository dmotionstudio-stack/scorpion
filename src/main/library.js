// The media library: goes through the folders you choose and tags photos,
// videos and music, on this computer (inspired by Nextcloud Recognize; no
// code from it). For each file it works out:
//   photos: objects and scenes, landmarks, the people in them (face prints),
//           the country from GPS, when it was taken, and a CLIP vector for
//           search by words;
//   videos: human actions and scenes from a few frames;
//   music:  genres and other sounds.
// Everything is kept in library/index.json in Scorpion's data folder, with
// small thumbnails in library/thumbs. Your files are only read, never changed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { OBJECTS, LANDMARKS, NOT_LANDMARK, ACTIONS, NO_ACTION, GENRES, SOUNDS, CATEGORIES } from './labels.js';
import { embedImage, embedTexts, zeroShot, dot, classifyAudio, mediaModelStatus } from './media-models.js';
import * as faces from './faces.js';

export const KINDS = {
  photo: new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff', '.gif', '.avif']),
  video: new Set(['.mp4', '.m4v', '.webm', '.mov', '.mkv', '.ogv']),
  music: new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac', '.wav']),
};
export const FEATURES = {
  objects: 'Objects and scenes (animals, food, vehicles, buildings, landscapes…)',
  landmarks: 'Landmarks and monuments',
  faces: 'Faces (who is in each photo)',
  places: 'Places (country from the photo’s GPS)',
  video: 'Human actions in videos',
  music: 'Music genres',
};
const DEFAULT_FEATURES = Object.fromEntries(Object.keys(FEATURES).map((k) => [k, true]));
const MAX_FILES = 50000;
// A file with one of these names makes the library skip that folder and the
// folders inside it (the same markers Android and Nextcloud Recognize use).
export const MARKERS = { '.nomedia': ['photo', 'video', 'music'], '.noimage': ['photo'], '.novideo': ['video'], '.nomusic': ['music'] };
// Files bigger than this are skipped (MB). Low-CPU mode uses one thread.
const DEFAULT_LIMITS = { photoMB: 60, videoMB: 4096, musicMB: 400, lowCpu: false };

let dir = null;
let index = { folders: [], features: { ...DEFAULT_FEATURES }, limits: { ...DEFAULT_LIMITS }, share: 'off', items: {} };
let saveTimer = null;
let hooks = { decode: null, busy: () => false, onStatus: () => {}, onLowCpu: () => {} };
const state = { running: false, paused: false, current: null, done: 0, queued: 0, errors: 0, lastRun: null, watching: false };

export function initLibrary(dataDir, { decode, busy, onStatus, onLowCpu } = {}) {
  dir = path.join(dataDir, 'library');
  fs.mkdirSync(path.join(dir, 'thumbs'), { recursive: true });
  try { index = { ...index, ...JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) }; } catch { /* first run */ }
  index.features = { ...DEFAULT_FEATURES, ...index.features };
  index.limits = { ...DEFAULT_LIMITS, ...index.limits };
  hooks = { ...hooks, decode, busy: busy || hooks.busy, onStatus: onStatus || hooks.onStatus, onLowCpu: onLowCpu || hooks.onLowCpu };
  hooks.onLowCpu(index.limits.lowCpu);
}

// ---------- live updates: watch the folders ----------
const watchers = new Map();
const pendingPaths = new Set();
let flushTimer = null;

export function watchFolders(on = true) {
  for (const [f, w] of watchers) if (!on || !index.folders.includes(f)) { w.close(); watchers.delete(f); }
  if (on) {
    for (const f of index.folders) {
      if (watchers.has(f)) continue;
      try {
        const w = fs.watch(f, { recursive: true }, (_ev, name) => {
          if (!name) return;
          pendingPaths.add(path.join(f, String(name)));
          clearTimeout(flushTimer);
          flushTimer = setTimeout(flushChanges, 2500);
        });
        w.on('error', () => { w.close(); watchers.delete(f); });
        watchers.set(f, w);
      } catch { /* folder missing or not watchable: the next scan catches up */ }
    }
  }
  state.watching = watchers.size > 0;
}

// New, changed, renamed and deleted files, a few seconds after they happen.
async function flushChanges() {
  const paths = [...pendingPaths];
  pendingPaths.clear();
  if (!paths.length) return;
  // A marker added or removed, or a folder moved in: look at everything again.
  if (paths.some((p) => MARKERS[path.basename(p)] || (fs.existsSync(p) && fs.statSync(p).isDirectory()))) return scan();
  let changed = false;
  for (const p of paths) {
    if (!fs.existsSync(p)) {
      for (const key of Object.keys(index.items)) if (key === p || key.startsWith(p + path.sep)) { dropThumb(index.items[key]); delete index.items[key]; changed = true; }
      continue;
    }
    const kind = kindOf(p);
    if (!kind || skippedByMarker(p, kind)) continue;
    if (upsert(p)) changed = true;
  }
  if (changed) { save(); hooks.onStatus(libraryStatus()); }
  if (Object.values(index.items).some((i) => todo(i).some(ready))) scan({ quick: true }).catch(() => {});
}

function skippedByMarker(file, kind) {
  const root = index.folders.find((f) => file.startsWith(f + path.sep));
  for (let d = path.dirname(file); root && d.length >= root.length; d = path.dirname(d)) {
    for (const [m, kinds] of Object.entries(MARKERS)) if (kinds.includes(kind) && fs.existsSync(path.join(d, m))) return true;
    if (d === root) break;
  }
  return false;
}

// Adds or refreshes one file; true when it needs (re)tagging.
function upsert(file) {
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  const old = index.items[file];
  if (old && old.size === st.size && old.mtime === st.mtimeMs) return false;
  if (old) dropThumb(old);
  index.items[file] = { path: file, kind: kindOf(file), size: st.size, mtime: st.mtimeMs, done: {}, tags: [] };
  return true;
}

export function setLimits(patch) {
  for (const k of ['photoMB', 'videoMB', 'musicMB']) if (Number(patch[k]) > 0) index.limits[k] = Math.max(1, Math.round(Number(patch[k])));
  if ('lowCpu' in patch) { index.limits.lowCpu = Boolean(patch.lowCpu); hooks.onLowCpu(index.limits.lowCpu); }
  save(true);
}

function tooBig(item) {
  const mb = { photo: index.limits.photoMB, video: index.limits.videoMB, music: index.limits.musicMB }[item.kind];
  return item.size > mb * 1024 * 1024 ? `larger than ${mb} MB (Library → Settings → limits)` : null;
}

function save(now = false) {
  clearTimeout(saveTimer);
  const write = () => { if (dir) fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index)); };
  if (now) write(); else saveTimer = setTimeout(write, 3000);
}

const b64 = (arr) => Buffer.from(Float32Array.from(arr).buffer).toString('base64');
const unb64 = (s) => { const b = Buffer.from(s, 'base64'); return Array.from(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)); };
const kindOf = (file) => Object.keys(KINDS).find((k) => KINDS[k].has(path.extname(file).toLowerCase())) || null;
const thumbName = (file) => `${crypto.createHash('sha1').update(file).digest('hex').slice(0, 20)}.jpg`;
export const thumbPath = (name) => (dir && /^[0-9a-f]{20}\.jpg$/.test(name) ? path.join(dir, 'thumbs', name) : null);

// ---------- folders and settings ----------
export function libraryStatus() {
  const items = Object.values(index.items);
  const count = (k) => items.filter((i) => i.kind === k).length;
  // Per feature: files done and still waiting (like Recognize's admin page).
  const applies = { objects: (i) => i.kind !== 'music', landmarks: (i) => i.kind === 'photo', faces: (i) => i.kind === 'photo', places: (i) => i.kind === 'photo', video: (i) => i.kind === 'video', music: (i) => i.kind === 'music' };
  const isDone = { objects: (i) => (i.kind === 'video' ? i.done?.video : i.done?.clip), landmarks: (i) => i.done?.clip, faces: (i) => i.done?.faces, places: (i) => i.done?.places, video: (i) => i.done?.video, music: (i) => i.done?.music };
  const perFeature = {};
  for (const k of Object.keys(FEATURES)) {
    const rel = items.filter((i) => applies[k](i) && !tooBig(i));
    perFeature[k] = { done: rel.filter(isDone[k]).length, waiting: index.features[k] ? rel.filter((i) => !isDone[k](i)).length : 0 };
  }
  return {
    folders: index.folders,
    features: index.features,
    featureNames: FEATURES,
    perFeature,
    limits: index.limits,
    share: index.share,
    models: mediaModelStatus(),
    facesInstalled: faces.faceStatus().installed,
    people: faces.listPeople().map(({ id, name }) => ({ id, name })),
    counts: { photo: count('photo'), video: count('video'), music: count('music'), total: items.length, skipped: items.filter(tooBig).length, failed: items.filter((i) => i.error).length },
    scan: { ...state },
  };
}

export function addFolder(folder) {
  const f = path.resolve(folder);
  if (!index.folders.includes(f)) index.folders.push(f);
  save(true);
  if (state.watching) watchFolders(true);
}

export function removeFolder(folder) {
  index.folders = index.folders.filter((f) => f !== folder);
  for (const [p, item] of Object.entries(index.items)) {
    if (!index.folders.some((f) => p === f || p.startsWith(f + path.sep))) { dropThumb(item); delete index.items[p]; }
  }
  save(true);
  if (state.watching) watchFolders(true);
}

export function setFeatures(patch) {
  for (const k of Object.keys(FEATURES)) if (k in patch) index.features[k] = Boolean(patch[k]);
  save(true);
}

function dropThumb(item) {
  if (item.thumb) fs.rmSync(path.join(dir, 'thumbs', item.thumb), { force: true });
}

// Forget all tags (files are untouched); the next scan starts over.
export function clearLibrary() {
  for (const item of Object.values(index.items)) dropThumb(item);
  index.items = {};
  save(true);
}

// ---------- scanning ----------
function listFiles() {
  const out = [];
  const walk = (d, depth, skip) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    // Markers apply to this folder and everything inside it.
    const here = new Set(skip);
    for (const e of entries) for (const k of MARKERS[e.name] || []) here.add(k);
    if (here.size === 3) return;
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 12 && e.name !== 'node_modules') walk(full, depth + 1, here); } else {
        const kind = kindOf(full);
        if (kind && !here.has(kind)) out.push(full);
      }
    }
  };
  for (const f of index.folders) walk(f, 0, new Set());
  return out;
}

// Which enabled features still have to run for this file.
function todo(item) {
  const f = index.features;
  const need = [];
  if (tooBig(item)) return need;
  if (item.kind === 'photo') {
    if ((f.objects || f.landmarks) && !item.done?.clip) need.push('clip');
    if (f.faces && !item.done?.faces) need.push('faces');
    if (f.places && !item.done?.places) need.push('places');
  } else if (item.kind === 'video') {
    if ((f.video || f.objects) && !item.done?.video) need.push('video');
  } else if (item.kind === 'music' && f.music && !item.done?.music) need.push('music');
  return need;
}

function ready(step) {
  const m = mediaModelStatus();
  if (step === 'clip' || step === 'video') return m.clip.installed;
  if (step === 'music') return m.audio.installed;
  if (step === 'faces') return faces.faceStatus().installed;
  return true;
}

export function pauseScan(on) { state.paused = Boolean(on); hooks.onStatus(libraryStatus()); }

// Finds new and changed files, then works through them one at a time.
// quick: skip looking through the folders (the watcher already did).
export async function scan({ quick = false } = {}) {
  if (state.running) return libraryStatus();
  state.running = true;
  state.errors = 0;
  state.done = 0;
  try {
    if (!quick) {
      const files = listFiles();
      const seen = new Set(files);
      for (const p of Object.keys(index.items)) if (!seen.has(p)) { dropThumb(index.items[p]); delete index.items[p]; }
      for (const file of files) upsert(file);
    }
    const queue = Object.values(index.items).filter((i) => todo(i).some(ready));
    state.queued = queue.length;
    hooks.onStatus(libraryStatus());
    for (const item of queue) {
      while ((state.paused || hooks.busy()) && state.running) await new Promise((r) => setTimeout(r, 1500));
      if (!state.running) break;
      state.current = item.path;
      try { await processItem(item); } catch (err) { item.error = String(err.message || err).slice(0, 200); state.errors++; }
      state.done++;
      if (index.share !== 'off' && !item.error) await shareTags(item).catch((err) => { item.shareError = String(err.message || err).slice(0, 160); });
      save();
      hooks.onStatus(libraryStatus());
      // Low-CPU mode also leaves a pause between files.
      await new Promise((r) => (index.limits.lowCpu ? setTimeout(r, 400) : setImmediate(r)));
    }
  } finally {
    state.running = false;
    state.current = null;
    state.lastRun = Date.now();
    save(true);
    hooks.onStatus(libraryStatus());
  }
  return libraryStatus();
}

export function stopScan() { state.running = false; }

async function processItem(item) {
  delete item.error;
  const steps = todo(item).filter(ready);
  if (item.kind === 'photo') return processPhoto(item, steps);
  if (item.kind === 'video') return processVideo(item);
  return processMusic(item);
}

// ---------- photos ----------
let labelVectors = null;
async function labels() {
  if (!labelVectors) {
    const prompt = (t) => `a photo of ${t}`;
    labelVectors = {
      objects: await embedTexts(OBJECTS.map(([, l, p]) => prompt(p || `a ${l}`))),
      landmarks: await embedTexts([...LANDMARKS.map((l) => prompt(`the ${l}`)), ...NOT_LANDMARK.map(prompt)]),
      actions: await embedTexts([...ACTIONS.map((a) => `a photo of a person ${a}`), ...NO_ACTION.map(prompt)]),
    };
  }
  return labelVectors;
}

function setTags(item, source, tags) {
  item.tags = (item.tags || []).filter((t) => t.source !== source).concat(tags.map((t) => ({ ...t, source })));
}

async function tagFromVector(item, vector, { objects = true, landmarks = true } = {}) {
  const lv = await labels();
  if (objects) {
    const scores = zeroShot(vector, lv.objects).map((s, i) => ({ ...s, i })).sort((a, b) => b.p - a.p);
    // The best label needs less certainty than the extra ones.
    const picked = scores.filter((s, n) => n < 3 && s.cos >= 0.2 && (s.p >= 0.12 || (n === 0 && s.p >= 0.08 && s.cos >= 0.22)));
    setTags(item, 'objects', picked.map((s) => ({ cat: OBJECTS[s.i][0], label: OBJECTS[s.i][1], score: +s.p.toFixed(2) })));
  }
  if (landmarks) {
    const scores = zeroShot(vector, lv.landmarks);
    let best = 0;
    scores.forEach((s, i) => { if (s.p > scores[best].p) best = i; });
    const isLandmark = best < LANDMARKS.length && scores[best].p >= 0.45 && scores[best].cos >= 0.25;
    setTags(item, 'landmarks', isLandmark ? [{ cat: 'Landmarks', label: LANDMARKS[best], score: +scores[best].p.toFixed(2) }] : []);
  }
}

async function decodePhoto(file) {
  const sharp = (await import('sharp')).default;
  const img = sharp(file, { failOn: 'none' }).rotate();
  const { data, info } = await img.clone().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { img: { data, width: info.width, height: info.height, channels: info.channels }, meta: await sharp(file, { failOn: 'none' }).metadata() };
}

async function writeThumb(item, rgb) {
  const sharp = (await import('sharp')).default;
  const name = thumbName(item.path);
  await sharp(Buffer.from(rgb.data.buffer, rgb.data.byteOffset, rgb.data.byteLength), { raw: { width: rgb.width, height: rgb.height, channels: rgb.channels } })
    .resize({ width: 320, height: 320, fit: 'inside' }).jpeg({ quality: 72 }).toFile(path.join(dir, 'thumbs', name));
  item.thumb = name;
}

// GPS position and date from the photo's EXIF data.
export async function readExif(meta) {
  if (!meta?.exif) return {};
  const exifReader = (await import('exif-reader')).default;
  let e;
  try { e = exifReader(meta.exif); } catch { return {}; }
  const out = {};
  const taken = e.Photo?.DateTimeOriginal || e.Image?.DateTime;
  if (taken instanceof Date && !Number.isNaN(taken.getTime())) out.date = taken.getTime();
  const g = e.GPSInfo;
  const dms = (v) => (Array.isArray(v) ? v[0] + v[1] / 60 + v[2] / 3600 : Number(v));
  if (g?.GPSLatitude && g?.GPSLongitude) {
    const lat = dms(g.GPSLatitude) * (g.GPSLatitudeRef === 'S' ? -1 : 1);
    const lon = dms(g.GPSLongitude) * (g.GPSLongitudeRef === 'W' ? -1 : 1);
    if (Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon)) out.gps = [+lat.toFixed(5), +lon.toFixed(5)];
  }
  return out;
}

export async function countryAt([lat, lon]) {
  const cc = await import('@rapideditor/country-coder');
  const f = cc.feature([lon, lat], { level: 'territory' }) || cc.feature([lon, lat]);
  return f?.properties?.nameEn || null;
}

async function processPhoto(item, steps) {
  const { img, meta } = await decodePhoto(item.path);
  if (!item.thumb && !item.noThumb) await writeThumb(item, img);
  if (steps.includes('clip')) {
    const v = await embedImage(img);
    item.clip = b64(v);
    await tagFromVector(item, v, { objects: feats(item).objects, landmarks: feats(item).landmarks });
    item.done.clip = true;
  }
  if (steps.includes('faces')) {
    const found = await faces.analyzeImage(img);
    item.faces = found.filter((f) => f.quality.size >= 32).map((f) => ({ box: f.box, print: b64(f.print) }));
    item.size2 = [img.width, img.height];
    item.done.faces = true;
  }
  // Photos of people: a clear face makes it a portrait (or group photo), and
  // weak animal guesses on such photos are dropped (CLIP mixes them up).
  if (item.done.faces) {
    const big = (item.faces || []).filter((f) => Math.min(f.box[2], f.box[3]) >= 0.1 * Math.min(img.width, img.height));
    setTags(item, 'people', big.length >= 3 ? [{ cat: 'People', label: 'group photo', score: 1 }] : big.length ? [{ cat: 'People', label: 'portrait', score: 1 }] : []);
    if (big.length) item.tags = item.tags.filter((t) => !(t.source === 'objects' && t.cat === 'Animals' && t.score < 0.3) && !(t.source === 'objects' && t.cat === 'People'));
  }
  if (steps.includes('places')) {
    const ex = await readExif(meta);
    if (ex.date) item.date = ex.date;
    if (ex.gps) {
      item.gps = ex.gps;
      const country = await countryAt(ex.gps);
      setTags(item, 'places', country ? [{ cat: 'Places', label: country, score: 1 }] : []);
    }
    item.done.places = true;
  }
}

// ---------- videos (frames decoded by the window, see main.js) ----------
async function processVideo(item) {
  if (!hooks.decode) throw new Error('Videos need the Scorpion window open');
  const { frames, duration } = await hooks.decode('video', item.path);
  if (!frames?.length) throw new Error('No frames could be read from this video');
  item.duration = duration;
  if (!item.noThumb) await writeThumb(item, frames[Math.floor(frames.length / 2)]);
  const vectors = [];
  for (const f of frames) vectors.push(await embedImage(f));
  const mean = vectors[0].map((_, i) => vectors.reduce((s, v) => s + v[i], 0) / vectors.length);
  const n = Math.hypot(...mean) || 1;
  const v = mean.map((x) => x / n);
  item.clip = b64(v);
  if (feats(item).objects) await tagFromVector(item, v, { objects: true, landmarks: false });
  if (feats(item).video) {
    const lv = await labels();
    const scores = zeroShot(v, lv.actions);
    const ranked = scores.map((s, i) => ({ ...s, i })).sort((a, b) => b.p - a.p);
    const picked = ranked.filter((s, k) => k < 2 && s.i < ACTIONS.length && s.p >= 0.2);
    setTags(item, 'actions', picked.map((s) => ({ cat: 'Actions', label: ACTIONS[s.i], score: +s.p.toFixed(2) })));
  }
  item.done.video = true;
}

// ---------- music (decoded by the window to 16 kHz samples) ----------
async function processMusic(item) {
  if (!hooks.decode) throw new Error('Music needs the Scorpion window open');
  const { windows, duration } = await hooks.decode('music', item.path);
  if (!windows?.length) throw new Error('This audio file could not be decoded');
  item.duration = duration;
  const totals = new Map();
  for (const w of windows) for (const { label, score } of await classifyAudio(w)) totals.set(label, (totals.get(label) || 0) + score / windows.length);
  const pick = (names, min, max) => {
    const ranked = names.map((l) => ({ label: l, score: totals.get(l) || 0 })).sort((a, b) => b.score - a.score);
    const best = ranked[0]?.score || 0;
    return ranked.filter((x) => x.score >= min && x.score >= best * 0.5).slice(0, max);
  };
  const genres = pick(GENRES, 0.12, 3);
  const sounds = pick(SOUNDS, 0.25, 2);
  setTags(item, 'music', [...genres.map((g) => ({ cat: 'Genres', label: g.label.replace(/ music$/i, '').replace(/^Music of /, ''), score: +g.score.toFixed(2) })),
    ...sounds.map((s) => ({ cat: 'Sounds', label: s.label, score: +s.score.toFixed(2) }))]);
  item.done.music = true;
}

// ---------- people (from face prints, always matched against current People) ----------
// Who a stored face is: a hand-made correction wins (assigned to someone,
// "not this person", or hidden); otherwise the best match in People.
function whoIs(f, people) {
  if (f.ignored) return null;
  if (f.person) {
    const p = people.find((x) => x.id === f.person);
    if (p) return { id: p.id, name: p.name, similarity: 1, manual: true };
  }
  const allowed = f.not?.length ? people.filter((p) => !f.not.includes(p.id)) : people;
  return faces.identify(unb64(f.print), faces.SAME_PERSON, allowed);
}

function peopleIn(item, people) {
  const names = new Set();
  for (const f of item.faces || []) {
    const who = whoIs(f, people);
    if (who) names.add(who.name);
  }
  return [...names];
}

// Every face matched to one person, best matches first.
export function personFaces(personId) {
  const people = faces.peopleWithPrints();
  const out = [];
  for (const item of Object.values(index.items)) {
    (item.faces || []).forEach((f, n) => {
      const who = whoIs(f, people);
      if (who?.id === personId) out.push({ path: item.path, n, box: f.box, similarity: who.similarity, manual: Boolean(who.manual) });
    });
  }
  return out.sort((a, b) => a.similarity - b.similarity); // weakest first: those are the ones to check
}

// Faces nobody is known for (and not hidden).
export function unassignedFaces(limit = 120) {
  const people = faces.peopleWithPrints();
  const out = [];
  for (const item of Object.values(index.items)) {
    (item.faces || []).forEach((f, n) => { if (!f.ignored && !whoIs(f, people) && out.length < limit) out.push({ path: item.path, n, box: f.box }); });
  }
  return out;
}

// Corrections, like dragging a face in Memories:
//   remove: this face is not that person (it won't be matched to them again);
//   assign: this face is personId (its print is also learned by that person);
//   ignore / unignore: hide a face (a stranger, a poster, not a face).
export function setFace({ path: file, n, action, personId = null }) {
  const item = index.items[file];
  const f = item?.faces?.[n];
  if (!f) throw new Error('That face is no longer in the library; refresh and try again.');
  const people = faces.peopleWithPrints();
  if (action === 'remove') {
    const who = whoIs(f, people);
    if (who) f.not = [...new Set([...(f.not || []), who.id])];
    delete f.person;
  } else if (action === 'assign') {
    if (!people.some((p) => p.id === personId)) throw new Error('That person is not in People.');
    f.person = personId;
    f.not = (f.not || []).filter((id) => id !== personId);
    delete f.ignored;
    faces.addPrintsTo(personId, [unb64(f.print)]);
  } else if (action === 'ignore') f.ignored = true;
  else if (action === 'unignore') delete f.ignored;
  else throw new Error(`Unknown action ${action}`);
  save();
  return { ok: true };
}

// Merge two people: fromId's faces and samples join intoId.
export function mergePeople(fromId, intoId) {
  faces.mergePeople(fromId, intoId);
  for (const item of Object.values(index.items)) {
    for (const f of item.faces || []) {
      if (f.person === fromId) f.person = intoId;
      if (f.not?.includes(fromId)) f.not = [...new Set(f.not.map((id) => (id === fromId ? intoId : id)))];
    }
  }
  save(true);
  return { ok: true };
}

function allTags(item, people) {
  const tags = [...(item.tags || [])];
  for (const name of peopleIn(item, people)) tags.push({ cat: 'People', label: name, score: 1, source: 'faces' });
  return tags;
}

function view(item, people) {
  return {
    path: item.path, name: path.basename(item.path), kind: item.kind, thumb: item.thumb || null, date: item.date || item.mtime,
    duration: item.duration || null, gps: item.gps || null, error: item.error || null,
    faces: (item.faces || []).length, tags: allTags(item, people).map(({ cat, label, score }) => ({ cat, label, score })),
  };
}

// Every tag with how many files have it, grouped by category.
export function tagCloud() {
  const people = faces.peopleWithPrints();
  const counts = new Map();
  for (const item of Object.values(index.items)) {
    for (const t of new Set(allTags(item, people).map((x) => `${x.cat}\u0000${x.label}`))) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, []]));
  for (const [key, n] of counts) {
    const [cat, label] = key.split('\u0000');
    (out[cat] ||= []).push({ label, count: n });
  }
  for (const c of Object.keys(out)) out[c].sort((a, b) => b.count - a.count);
  return out;
}

// Search by tag ("dog", "Haiti", "Jazz", a person's name) and by meaning
// (CLIP: "kids playing on the beach at sunset").
export async function searchLibrary({ query = '', kind = null, tag = null, limit = 200 } = {}) {
  const people = faces.peopleWithPrints();
  let items = Object.values(index.items).filter((i) => !kind || i.kind === kind);
  if (tag) items = items.filter((i) => allTags(i, people).some((t) => t.cat === tag.cat && t.label === tag.label));
  const q = String(query || '').trim().toLowerCase();
  if (!q) return items.sort((a, b) => (b.date || b.mtime) - (a.date || a.mtime)).slice(0, limit).map((i) => view(i, people));
  const scored = new Map();
  for (const i of items) {
    const tags = allTags(i, people);
    const hit = tags.find((t) => t.label.toLowerCase() === q || t.cat.toLowerCase() === q) ? 2 : tags.some((t) => t.label.toLowerCase().includes(q)) ? 1.5 : path.basename(i.path).toLowerCase().includes(q) ? 1.2 : 0;
    if (hit) scored.set(i.path, hit);
  }
  if (mediaModelStatus().clip.installed) {
    // When the words name a tag exactly (a person, a place), only strong
    // look-alikes are added; otherwise search by meaning more freely.
    const exact = [...scored.values()].some((v) => v >= 2);
    const [qv] = await embedTexts([`a photo of ${q}`]);
    for (const i of items) {
      if (!i.clip) continue;
      const s = dot(qv, unb64(i.clip));
      if (s >= (exact ? 0.29 : 0.24)) scored.set(i.path, Math.max(scored.get(i.path) || 0, s * 4));
    }
  }
  return [...scored].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([p, score]) => ({ ...view(index.items[p], people), match: +score.toFixed(2) }));
}

export function itemInfo(file) {
  const item = index.items[path.resolve(file)];
  return item ? view(item, faces.peopleWithPrints()) : null;
}

// ---------- unknown faces → groups you can name ----------
export function faceClusters({ min = 2 } = {}) {
  const people = faces.peopleWithPrints();
  const clusters = [];
  for (const item of Object.values(index.items)) {
    (item.faces || []).forEach((f, n) => {
      if (f.ignored || whoIs(f, people)) return;
      const print = unb64(f.print);
      let best = null, bestSim = 0.42;
      // Two faces in one photo are never the same person.
      for (const c of clusters) { if (c.members.some((m) => m.path === item.path)) continue; const s = dot(c.centroid, print); if (s > bestSim) { best = c; bestSim = s; } }
      if (!best) { best = { centroid: print.slice(), members: [] }; clusters.push(best); }
      best.members.push({ path: item.path, n, box: f.box, print });
      const k = best.members.length;
      best.centroid = best.centroid.map((x, i) => (x * (k - 1) + print[i]) / k);
    });
  }
  return clusters.filter((c) => c.members.length >= min).sort((a, b) => b.members.length - a.members.length)
    .map((c) => ({ id: crypto.createHash('sha1').update(c.members.map((m) => m.path + m.n).sort().join('|')).digest('hex').slice(0, 16), count: c.members.length, photos: [...new Set(c.members.map((m) => m.path))].length, sample: c.members.slice(0, 4).map(({ path: p, box }) => ({ path: p, box })), members: c.members }));
}

// A small face picture for a cluster card.
export async function faceCrop(file, box) {
  const sharp = (await import('sharp')).default;
  const item = index.items[file];
  const meta = await sharp(file, { failOn: 'none' }).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).toBuffer({ resolveWithObject: true });
  const { width, height } = meta.info;
  const pad = 0.3;
  const x = Math.max(0, Math.round(box[0] - box[2] * pad)), y = Math.max(0, Math.round(box[1] - box[3] * pad));
  const w = Math.min(width - x, Math.round(box[2] * (1 + 2 * pad))), h = Math.min(height - y, Math.round(box[3] * (1 + 2 * pad)));
  const buf = await sharp(meta.data).extract({ left: x, top: y, width: Math.max(1, w), height: Math.max(1, h) }).resize(96, 96, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
  void item;
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

// Name a group of unknown faces: they become (or join) a person in People.
export async function nameCluster(clusterId, name) {
  const c = faceClusters({ min: 1 }).find((x) => x.id === clusterId);
  if (!c) throw new Error('That group of faces has changed; refresh and try again.');
  const thumb = await faceCrop(c.sample[0].path, c.sample[0].box).catch(() => null);
  return faces.addPrints(name, c.members.map((m) => m.print), thumb);
}

// On-demand tagging (tag_media) runs every feature, not just the enabled ones.
function feats(item) { return item.all ? DEFAULT_FEATURES : index.features; }

// ---------- reset one feature (like Recognize's reset commands) ----------
const RESET = { objects: ['clip', 'video'], landmarks: ['clip'], faces: ['faces'], places: ['places'], video: ['video'], music: ['music'] };
const TAG_SOURCES = { objects: ['objects'], landmarks: ['landmarks'], faces: ['people'], places: ['places'], video: ['actions'], music: ['music'] };
export function resetFeature(key) {
  if (!RESET[key]) throw new Error(`Unknown feature ${key}`);
  for (const item of Object.values(index.items)) {
    for (const d of RESET[key]) if (item.done) delete item.done[d];
    item.tags = (item.tags || []).filter((t) => !TAG_SOURCES[key].includes(t.source));
    if (key === 'faces') delete item.faces;
  }
  save(true);
  return libraryStatus();
}

// ---------- tag any file on request (not added to the library) ----------
export async function tagFile(file) {
  const kind = kindOf(file);
  if (!kind) throw new Error('Scorpion can tag photos (jpg, png, webp…), videos (mp4, mov, webm, mkv) and music (mp3, m4a, flac, ogg, wav).');
  const st = fs.statSync(file);
  const item = { path: file, kind, size: st.size, mtime: st.mtimeMs, done: {}, tags: [], noThumb: true, all: true };
  if (kind === 'photo') {
    const steps = ['clip', 'faces', 'places'].filter(ready);
    if (!steps.some((s) => s !== 'places')) throw new Error('Install the Library models first (Library → Settings).');
    await processPhoto(item, steps);
  } else if (kind === 'video') {
    if (!ready('video')) throw new Error('Install the Library models first (Library → Settings).');
    await processVideo(item);
  } else {
    if (!ready('music')) throw new Error('Install the music model first (Library → Settings).');
    await processMusic(item);
  }
  return view(item, faces.peopleWithPrints());
}

// ---------- share tags with other apps (XMP keywords) ----------
// off: nothing is written. sidecar: photo.jpg.xmp next to each photo or video
// (digiKam, darktable and others read these; the original is untouched).
// embed: JPEGs get the keywords inside (Windows Explorer and Photos show them
// as Tags) without re-encoding the picture; other files get a sidecar.
export const SHARE_MODES = ['off', 'sidecar', 'embed'];
const XMP_HEADER = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1');
const OURS = 'xmp:CreatorTool="Scorpion"';
const xmlEsc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

export function buildXmp(tags) {
  const flat = [...new Set(tags.map((t) => t.label))];
  const tree = [...new Set(tags.map((t) => `Scorpion|${t.cat}|${t.label}`))];
  const bag = (items) => items.map((x) => `<rdf:li>${xmlEsc(x)}</rdf:li>`).join('');
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Scorpion">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:lr="http://ns.adobe.com/lightroom/1.0/" xmlns:digiKam="http://www.digikam.org/ns/1.0/" xmlns:MicrosoftPhoto="http://ns.microsoft.com/photo/1.0/" ${OURS}>
   <dc:subject><rdf:Bag>${bag(flat)}</rdf:Bag></dc:subject>
   <lr:hierarchicalSubject><rdf:Bag>${bag(tree)}</rdf:Bag></lr:hierarchicalSubject>
   <digiKam:TagsList><rdf:Seq>${bag(tree.map((t) => t.replaceAll('|', '/')))}</rdf:Seq></digiKam:TagsList>
   <MicrosoftPhoto:LastKeywordXMP><rdf:Bag>${bag(flat)}</rdf:Bag></MicrosoftPhoto:LastKeywordXMP>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

// JPEG segments before the image data: [{ marker, start, end }].
function jpegSegments(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const segs = [];
  let off = 2;
  while (off + 4 <= buf.length && buf[off] === 0xff) {
    const marker = buf[off + 1];
    if (marker === 0xda || marker === 0xd9) break; // the image data starts here
    const len = buf.readUInt16BE(off + 2);
    segs.push({ marker, start: off, end: off + 2 + len });
    off += 2 + len;
  }
  return segs;
}
const isXmp = (buf, s) => s.marker === 0xe1 && buf.subarray(s.start + 4, s.start + 4 + XMP_HEADER.length).equals(XMP_HEADER);

// Writes (or, with xmp null, removes) Scorpion's XMP packet inside a JPEG,
// leaving the picture bytes alone. Returns false when another app's XMP is
// already there (a sidecar is used instead) or the file isn't a JPEG.
export function embedXmp(file, xmp) {
  const buf = fs.readFileSync(file);
  const segs = jpegSegments(buf);
  if (!segs) return false;
  const existing = segs.find((s) => isXmp(buf, s));
  if (existing && !buf.subarray(existing.start, existing.end).toString('utf8').includes(OURS)) return false;
  if (!xmp && !existing) return false; // nothing of ours to remove
  const headers = segs.filter((s) => s !== existing);
  const lastApp = headers.filter((s) => s.marker >= 0xe0 && s.marker <= 0xef).at(-1);
  const insertAt = lastApp ? lastApp.end : 2;
  let packet = Buffer.alloc(0);
  if (xmp) {
    const body = Buffer.concat([XMP_HEADER, Buffer.from(xmp, 'utf8')]);
    if (body.length + 2 > 0xffff) return false;
    const head = Buffer.from([0xff, 0xe1, 0, 0]);
    head.writeUInt16BE(body.length + 2, 2);
    packet = Buffer.concat([head, body]);
  }
  // Rebuild: the bytes before the insert point and after it, minus our old packet.
  const keep = (a, b) => {
    if (!existing || existing.end <= a || existing.start >= b) return [buf.subarray(a, b)];
    return [buf.subarray(a, Math.max(a, existing.start)), buf.subarray(Math.min(b, existing.end), b)];
  };
  const out = Buffer.concat([...keep(0, insertAt), packet, ...keep(insertAt, buf.length)]);
  const st = fs.statSync(file);
  const tmp = `${file}.scorpion-tmp`;
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, file);
  fs.utimesSync(file, st.atime, st.mtime); // keep the photo's date
  return true;
}

function sidecarOf(file) { return `${file}.xmp`; }
function removeOurSidecar(file) {
  const side = sidecarOf(file);
  if (!fs.existsSync(side) || !fs.readFileSync(side, 'utf8').includes(OURS)) return false;
  fs.rmSync(side);
  return true;
}

async function shareTags(item) {
  if (item.kind === 'music' || index.share === 'off') return;
  const tags = allTags(item, faces.peopleWithPrints()).filter((t) => t.label);
  const xmp = buildXmp(tags);
  const hash = crypto.createHash('sha1').update(xmp).digest('hex').slice(0, 16);
  if (item.sharedHash === hash && item.shared && (item.shared === index.share || index.share === 'embed')) return;
  if (index.share === 'embed' && item.kind === 'photo' && /\.jpe?g$/i.test(item.path) && embedXmp(item.path, xmp)) {
    const st = fs.statSync(item.path);
    item.size = st.size; // our own write: not a change to re-tag
    item.mtime = st.mtimeMs;
    item.shared = 'embed';
    removeOurSidecar(item.path); // left over from sidecar mode
  } else {
    const side = sidecarOf(item.path);
    if (fs.existsSync(side) && !fs.readFileSync(side, 'utf8').includes(OURS)) { item.shareError = 'another app’s .xmp file is already there'; return; }
    fs.writeFileSync(side, xmp);
    item.shared = 'sidecar';
  }
  item.sharedHash = hash;
  delete item.shareError;
}

export function setShareMode(mode) {
  if (!SHARE_MODES.includes(mode)) throw new Error(`Unknown mode ${mode}`);
  index.share = mode;
  save(true);
  return libraryStatus();
}

// Writes the current tags for every file (after naming or fixing people, say).
export async function shareAll() {
  let n = 0;
  for (const item of Object.values(index.items)) {
    if (!item.done || item.error) continue;
    delete item.sharedHash;
    try { await shareTags(item); if (item.sharedHash) n++; } catch (err) { item.shareError = String(err.message || err).slice(0, 160); }
  }
  save(true);
  return n;
}

// Takes back everything Scorpion wrote: its sidecars and its embedded packets.
export function unshareAll() {
  let n = 0;
  for (const item of Object.values(index.items)) {
    try {
      // Both kinds, whatever the current mode: switching modes can leave either behind.
      let removed = item.kind !== 'music' && removeOurSidecar(item.path);
      if (item.kind === 'photo' && /\.jpe?g$/i.test(item.path) && embedXmp(item.path, null)) {
        const st = fs.statSync(item.path);
        item.size = st.size;
        item.mtime = st.mtimeMs;
        removed = true;
      }
      if (removed) n++;
    } catch { /* file gone or in use */ }
    delete item.shared;
    delete item.sharedHash;
  }
  index.share = 'off';
  save(true);
  return n;
}
