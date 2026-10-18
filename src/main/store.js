// Persistence for settings and chat threads. Everything lives in the OS app-data
// folder (Electron's userData), so Kenzo never needs a server or an account.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_SETTINGS = {
  chatModel: null, // absolute path to a .gguf
  embedModel: null, // absolute path to an embedding .gguf (for documents)
  workspace: null, // folder the agent may read/write/run commands in
  contextSize: 8192,
  temperature: 0.6,
  autoApprove: false, // run write/exec tools without asking
  planMode: false, // read-only: hide every mutating tool from the model
  systemPrompt: '',
};

let dataDir = null;

export function initStore(dir) {
  dataDir = dir;
  fs.mkdirSync(path.join(dataDir, 'threads'), { recursive: true });
}

export const paths = {
  get data() { return dataDir; },
  get models() { return path.join(dataDir, 'models'); },
  get rag() { return path.join(dataDir, 'rag'); },
  get settings() { return path.join(dataDir, 'settings.json'); },
  thread(id) { return path.join(dataDir, 'threads', `${safeId(id)}.json`); },
};

function safeId(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid id');
  return id;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Write to a temp file then rename, so a crash mid-write never corrupts data.
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  fs.renameSync(tmp, file);
}

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(paths.settings, {}) };
}

export function updateSettings(patch) {
  const allowed = Object.keys(DEFAULT_SETTINGS);
  const next = getSettings();
  for (const [k, v] of Object.entries(patch || {})) if (allowed.includes(k)) next[k] = v;
  writeJson(paths.settings, next);
  return next;
}

export function newId() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

export function createThread() {
  const now = Date.now();
  const thread = { id: newId(), title: 'New chat', createdAt: now, updatedAt: now, messages: [], history: null };
  writeJson(paths.thread(thread.id), thread);
  return thread;
}

export function getThread(id) {
  return readJson(paths.thread(id), null);
}

export function saveThread(thread) {
  thread.updatedAt = Date.now();
  writeJson(paths.thread(thread.id), thread);
}

export function deleteThread(id) {
  fs.rmSync(paths.thread(id), { force: true });
}

export function listThreads() {
  const dir = path.join(dataDir, 'threads');
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(dir, f), null))
    .filter(Boolean)
    .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
