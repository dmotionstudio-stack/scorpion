import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanForModels, commonFolders, isGguf, wholeComputerRoots } from '../src/main/model-scan.js';
import { initStore } from '../src/main/store.js';
import { listLocalModels, importModel } from '../src/main/models.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'model-scan-'));
// A file that starts like a model (GGUF) and is `bytes` long.
const gguf = (file, bytes = 4000, magic = 'GGUF') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const b = Buffer.alloc(bytes);
  b.write(magic, 0, 'latin1');
  fs.writeFileSync(file, b);
  return file;
};
const opts = { minBytes: 1000 };

test('finds models by their first four bytes, not their name, and leaves the rest', async () => {
  const root = tmp();
  gguf(path.join(root, 'Downloads', 'Qwen3-4B-Q4_K_M.gguf'), 9000);
  gguf(path.join(root, 'Downloads', 'fake.gguf'), 9000, 'RIFF'); // named like a model, isn't one
  gguf(path.join(root, 'Downloads', 'tiny-vocab.gguf'), 200); // too small to be a model
  gguf(path.join(root, 'work', 'nomic-embed-text.gguf'), 5000);
  gguf(path.join(root, 'work', 'node_modules', 'pkg', 'ggml.gguf'), 9000); // build output
  fs.writeFileSync(path.join(root, 'notes.txt'), 'hello');
  const r = await scanForModels({ roots: [root], ...opts });
  assert.deepEqual(r.models.map((m) => [m.name, m.kind]), [['Qwen3-4B-Q4_K_M', 'chat'], ['nomic-embed-text', 'embedding']]); // biggest first
  assert.equal(r.models[0].folder, path.join(root, 'Downloads'));
  assert.equal(r.stopped, false);
});

test('models Scorpion already lists are left out; split models count once', async () => {
  const root = tmp();
  const have = gguf(path.join(root, 'a', 'have.gguf'), 5000);
  gguf(path.join(root, 'a', 'big-00001-of-00002.gguf'), 5000);
  gguf(path.join(root, 'a', 'big-00002-of-00002.gguf'), 5000);
  const r = await scanForModels({ roots: [root], known: new Set([have]), ...opts });
  assert.deepEqual(r.models.map((m) => m.name), ['big-00001-of-00002']);
  assert.ok(isGguf(have) && !isGguf(path.join(root, 'missing.gguf')));
});

test('Ollama: manifests say which hash-named blob is which model', async () => {
  const root = tmp();
  const ollama = path.join(root, '.ollama', 'models');
  const digest = 'sha256:abc123';
  gguf(path.join(ollama, 'blobs', 'sha256-abc123'), 6000);
  fs.mkdirSync(path.join(ollama, 'manifests', 'registry.ollama.ai', 'library', 'llama3'), { recursive: true });
  fs.writeFileSync(path.join(ollama, 'manifests', 'registry.ollama.ai', 'library', 'llama3', '8b'), JSON.stringify({ layers: [{ mediaType: 'application/vnd.ollama.image.model', digest }, { mediaType: 'application/vnd.ollama.image.params', digest: 'sha256:zzz' }] }));
  const r = await scanForModels({ roots: [ollama], ...opts });
  assert.deepEqual(r.models.map((m) => m.name), ['llama3:8b (Ollama)']);
  assert.equal(r.models[0].path, path.join(ollama, 'blobs', 'sha256-abc123'));
});

test('a search can be stopped and reports where it got to', async () => {
  const root = tmp();
  for (let i = 0; i < 30; i++) gguf(path.join(root, `d${i}`, `m${i}.gguf`), 5000);
  const ctrl = new AbortController();
  ctrl.abort();
  const stopped = await scanForModels({ roots: [root], signal: ctrl.signal, ...opts });
  assert.equal(stopped.stopped, true);
  assert.ok(stopped.models.length < 30);
  const timed = await scanForModels({ roots: [root], maxMs: -1, ...opts });
  assert.equal(timed.stopped, true);
  const progress = [];
  await scanForModels({ roots: [root], onProgress: (p) => progress.push(p), ...opts });
  assert.equal(progress.at(-1).found, 30);
});

test('the places searched: common folders that exist, and every drive for the whole computer', () => {
  const have = new Set([path.resolve('/h/Downloads'), path.resolve('/h/.lmstudio/models'), path.resolve('/h/.ollama/models')]);
  const common = commonFolders({ platform: 'linux', home: '/h', env: {}, exists: (p) => have.has(path.resolve(p)) });
  assert.deepEqual(common.map((d) => path.relative(path.resolve('/h'), d).replaceAll('\\', '/')), ['Downloads', '.lmstudio/models', '.ollama/models']);
  const win = wholeComputerRoots({ platform: 'win32', exists: (d) => /^[CD]:\\$/.test(d) });
  assert.deepEqual(win, ['C:\\', 'D:\\']);
  assert.ok(commonFolders({ platform: 'win32', home: 'C:\\Users\\s', env: { LOCALAPPDATA: 'C:\\L', APPDATA: 'C:\\A' }, exists: () => true }).some((d) => /Models$/.test(d)));
});

test('linked models are listed where they are; copying keeps the library tidy', async () => {
  const data = tmp();
  initStore(data);
  const elsewhere = gguf(path.join(tmp(), 'x', 'My-Model.gguf'), 5000);
  const blob = gguf(path.join(tmp(), 'blobs', 'sha256-feed'), 5000);
  const linked = [{ path: elsewhere }, { path: blob, name: 'phi3:mini (Ollama)' }, { path: path.join(data, 'gone.gguf') }];
  const list = listLocalModels({ resourcesPath: path.join(data, 'none'), appRoot: path.join(data, 'none'), linked });
  assert.deepEqual(list.filter((m) => m.source === 'linked').map((m) => [m.name, m.kind]), [['My-Model', 'chat'], ['phi3:mini (Ollama)', 'chat']]); // the missing one isn't listed
  const copied = await importModel(blob, 'phi3:mini (Ollama)');
  assert.equal(path.basename(copied), 'phi3-mini.gguf');
  assert.equal(fs.statSync(copied).size, 5000);
  assert.equal(await importModel(blob, 'phi3:mini (Ollama)'), copied); // already there: not copied again
  await assert.rejects(importModel(path.join(data, 'notes.txt')), /\.gguf/);
});
