import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../src/main/store.js';
import * as agents from '../src/main/agents.js';
import { TOOLS } from '../src/main/tools.js';
import { createLoopGuard, buildFunctions, SOFT_STEPS, HARD_STEPS } from '../src/main/agent.js';

store.initStore(fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-speed-')));

test('a page that is written is opened in the preview by Scorpion, and its report comes back with the result', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-page-'));
  const asked = [];
  const services = { previewPage: async ({ file }) => { asked.push(path.basename(file)); return 'Opened in the preview: http://127.0.0.1:1/index.html\nConsole: no errors or warnings'; } };
  const ctx = { workspace: ws, allowed: [], services };
  const out = await TOOLS.write_file.run({ path: 'index.html', content: '<h1>Hi</h1>' }, ctx);
  assert.match(out, /Created index\.html/);
  assert.match(out, /Opened in the preview/);
  const edited = await TOOLS.edit_file.run({ path: 'index.html', find: 'Hi', replace: 'Hello' }, ctx);
  assert.match(edited, /Edited index\.html[\s\S]*no errors/);
  assert.deepEqual(asked, ['index.html', 'index.html']);
  // other files are not pages: plain text back at once (synchronously), no preview
  const plain = TOOLS.write_file.run({ path: 'notes.txt', content: 'x' }, ctx);
  assert.equal(typeof plain, 'string');
  assert.deepEqual(asked, ['index.html', 'index.html']);
  // a preview that fails never fails the write
  const broken = await TOOLS.write_file.run({ path: 'a.html', content: '<p>a</p>' }, { ...ctx, services: { previewPage: async () => { throw new Error('no pane'); } } });
  assert.match(broken, /Created a\.html/);
});

test('a task that keeps going is told to wrap up, then stopped (the step budget)', async () => {
  const g = createLoopGuard();
  const states = [];
  for (let i = 1; i <= HARD_STEPS + 2; i++) states.push(g.step());
  assert.equal(states[SOFT_STEPS - 2], null);
  assert.equal(states[SOFT_STEPS - 1], 'soft');
  assert.equal(states[SOFT_STEPS], null);
  assert.equal(states[HARD_STEPS - 1], null);
  assert.equal(states[HARD_STEPS], 'hard');
  // in a real turn: after the budget, the tools no longer run
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-budget-'));
  let ran = 0;
  const fns = buildFunctions({
    settings: { ...store.getSettings(), mode: 'build', workspace: ws, autoApprove: true }, agent: agents.getAgent('scorpion'), rag: { hasDocuments: () => false },
    emit() {}, streamedText: () => '', requestApproval: async () => true,
    extraTools: { tick: { access: 'read', noWorkspace: true, description: 'x', params: { type: 'object', properties: { n: { type: 'number' } } }, run() { ran++; return 'ok'; } } },
  });
  let last = '';
  for (let i = 0; i < HARD_STEPS + 3; i++) last = await fns.tick.handler({ n: i });
  assert.equal(ran, HARD_STEPS);
  assert.match(last, /already used \d+ steps/);
});
