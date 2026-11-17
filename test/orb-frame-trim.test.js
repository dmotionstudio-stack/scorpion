import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipKey, savedClip } from '../src/main/orb-frame.js';

test('a saved trim survives a Store app update (its folder carries the version)', () => {
  const old = 'c:\\program files\\windowsapps\\claude_5.11492.0.0_x64__pzs8sxrjxfjjc\\app\\claude.exe';
  const next = 'C:\\Program Files\\WindowsApps\\Claude_5.11492.5.0_x64__pzs8sxrjxfjjc\\app\\claude.exe';
  assert.equal(clipKey(old), clipKey(next));
  assert.equal(savedClip({ [old]: 40 }, next), 40);
  assert.equal(savedClip({ [clipKey(next)]: 48 }, old), 48);
  assert.equal(savedClip({}, next), undefined);
  const edge = 'c:\\program files (x86)\\microsoft\\edge\\application\\msedge.exe';
  assert.equal(clipKey(edge), edge);
  assert.equal(savedClip({ [edge]: 0 }, edge), 0);
});
