import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGestures, stepGestures, handPose, cameraError, PINCH_ON, PINCH_OFF } from '../src/renderer/gestures.js';
import { initGestures, gesturesStatus, looksLikeModel, markLoaded } from '../src/main/gestures.js';

// A hand 0.2 tall with thumb and index tips `gap` hand-sizes apart around (x, y).
function hand(x, y, gap) {
  const lm = Array.from({ length: 21 }, () => ({ x, y }));
  lm[0] = { x, y: y + 0.2 }; // wrist
  lm[9] = { x, y }; // middle finger base
  lm[4] = { x: x - gap * 0.1, y }; // thumb tip
  lm[8] = { x: x + gap * 0.1, y }; // index tip
  return lm;
}

test('a pinch switches on below PINCH_ON and off only above PINCH_OFF', () => {
  const g = createGestures();
  assert.equal(stepGestures(g, [hand(0.5, 0.5, 0.4)], ['Right']).mode, 'idle');
  assert.equal(stepGestures(g, [hand(0.5, 0.5, PINCH_ON - 0.02)], ['Right']).mode, 'spin');
  assert.equal(stepGestures(g, [hand(0.5, 0.5, 0.4)], ['Right']).mode, 'spin'); // between the two: still pinched
  assert.equal(stepGestures(g, [hand(0.5, 0.5, PINCH_OFF + 0.02)], ['Right']).mode, 'idle');
});

test('moving a pinched hand spins the orb, mirrored like the preview', () => {
  const g = createGestures();
  assert.equal(stepGestures(g, [hand(0.5, 0.5, 0.1)], ['Right'], 0).rotate, null); // first frame sets the reference
  assert.equal(stepGestures(g, [hand(0.45, 0.5, 0.1)], ['Right'], 100).rotate, null); // too soon: could still be a tap
  const r = stepGestures(g, [hand(0.4, 0.5, 0.1)], ['Right'], 250).rotate; // camera x down = your hand moved right
  assert.ok(r[0] > 0 && Math.abs(r[1]) < 1e-9);
  assert.equal(stepGestures(g, [], [], 300).mode, 'idle'); // hand gone
});

// A realistic hand (MediaPipe's 21 points) centred on its middle knuckle at
// (x, y): s scales it (bigger looks closer), `up` lists the stretched fingers,
// thumb is 'in' | 'out' | 'up' | 'down', and gap (hand sizes) puts the thumb
// tip that far from the index tip (or the middle tip, with toMiddle).
function shape(x, y, { s = 1, up = [], thumb = 'in', gap = null, toMiddle = false } = {}) {
  // Thumbs down is a thumbs-up turned upside down.
  if (thumb === 'down') return shape(x, y, { s, up, thumb: 'up' }).map((q) => ({ x: 2 * x - q.x, y: 2 * y - q.y }));
  const k = 0.2 * s; // wrist to middle knuckle
  const p = (dx, dy) => ({ x: x + dx * k, y: y + dy * k });
  const lm = Array.from({ length: 21 }, () => p(0, 0));
  lm[0] = p(0, 1);
  const knuckles = { index: [5, -0.3, 0], middle: [9, 0, 0], ring: [13, 0.25, 0.05], pinky: [17, 0.45, 0.15] };
  for (const [name, [mcp, dx, dy]] of Object.entries(knuckles)) {
    lm[mcp] = p(dx, dy);
    const on = up.includes(name);
    lm[mcp + 1] = p(dx, dy - 0.35); // middle joint
    lm[mcp + 2] = p(dx, on ? dy - 0.65 : dy - 0.3);
    lm[mcp + 3] = on ? p(dx, dy - 0.9) : p(dx, dy + 0.15); // tip: up, or curled back in
  }
  lm[1] = p(-0.35, 0.75); lm[2] = p(-0.45, 0.55); lm[3] = p(-0.55, 0.4);
  lm[4] = { in: p(-0.15, 0.25), out: p(-1, 0.1), up: p(-0.3, -1.1) }[thumb];
  if (gap != null) {
    const target = lm[toMiddle ? 12 : 8];
    lm[4] = { x: target.x - gap * k, y: target.y };
  }
  return lm;
}
const step = (g, lm, t) => stepGestures(g, lm ? [lm] : [], lm ? ['Right'] : [], t);

test('hand poses: point, two fingers, open, fist, thumbs', () => {
  assert.equal(handPose(shape(0.5, 0.5, { up: ['index'] })).pose, 'point');
  assert.equal(handPose(shape(0.5, 0.5, { up: ['index', 'middle'] })).pose, 'two');
  assert.equal(handPose(shape(0.5, 0.5, { up: ['index', 'middle', 'ring', 'pinky'], thumb: 'out' })).pose, 'open');
  assert.equal(handPose(shape(0.5, 0.5)).pose, 'fist');
  assert.equal(handPose(shape(0.5, 0.5, { thumb: 'up' })).pose, 'thumbUp');
  assert.equal(handPose(shape(0.5, 0.5, { thumb: 'down' })).pose, 'thumbDown');
});

