import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanOutput, trustState } from '../src/renderer/build-dock.js';

test('terminal text loses colour codes and carriage returns, and is trimmed from the front', () => {
  assert.equal(cleanOutput('\u001b[32mready\u001b[0m in 3s'), 'ready in 3s');
  assert.equal(cleanOutput('50%\r100%\r\ndone'), '50%\n100%\r\ndone'.replace('\r\n', '\r\n'));
  assert.equal(cleanOutput('x'.repeat(100), 10), 'x'.repeat(10));
  assert.equal(cleanOutput(null), '');
});

test('the Trust chip: hidden without a workspace, and the same folder however Windows spells it', () => {
  assert.deepEqual(trustState({}), { visible: false, trusted: false });
  assert.deepEqual(trustState({ workspace: 'C:\Work\Site', trustedFolders: [] }), { visible: true, trusted: false });
  assert.deepEqual(trustState({ workspace: 'C:\Work\Site', trustedFolders: ['c:\work\site'] }), { visible: true, trusted: true });
  assert.deepEqual(trustState({ workspace: '/home/me/site', trustedFolders: ['/home/me/site'] }), { visible: true, trusted: true });
  assert.deepEqual(trustState({ workspace: '/home/me/Site', trustedFolders: ['/home/me/site'] }), { visible: true, trusted: false });
});
