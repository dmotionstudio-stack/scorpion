// The model engine as the rest of Scorpion uses it: the same exports as
// engine.js. On Linux, where Scorpion ships its own Node runtime
// (resources/node/node), the engine runs in that separate process
// (engine-process.js; why is explained there). Everywhere else it runs here,
// in-process, as before.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as local from './engine.js';

export { modelFit, compactHistory, lastModelText, parseTextToolCalls } from './engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// The Node runtime for the engine process, or null to run in-process.
function engineNode() {
  if (process.env.SCORPION_ENGINE_NODE) return process.env.SCORPION_ENGINE_NODE;
  if (process.platform !== 'linux' || !process.resourcesPath) return null;
  const node = path.join(process.resourcesPath, 'node', 'node');
  return fs.existsSync(node) ? node : null;
}
let nodePath;
const separate = () => (nodePath === undefined ? (nodePath = engineNode()) : nodePath) !== null;

const empty = () => ({ ready: { main: false, voice: false }, names: { main: null, voice: null }, reasoning: { main: false, voice: false }, embedName: null });
let state = empty();
let child = null;
let starting = null;
let calls = 0;
const inflight = new Map(); // id → { resolve, reject, local: { functions, callbacks, signal, onAbort } }

function start() {
  if (starting) return starting;
  starting = new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    // Messages are JSON: Electron's V8 and the engine's Node differ, so V8's
    // own ("advanced") serialization can't be read across.
    const proc = spawn(nodePath, [path.join(here, 'engine-process.js')], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env });
    proc.on('message', (msg) => onMessage(proc, msg, resolve));
    proc.on('error', (err) => { reject(err); stopped(proc, err); });
    proc.on('exit', (code, signal) => {
      const err = new Error(`The model engine stopped unexpectedly (${signal || `exit ${code}`}). Load the model again in Models.`);
      reject(err); // before it was ready; otherwise no effect
      stopped(proc, err);
    });
    child = proc;
  });
  starting.catch(() => { starting = null; });
  return starting;
}

function stopped(proc, err) {
  if (child !== proc) return;
  child = null;
  starting = null;
  state = empty();
  if (!shuttingDown) console.error('model engine:', err.message);
  for (const [id, call] of inflight) {
    inflight.delete(id);
    call.local.signal?.removeEventListener('abort', call.local.onAbort);
    call.reject(err);
  }
}

async function answer(proc, msg) {
  const call = inflight.get(msg.id);
  let reply;
  try {
    let value;
    if (!call) throw new Error('That turn has already ended');
    if (msg.what === 'tool') value = await call.local.functions[msg.name].handler(msg.params);
    else if (msg.what === 'flush') value = await call.local.functions.flushPending();
    else value = await call.local.callbacks[msg.name]();
    reply = { type: 'answer', qid: msg.qid, value };
  } catch (err) {
    reply = { type: 'answer', qid: msg.qid, error: err?.message || String(err) };
  }
  if (proc.connected) proc.send(reply);
}

function onMessage(proc, msg, ready) {
  if (msg.state) state = msg.state;
  if (msg.type === 'ready') ready(proc);
  else if (msg.type === 'event') inflight.get(msg.id)?.local.callbacks[msg.name]?.(msg.value);
  else if (msg.type === 'ask') answer(proc, msg);
  else if (msg.type === 'result') {
    const call = inflight.get(msg.id);
    if (!call) return;
    inflight.delete(msg.id);
    call.local.signal?.removeEventListener('abort', call.local.onAbort);
    if (!msg.error) { call.resolve(msg.value); return; }
    const err = new Error(msg.error.message);
    if (msg.error.cause) err.cause = new Error(msg.error.cause);
    call.reject(err);
  }
}

// The arguments' tools, callbacks and signal stay here; the engine
// process gets markers for them (engine-process.js turns them back).
const ASKS = new Set(['continuation']); // callbacks whose answer the engine needs
function pack(arg, keep) {
  if (!arg || typeof arg !== 'object' || Array.isArray(arg)) return arg;
  const out = {};
  for (const [k, v] of Object.entries(arg)) {
    if (k === 'functions' && v) {
      keep.functions = v;
      out.functions = Object.fromEntries(Object.entries(v).map(([name, f]) => [name, { description: f.description, params: f.params }]));
      out.hasFlush = typeof v.flushPending === 'function';
    } else if (k === 'signal' && v) {
      keep.signal = v;
      out.abortable = true;
    } else if (typeof v === 'function') {
      keep.callbacks[k] = v;
      (ASKS.has(k) ? (out.asks ??= []) : (out.callbacks ??= [])).push(k);
    } else out[k] = v;
  }
  return out;
}

async function remote(fn, ...args) {
  const proc = await start();
  const id = ++calls;
  const keep = { callbacks: {} };
  const packed = args.map((a) => pack(a, keep));
  return new Promise((resolve, reject) => {
    inflight.set(id, { resolve, reject, local: keep });
    if (keep.signal) {
      keep.onAbort = () => { if (proc.connected) proc.send({ type: 'abort', id }); };
      if (keep.signal.aborted) keep.onAbort();
      else keep.signal.addEventListener('abort', keep.onAbort, { once: true });
    }
    proc.send({ type: 'call', id, fn, args: packed });
  });
}

const via = (fn) => (...args) => (separate() ? remote(fn, ...args) : local[fn](...args));

export const hardwareInfo = via('hardwareInfo');
export const engineInfo = via('engineInfo');
export const loadChatModel = via('loadChatModel');
export const unloadChatModel = via('unloadChatModel');
export const runTurn = via('runTurn');
export const warmUp = via('warmUp');
export const runHelperTurn = via('runHelperTurn');
export const complete = via('complete');
export const loadEmbedModel = via('loadEmbedModel');
export const embedText = via('embedText');

// Read without waiting: from the state the engine process sends with every reply.
export const isChatReady = (slot = 'main') => (separate() ? Boolean(state.ready[slot]) : local.isChatReady(slot));
export const chatModelName = (slot = 'main') => (separate() ? state.names[slot] ?? null : local.chatModelName(slot));
export const usesReasoningEffort = (slot = 'main') => (separate() ? Boolean(state.reasoning[slot]) : local.usesReasoningEffort(slot));
export const embedModelName = () => (separate() ? state.embedName ?? null : local.embedModelName());
export function forgetLoadedThread() {
  if (!separate()) return local.forgetLoadedThread();
  if (child) remote('forgetLoadedThread').catch(() => {});
}

let shuttingDown = false;
export async function shutdown() {
  if (!separate()) return local.shutdown();
  if (!child) return;
  shuttingDown = true;
  const proc = child;
  await Promise.race([remote('shutdown').catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  proc.kill();
}