const OPEN = { up: ['index', 'middle', 'ring', 'pinky'], thumb: 'out' };

test('pointing moves the pointer; a quick pinch taps, a quick middle pinch right-clicks', () => {
  const g = createGestures();
  const first = step(g, shape(0.3, 0.4, { up: ['index'], thumb: 'out' }), 0);
  assert.ok(first.pointer && Math.abs(first.pointer.x - (1 - (0.3 - 0.06))) < 0.01, 'mirrored fingertip');
  assert.equal(step(g, shape(0.3, 0.4, OPEN), 30).pointer, null, 'an open hand does not move the pointer');
  for (let t = 60; t <= 300; t += 30) step(g, shape(0.3, 0.4, { up: ['index'], thumb: 'out' }), t);
  assert.equal(step(g, shape(0.3, 0.4, { up: ['index'], gap: 0.1 }), 330).pointer, null, 'still while pinched');
  const tap = step(g, shape(0.3, 0.4, { up: ['index'], thumb: 'out' }), 450).tap;
  assert.ok(tap && Math.abs(tap.x - 0.76) < 0.02);
  step(g, shape(0.3, 0.4, { up: ['index'], gap: 0.1, toMiddle: true }), 600); // middle bent to the thumb, index up
  assert.ok(step(g, shape(0.3, 0.4, { up: ['index'], thumb: 'out' }), 700).rightTap, 'thumb + middle: right-click');
});

test('a held pinch drags: start, move, end (and no tap)', () => {
  const g = createGestures();
  step(g, shape(0.5, 0.5, { up: ['index'], thumb: 'out' }), 0);
  step(g, shape(0.5, 0.5, { up: ['index'], gap: 0.1 }), 50);
  assert.equal(step(g, shape(0.5, 0.5, { up: ['index'], gap: 0.1 }), 120).drag, null, 'not yet');
  const start = step(g, shape(0.3, 0.5, { up: ['index'], gap: 0.1 }), 250).drag;
  assert.equal(start?.phase, 'start');
  const move = step(g, shape(0.2, 0.5, { up: ['index'], gap: 0.1 }), 300).drag;
  assert.equal(move.phase, 'move');
  assert.ok(move.x > start.x, 'follows the hand (mirrored)');
  const end = step(g, shape(0.2, 0.5, { up: ['index'], thumb: 'out' }), 350);
  assert.equal(end.drag.phase, 'end');
  assert.equal(end.tap, null);
});

test('bunched fingers opening wide is a "zoom in" on the pointed spot', () => {
  const g = createGestures();
  step(g, shape(0.5, 0.5, { up: ['index'] }), 0);
  step(g, shape(0.5, 0.5), 100); // fist
  const r = step(g, shape(0.5, 0.5, OPEN), 300);
  assert.ok(r.bloom, 'bloom');
  // Slow: not a bloom.
  const s = createGestures();
  step(s, shape(0.5, 0.5), 0);
  assert.equal(step(s, shape(0.5, 0.5, OPEN), 900).bloom, null);
});

test('two fingers up scroll; thumbs held answer yes or no', () => {
  const g = createGestures();
  step(g, shape(0.5, 0.6, { up: ['index', 'middle'] }), 0);
  assert.ok(step(g, shape(0.5, 0.5, { up: ['index', 'middle'] }), 50).scroll > 0, 'hand up: scroll up');
  assert.ok(step(g, shape(0.5, 0.6, { up: ['index', 'middle'] }), 100).scroll < 0);
  const t = createGestures();
  step(t, shape(0.5, 0.5, { thumb: 'up' }), 0);
  assert.equal(step(t, shape(0.5, 0.5, { thumb: 'up' }), 300).thumb, null, 'held too briefly');
  assert.equal(step(t, shape(0.5, 0.5, { thumb: 'up' }), 700).thumb, 'up');
  assert.equal(step(t, shape(0.5, 0.5, { thumb: 'up' }), 900).thumb, null, 'once per hold');
  step(t, shape(0.5, 0.5, { thumb: 'down' }), 1000);
  assert.equal(step(t, shape(0.5, 0.5, { thumb: 'down' }), 1700).thumb, 'down');
});

