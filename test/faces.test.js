import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { similarity, cosine, identify, faceQuality, initFaces, faceStatus, SAME_PERSON } from '../src/main/faces.js';
import * as lock from '../src/main/lock.js';
import { FaceTracker } from '../src/renderer/facecam.js';

test('alignment: the similarity transform maps landmarks onto the template', () => {
  const dst = [[38.3, 51.7], [73.5, 51.5], [56.0, 71.7], [41.5, 92.4], [70.7, 92.2]];
  // The same face, twice as big, rotated 10° and moved.
  const ang = (10 * Math.PI) / 180;
  const src = dst.map(([x, y]) => [2 * (x * Math.cos(ang) - y * Math.sin(ang)) + 40, 2 * (x * Math.sin(ang) + y * Math.cos(ang)) + 15]);
  const { a, b, tx, ty } = similarity(src, dst);
  for (let i = 0; i < 5; i++) {
    const [x, y] = src[i];
    assert.ok(Math.abs(a * x - b * y + tx - dst[i][0]) < 1e-6);
    assert.ok(Math.abs(b * x + a * y + ty - dst[i][1]) < 1e-6);
  }
});

test('identify picks the best enrolled match above the threshold', () => {
  const unit = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
  const people = [
    { id: 'a', name: 'Ana', owner: true, prints: [unit([1, 0, 0, 0])] },
    { id: 'b', name: 'Ben', prints: [unit([0, 1, 0, 0]), unit([0, 1, 0.2, 0])] },
  ];
  assert.equal(identify(unit([0.9, 0.1, 0, 0]), SAME_PERSON, people).name, 'Ana');
  assert.equal(identify(unit([0.05, 1, 0.15, 0]), SAME_PERSON, people).name, 'Ben');
  assert.equal(identify(unit([0, 0, 0, 1]), SAME_PERSON, people), null);
  assert.ok(Math.abs(cosine(unit([1, 1, 0, 0]), unit([1, 0, 0, 0])) - Math.SQRT1_2) < 1e-9);
});

test('quality flags small, dark, blurry and turned faces', () => {
  const flat = new Float32Array(3 * 112 * 112).fill(20); // dark and featureless
  const face = { box: [0, 0, 30, 30], landmarks: [[10, 10], [20, 18], [25, 14], [12, 25], [20, 25]] };
  const q = faceQuality(face, flat);
  assert.equal(q.ok, false);
  for (const issue of ['too small', 'too dark', 'blurry', 'not facing the camera']) assert.ok(q.issues.includes(issue), issue);
});

test('face recognition counts as installed only with both models and the marker', () => {
  const models = fs.mkdtempSync(path.join(os.tmpdir(), 'faces-m-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'faces-d-'));
  initFaces(models, data);
  assert.equal(faceStatus().installed, false);
  assert.deepEqual(faceStatus().people, []);
});

test('the tracker keeps ids and names steady between frames', () => {
  const t = new FaceTracker();
  let tracks = t.update([{ box: [100, 100, 50, 50], person: { id: 'a', name: 'Ana' } }], 0);
  const id = tracks[0].id;
  tracks = t.update([{ box: [104, 102, 50, 50], person: null }], 200); // a blink: not recognized this frame
  assert.equal(tracks[0].id, id);
  assert.equal(tracks[0].person.name, 'Ana');
  tracks = t.update([{ box: [104, 102, 50, 50], person: null }], 4000); // gone a while: forget the name
  assert.equal(tracks[0].person, null);
  tracks = t.update([], 6000);
  assert.equal(tracks.length, 0);
});

test('face lock: PIN rules, hashing and the locked state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'));
  lock.initLock(dir);
  assert.deepEqual(lock.lockStatus(), { enabled: false, hasPin: false, locked: false });
  assert.throws(() => lock.setEnabled(true), /PIN first/);
  assert.throws(() => lock.setPin('12'), /4 to 8 digits/);
  lock.setPin('4821');
  assert.ok(!fs.readFileSync(path.join(dir, 'lock.json'), 'utf8').includes('4821'));
  assert.equal(lock.checkPin('4821'), true);
  assert.equal(lock.checkPin('0000'), false);
  lock.setEnabled(true);
  assert.equal(lock.lockNow(), true);
  assert.equal(lock.isLocked(), true);
  lock.unlock();
  assert.equal(lock.isLocked(), false);
  lock.initLock(dir); // a new start of Scorpion opens locked
  assert.equal(lock.isLocked(), true);
});

test('face insights (DeepFace port): crops and maths match DeepFace', async () => {
  const fi = await import('../src/main/face-insights.js');
  // Silent-Face-Anti-Spoofing's _get_new_box, worked by hand for a 640×480 frame.
  assert.deepEqual(fi.spoofBox(640, 480, [300, 200, 100, 100], 2.7), [215, 115, 485, 385]);
  assert.deepEqual(fi.spoofBox(640, 480, [10, 10, 100, 100], 4), [0, 0, 400, 400]); // pushed inside the frame
  assert.deepEqual(fi.spoofBox(640, 480, [500, 380, 100, 100], 4), [239, 79, 639, 479]); // capped by height: scale 4.79 → 4
  // Apparent age: expected value of the 101 age classes.
  const probs = new Array(101).fill(0); probs[20] = 0.5; probs[40] = 0.5;
  assert.equal(fi.apparentAge(probs), 30);
  // A flat red image: the crop is BGR in [0, 1] inside the box, black in the letterbox.
  const w = 200, h = 100, data = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { data[i * 3] = 255; data[i * 3 + 1] = 0; data[i * 3 + 2] = 0; }
  const img = { data, width: w, height: h, channels: 3 };
  const crop = fi.faceCrop(img, { box: [50, 25, 100, 50], landmarks: [[80, 40], [120, 40]] }, 224);
  const px = (x, y) => Array.from(crop.slice((y * 224 + x) * 3, (y * 224 + x) * 3 + 3)).map((v) => +v.toFixed(2));
  assert.deepEqual(px(112, 112), [0, 0, 1]); // red is the last channel in BGR
  assert.deepEqual(px(112, 5), [0, 0, 0]); // letterbox bar (box is 2:1)
  // Tilted eyes: the crop turns the face so the eyes are level (a 45° box corner samples outside the bar).
  const tilted = fi.faceCrop(img, { box: [50, 25, 100, 50], landmarks: [[80, 40], [120, 80]] }, 224);
  assert.ok(tilted.some((v, i) => i % 3 === 2 && v === 0 && Math.floor(i / 3 / 224) > 60 && Math.floor(i / 3 / 224) < 160));
  // Grey 48×48 from the crop: red → 0.299 with OpenCV's weights.
  const grey = fi.greyCrop(crop);
  assert.equal(grey.length, 48 * 48);
  assert.ok(Math.abs(grey[24 * 48 + 24] - 0.299) < 1e-3);
  // Spoof crop is 80×80 BGR in 0–255.
  const sc = fi.spoofCrop(img, [50, 25, 100, 50], 2.7);
  assert.equal(sc.length, 80 * 80 * 3);
  assert.equal(Math.round(sc[40 * 80 * 3 + 40 * 3 + 2]), 255);
  // Without the models, faces pass through unchanged.
  const os = await import('node:os');
  fi.initFaceInsights(os.tmpdir() + '/no-insights-here');
  assert.deepEqual(await fi.describeFaces(img, [{ box: [1, 2, 3, 4] }]), [{ box: [1, 2, 3, 4] }]);
  assert.equal(fi.insightsStatus().insights.installed, false);
  assert.ok(fi.PACKS.demography.bytes > 1e9 && fi.PACKS.insights.bytes < 1e7);
});
