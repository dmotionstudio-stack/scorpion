// The model engine in a process of its own, run by plain Node (Linux). Inside
// Electron, Chromium's allocator takes over malloc for the whole process and
// stops it on any aligned allocation over 1 GiB, which llama.cpp makes for
// every model of 4B and up. Here, with glibc's allocator, those load fine; and
// if the engine ever crashes, the desktop stays up.
//
// Speaks with engine-client.js over Node's IPC channel: { type: 'call', id,
// fn, args } runs one of engine.js's exports. Tools, callbacks and abort
// signals in the arguments were replaced by the client with markers;
// here they become functions again that ask the main process (tool calls,
// continuation, flushPending) or tell it (onText, onThought, onProgress).
import { pathToFileURL } from 'node:url';

// SCORPION_ENGINE_MODULE: another engine, for tests.
const engine = await import(process.env.SCORPION_ENGINE_MODULE ? pathToFileURL(process.env.SCORPION_ENGINE_MODULE).href : './engine.js');

const send = (msg) => process.send(msg);
const aborts = new Map(); // call id → AbortController
const asking = new Map(); // question id → { resolve, reject }
let questions = 0;

function ask(id, what, name, params) {
  const qid = ++questions;
  return new Promise((resolve, reject) => {
    asking.set(qid, { resolve, reject });
    send({ type: 'ask', id, qid, what, name, params });
  });
}

function unpack(id, arg) {
  if (!arg || typeof arg !== 'object' || Array.isArray(arg)) return arg;
  const { hasFlush, abortable, callbacks = [], asks = [], ...out } = arg;
  if (out.functions) {
    const specs = out.functions;
    out.functions = {};
    for (const [name, spec] of Object.entries(specs)) out.functions[name] = { ...spec, handler: (params) => ask(id, 'tool', name, params) };
    if (hasFlush) Object.defineProperty(out.functions, 'flushPending', { enumerable: false, value: () => ask(id, 'flush') });
  }
  for (const name of callbacks) out[name] = (value) => send({ type: 'event', id, name, value });
  for (const name of asks) out[name] = () => ask(id, 'callback', name);
  if (abortable) {
    const control = new AbortController();
    aborts.set(id, control);
    out.signal = control.signal;
  }
  return out;
}

// What the main process reads without waiting (isChatReady and the like).
const state = () => ({
  ready: { main: engine.isChatReady('main'), voice: engine.isChatReady('voice') },
  names: { main: engine.chatModelName('main'), voice: engine.chatModelName('voice') },
  reasoning: { main: engine.usesReasoningEffort('main'), voice: engine.usesReasoningEffort('voice') },
  embedName: engine.embedModelName(),
});

process.on('message', async (msg) => {
  if (msg.type === 'call') {
    const { id, fn, args = [] } = msg;
    try {
      if (typeof engine[fn] !== 'function') throw new Error(`The engine has no "${fn}"`);
      const value = await engine[fn](...args.map((a) => unpack(id, a)));
      send({ type: 'result', id, value, state: state() });
    } catch (err) {
      send({ type: 'result', id, error: { message: err?.message || String(err), cause: err?.cause?.message }, state: state() });
    } finally {
      aborts.delete(id);
    }
  } else if (msg.type === 'answer') {
    const q = asking.get(msg.qid);
    asking.delete(msg.qid);
    if (msg.error) q?.reject(new Error(msg.error)); else q?.resolve(msg.value);
  } else if (msg.type === 'abort') {
    aborts.get(msg.id)?.abort();
  }
});
// The main process went away: so does the engine.
process.on('disconnect', () => process.exit(0));
send({ type: 'ready', state: state() });