test('open-hand sweeps: left/right, up (home), down; push goes back', () => {
  const g = createGestures();
  step(g, shape(0.7, 0.5, OPEN), 0);
  step(g, shape(0.55, 0.5, OPEN), 100);
  assert.equal(step(g, shape(0.35, 0.5, OPEN), 200).swipe, 'right', 'camera x down = your right');
  assert.equal(step(g, shape(0.7, 0.5, OPEN), 300).swipe, null, 'cooldown');
  const u = createGestures();
  step(u, shape(0.5, 0.7, OPEN), 0);
  assert.equal(step(u, shape(0.5, 0.4, OPEN), 200).swipe, 'up');
  const d = createGestures();
  step(d, shape(0.5, 0.3, OPEN), 0);
  assert.equal(step(d, shape(0.5, 0.6, OPEN), 200).swipe, 'down');
  // A pointing hand moving fast is just pointing.
  const pt = createGestures();
  step(pt, shape(0.7, 0.5, { up: ['index'] }), 0);
  assert.equal(step(pt, shape(0.3, 0.5, { up: ['index'] }), 200).swipe, null);
  // Slow: no sweep.
  const s = createGestures();
  step(s, shape(0.3, 0.5, OPEN), 0);
  step(s, shape(0.45, 0.5, OPEN), 300);
  assert.equal(step(s, shape(0.6, 0.5, OPEN), 600).swipe, null);
  const p = createGestures();
  step(p, shape(0.5, 0.5, { ...OPEN, s: 1 }), 0);
  step(p, shape(0.5, 0.5, { ...OPEN, s: 1.2 }), 150);
  assert.equal(step(p, shape(0.5, 0.5, { ...OPEN, s: 1.6 }), 300).push, true);
});

test('camera errors say what to do', () => {
  assert.match(cameraError({ name: 'NotFoundError' }), /NO CAMERA FOUND/);
  assert.match(cameraError({ name: 'NotAllowedError' }), /DENIED/);
  assert.match(cameraError({ name: 'NotReadableError' }), /BUSY/);
});

test('the hand model counts as installed only after it loaded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-gestures-'));
  try {
    initGestures(dir);
    assert.deepEqual([gesturesStatus().downloaded, gesturesStatus().installed], [false, false]);
    const file = path.join(dir, 'gestures', 'hand_landmarker.task');
    fs.mkdirSync(path.dirname(file));
    const zip = Buffer.concat([Buffer.from('\0\0PK\x03\x04', 'latin1'), Buffer.alloc(2 * 1024 ** 2), Buffer.from('PK\x05\x06', 'latin1'), Buffer.alloc(18)]);
    fs.writeFileSync(file, zip.subarray(0, zip.length - 100)); // cut off
    assert.equal(looksLikeModel(file), false);
    fs.writeFileSync(file, zip);
    assert.ok(looksLikeModel(file));
    assert.deepEqual([gesturesStatus().downloaded, gesturesStatus().installed], [true, false]);
    assert.equal(markLoaded().installed, true);
    fs.writeFileSync(file, '<html>error page</html>');
    assert.equal(looksLikeModel(file), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the MediaPipe files main.js serves are installed', () => {
  const main = fs.readFileSync(path.join('src', 'main', 'main.js'), 'utf8');
  const files = JSON.parse(/MEDIAPIPE_FILES = new Set\((\[[^\]]+\])\)/.exec(main)[1].replace(/'/g, '"'));
  for (const f of files) assert.ok(fs.existsSync(path.join('node_modules', '@mediapipe', 'tasks-vision', f)), `${f} missing`);
});

test('more signs: three fingers, thumb + little finger, a still palm, a held fist', () => {
  assert.equal(handPose(shape(0.5, 0.5, { up: ['index', 'middle', 'ring'] })).pose, 'three');
  assert.equal(handPose(shape(0.5, 0.5, { up: ['pinky'], thumb: 'out' })).pose, 'shaka');
  const g = createGestures();
  step(g, shape(0.5, 0.5, { up: ['index', 'middle', 'ring'] }), 0);
  assert.equal(step(g, shape(0.5, 0.5, { up: ['index', 'middle', 'ring'] }), 200).sign, null, 'held too briefly');
  assert.equal(step(g, shape(0.5, 0.5, { up: ['index', 'middle', 'ring'] }), 450).sign, 'three');
  assert.equal(step(g, shape(0.5, 0.5, { up: ['index', 'middle', 'ring'] }), 600).sign, null, 'once per hold');
  step(g, shape(0.5, 0.5, { up: ['pinky'], thumb: 'out' }), 700);
  assert.equal(step(g, shape(0.5, 0.5, { up: ['pinky'], thumb: 'out' }), 1150).sign, 'shaka');
  // An open palm held still for a second.
  const p = createGestures();
  step(p, shape(0.5, 0.5, OPEN), 0);
  assert.equal(step(p, shape(0.505, 0.5, OPEN), 500).hold, null);
  assert.equal(step(p, shape(0.505, 0.5, OPEN), 1050).hold, 'palm');
  // A fist held 1.5 s pauses; opening it afterwards is not a bloom.
  const f = createGestures();
  step(f, shape(0.5, 0.5), 0);
  assert.equal(step(f, shape(0.5, 0.5), 1600).hold, 'fist');
  assert.equal(step(f, shape(0.5, 0.5, OPEN), 1700).bloom, null);
});
