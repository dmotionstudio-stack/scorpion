import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERF_LEVELS, perfNote } from '../src/renderer/settings-look.js';

test('Settings → General: performance values', () => {
  assert.deepEqual(PERF_LEVELS, ['full', 'balanced', 'light']);
  assert.equal(perfNote('full', 'light'), 'Now: Light (on battery)');
  assert.equal(perfNote('light', 'light'), '');
  assert.equal(perfNote('full', undefined), '');
});
