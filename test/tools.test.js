import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOLS, resolveInside } from '../src/main/tools.js';
import { chunkText } from '../src/main/rag.js';

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'kenzo-ws-'));
const ctx = { workspace: ws };

test('resolveInside refuses paths that escape the workspace', () => {
  assert.throws(() => resolveInside(ws, '../outside.txt'), /outside the workspace/);
  assert.throws(() => resolveInside(ws, path.resolve(ws, '..', 'x')), /outside the workspace/);
  assert.equal(resolveInside(ws, 'a/b.txt'), path.join(fs.realpathSync(ws), 'a', 'b.txt'));
});

test('resolveInside requires a workspace', () => {
  assert.throws(() => resolveInside(null, 'x'), /No workspace/);
});

test('write, read, edit, list and search files', async () => {
  assert.match(TOOLS.write_file.run({ path: 'src/hello.txt', content: 'hello world\nsecond line' }, ctx), /Created/);
  assert.match(TOOLS.read_file.run({ path: 'src/hello.txt', startLine: 1 }, ctx), /1\| hello world/);
  assert.match(TOOLS.edit_file.run({ path: 'src/hello.txt', find: 'world', replace: 'Kenzo' }, ctx), /Edited/);
  assert.equal(fs.readFileSync(path.join(ws, 'src/hello.txt'), 'utf8'), 'hello Kenzo\nsecond line');
  assert.throws(() => TOOLS.edit_file.run({ path: 'src/hello.txt', find: 'nope', replace: '' }, ctx), /not found/);
  assert.match(TOOLS.list_files.run({ path: '.', depth: 2 }, ctx), /src\/hello\.txt/);
  assert.match(TOOLS.search_files.run({ query: 'SECOND', path: '.' }, ctx), /src\/hello\.txt:2/);
});

test('edit_file rejects ambiguous matches', () => {
  TOOLS.write_file.run({ path: 'dup.txt', content: 'x x' }, ctx);
  assert.throws(() => TOOLS.edit_file.run({ path: 'dup.txt', find: 'x', replace: 'y' }, ctx), /matches 2/);
});

test('run_command runs inside the workspace', async () => {
  const out = await TOOLS.run_command.run({ command: 'echo kenzo-ok', subdir: '.' }, ctx);
  assert.match(out, /exit code 0/);
  assert.match(out, /kenzo-ok/);
});

test('update_plan reports the next step', () => {
  let seen;
  const out = TOOLS.update_plan.run({ steps: [{ title: 'a', status: 'done' }, { title: 'b', status: 'pending' }] }, { onPlan: (s) => (seen = s) });
  assert.equal(seen.length, 2);
  assert.match(out, /Continue with: b/);
});

test('chunkText splits long text with overlap and keeps all content', () => {
  const para = 'Sentence number one is here. '.repeat(30);
  const text = Array.from({ length: 6 }, (_, i) => `Section ${i}. ${para}`).join('\n\n');
  const chunks = chunkText(text, 1200, 200);
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every((c) => c.length <= 1200));
  for (let i = 0; i < 6; i++) assert.ok(chunks.some((c) => c.includes(`Section ${i}.`)));
});

test('findLastCodeBlock returns the last fenced block body', async () => {
  const { findLastCodeBlock } = await import('../src/main/agent.js');
  assert.equal(findLastCodeBlock('no code'), null);
  assert.equal(findLastCodeBlock('a\n```py\nprint(1)\n```\nb\n```js\nlet x = 2;\n```'), 'let x = 2;\n');
});

test('write_file.prepare requires a code block', () => {
  assert.throws(() => TOOLS.write_file.prepare({ path: 'a.py' }, { lastCodeBlock: () => null }), /no new ``` code block/);
  assert.deepEqual(TOOLS.write_file.prepare({ path: 'a.py' }, { lastCodeBlock: () => 'x' }), { path: 'a.py', content: 'x' });
});

test('write_file refuses non-JSON content for .json files', () => {
  assert.throws(() => TOOLS.write_file.prepare({ path: 'todos.json' }, { lastCodeBlock: () => 'import fs from "fs";\n' }), /not valid JSON/);
  assert.deepEqual(TOOLS.write_file.prepare({ path: 'todos.json' }, { lastCodeBlock: () => '[]\n' }), { path: 'todos.json', content: '[]\n' });
});
