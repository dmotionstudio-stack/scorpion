import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERF_LEVELS, perfNote, constellationOptions } from '../src/renderer/settings-look.js';

test('Settings → General: performance and constellation values', () => {
  assert.deepEqual(PERF_LEVELS, ['full', 'balanced', 'light']);
  assert.equal(perfNote('full', 'light'), 'Now: Light (on battery)');
  assert.equal(perfNote('light', 'light'), '');
  assert.equal(perfNote('full', undefined), '');
  assert.deepEqual(constellationOptions({}), { recommend: true, motion: true, large: false, contrast: false });
  assert.deepEqual(constellationOptions({ constellation: { motion: false } }), { recommend: true, motion: false, large: false, contrast: false });
});
