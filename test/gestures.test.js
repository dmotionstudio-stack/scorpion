import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGestures, stepGestures, cameraError, PINCH_ON, PINCH_OFF } from '../src/renderer/gestures.js';
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
  assert.equal(stepGestures(g, [hand(0.5, 0.5, 0.1)], ['Right']).rotate, null); // first frame sets the reference
  const r = stepGestures(g, [hand(0.4, 0.5, 0.1)], ['Right']).rotate; // camera x down = your hand moved right
  assert.ok(r[0] > 0 && Math.abs(r[1]) < 1e-9);
  assert.equal(stepGestures(g, [], []).mode, 'idle'); // hand gone
});

test('spreading two pinched hands zooms in, closing them zooms out', () => {
  const g = createGestures();
  const two = (spread) => stepGestures(g, [hand(0.5 - spread, 0.5, 0.1), hand(0.5 + spread, 0.5, 0.1)], ['Left', 'Right']);
  assert.equal(two(0.1).mode, 'zoom');
  assert.ok(two(0.2).zoom < 1);
  assert.ok(two(0.1).zoom > 1);
  // Two hands both labelled "Right" still count as two.
  const h = createGestures();
  stepGestures(h, [hand(0.3, 0.5, 0.1), hand(0.7, 0.5, 0.1)], ['Right', 'Right']);
  assert.equal(stepGestures(h, [hand(0.3, 0.5, 0.1), hand(0.7, 0.5, 0.1)], ['Right', 'Right']).mode, 'zoom');
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
