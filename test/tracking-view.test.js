import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSwitch } from '../src/renderer/orb-commands.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../src/main/store.js';

test('hand gestures and face tracking can run without showing the camera view', () => {
  // Shown unless the person turns it off.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-tracking-'));
  try { store.initStore(dir); assert.equal(store.getSettings().trackingShown, true); store.updateSettings({ trackingShown: false }); assert.equal(store.getSettings().trackingShown, false); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const sw = (t) => parseSwitch(t);
  assert.deepEqual(sw('hide the camera view'), { key: 'camview', on: false });
  assert.deepEqual(sw('turn off the camera view'), { key: 'camview', on: false });
  assert.deepEqual(sw('hide the tracking preview'), { key: 'camview', on: false });
  assert.deepEqual(sw('hide the face tracking view please'), { key: 'camview', on: false });
  assert.deepEqual(sw('show the camera view'), { key: 'camview', on: true });
  assert.deepEqual(sw('show me the hand tracking view'), { key: 'camview', on: true });
  // The tracking itself is still switched by its own words, and "show" is for the view only.
  assert.deepEqual(sw('turn off hand gestures'), { key: 'gestures', on: false });
  assert.deepEqual(sw('turn on face tracking'), { key: 'face', on: true });
  for (const no of ['show me the orb', 'show the face', 'show the humanoid']) assert.equal(sw(no), null, no);
});
