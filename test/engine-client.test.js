import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// The engine in its own process (engine-client.js + engine-process.js), run
// here with plain Node and a fake engine: everything a chat turn passes
// across (tools, streamed text, continuation, flushPending, abort, errors)
// and what happens when the engine process dies.
process.env.SCORPION_ENGINE_NODE = process.execPath;
process.env.SCORPION_ENGINE_MODULE = fileURLToPath(new URL('./fixtures/fake-engine.js', import.meta.url));
const engine = await import('../src/main/engine-client.js');
const real = await import('../src/main/engine.js');

test('the client offers everything engine.js does', () => {
  assert.deepEqual(Object.keys(engine).sort(), Object.keys(real).sort());
});

test('loading: progress comes back, and the state is readable without waiting', async () => {
  const progress = [];
  assert.equal(engine.isChatReady(), false);
  await engine.loadChatModel('/models/x.gguf', { name: 'X 4B', onProgress: (p) => progress.push(p) });
  assert.deepEqual(progress, [0.5, 1]);
  assert.equal(engine.isChatReady(), true);
  assert.equal(engine.chatModelName(), 'X 4B');
  assert.equal(engine.isChatReady('voice'), false);
});

test('a turn: streamed text, a tool call answered here, flushPending and continuation', async () => {
  engine.forgetLoadedThread();
  const text = [];
  const functions = {
    read_file: { description: 'Read a file', params: { type: 'object' }, handler: async ({ path }) => `contents of ${path}` },
  };
  Object.defineProperty(functions, 'flushPending', { enumerable: false, value: async () => 'notes.md' });
  const history = await engine.runTurn({ text: 'a.txt', functions, onText: (t) => text.push(t), continuation: () => 'go on' });
  assert.equal(text.join(''), 'Hello');
  assert.deepEqual(history, [{ type: 'model', response: ['tool=contents of a.txt saved=notes.md next=go on forgotten=1'] }]);
});

test('stopping reaches the engine; errors come back as errors; vectors survive', async () => {
  const stop = new AbortController();
  const done = engine.complete({ text: 'long', signal: stop.signal });
  setTimeout(() => stop.abort(), 50);
  assert.equal(await done, 'stopped');
  await assert.rejects(engine.embedText('bad'), /No embedding model loaded/);
  assert.deepEqual([...await engine.embedText('ok')], [1, 2, 3]);
});

test('a crashed engine fails the call, forgets the model, and starts again on the next call', async () => {
  await assert.rejects(engine.engineInfo(), /stopped unexpectedly \(exit 7\)/);
  assert.equal(engine.isChatReady(), false);
  await engine.loadChatModel('/models/y.gguf');
  assert.equal(engine.chatModelName(), '/models/y.gguf');
  await engine.shutdown();
});
