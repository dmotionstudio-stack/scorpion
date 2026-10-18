// Scheduled agents: run an agent with a prompt every N minutes, daily at a set
// time, or when files in a folder change. Runs happen while Kenzo is open (it
// can keep running in the tray), and each schedule posts results to its own chat.
import fs from 'node:fs';
import path from 'node:path';
import { paths, writeJson, readJson, newId } from './store.js';

const TICK_MS = 30_000;
const FOLDER_DEBOUNCE_MS = 15_000;
const SELF_CHANGE_GRACE_MS = 10_000;

const file = () => path.join(paths.data, 'schedules.json');
let runFn = null;
let timer = null;
const watchers = new Map(); // schedule id -> { watcher, changed: Set, debounce }
const busy = new Set();
const quietUntil = new Map(); // schedule id -> ms; ignore our own file edits

export function listSchedules() {
  return readJson(file(), []);
}

function saveAll(list) {
  writeJson(file(), list);
}

function patch(id, fields) {
  const list = listSchedules();
  const s = list.find((x) => x.id === id);
  if (s) { Object.assign(s, fields); saveAll(list); }
  return s;
}

function cleanTrigger(t = {}) {
  if (t.type === 'interval') return { type: 'interval', minutes: Math.max(5, Math.round(+t.minutes || 60)) };
  if (t.type === 'daily') {
    if (!/^\d{1,2}:\d{2}$/.test(t.time || '')) throw new Error('Daily time must look like 08:30');
    return { type: 'daily', time: t.time.padStart(5, '0') };
  }
  if (t.type === 'folder') {
    if (!t.folder || !fs.existsSync(t.folder) || !fs.statSync(t.folder).isDirectory()) throw new Error('Choose an existing folder to watch');
    return { type: 'folder', folder: t.folder };
  }
  throw new Error('Unknown trigger type');
}

export function saveSchedule(input) {
  const name = String(input.name || '').trim().slice(0, 60);
  const prompt = String(input.prompt || '').trim().slice(0, 4000);
  if (!name) throw new Error('Give the schedule a name');
  if (!prompt) throw new Error('Tell the agent what to do');
  const fields = {
    name,
    prompt,
    agentId: String(input.agentId || 'kenzo'),
    trigger: cleanTrigger(input.trigger),
    workspace: input.workspace || null,
    allowChanges: Boolean(input.allowChanges),
    enabled: input.enabled !== false,
  };
  const list = listSchedules();
  let s = input.id && list.find((x) => x.id === input.id);
  if (s) Object.assign(s, fields);
  else { s = { id: newId(), createdAt: Date.now(), lastRunAt: null, lastStatus: null, threadId: null, ...fields }; list.push(s); }
  saveAll(list);
  syncWatchers();
  return s;
}

export function deleteSchedule(id) {
  saveAll(listSchedules().filter((s) => s.id !== id));
  syncWatchers();
}

export function hasEnabledSchedules() {
  return listSchedules().some((s) => s.enabled);
}

// Next due time for time-based triggers (null for folder watches).
export function nextRunAt(s, now = Date.now()) {
  if (!s.enabled) return null;
  if (s.trigger.type === 'interval') return (s.lastRunAt ?? s.createdAt) + s.trigger.minutes * 60_000;
  if (s.trigger.type === 'daily') {
    const [h, m] = s.trigger.time.split(':').map(Number);
    const today = new Date(now); today.setHours(h, m, 0, 0);
    const due = today.getTime();
    // Due today if that time has passed and we haven't run since; otherwise tomorrow.
    if (due <= now && (s.lastRunAt ?? 0) < due && (s.createdAt ?? 0) < due) return due;
    return due > now ? due : due + 86_400_000;
  }
  return null;
}

export async function runNow(id, reason = 'Run manually') {
  const s = listSchedules().find((x) => x.id === id);
  if (!s) throw new Error('Schedule not found');
  if (busy.has(id)) throw new Error('Already running');
  busy.add(id);
  quietUntil.set(id, Infinity);
  patch(id, { lastStatus: 'running' });
  try {
    const result = await runFn(s, reason);
    patch(id, { lastRunAt: Date.now(), lastStatus: result.error ? `error: ${result.error}` : 'ok', threadId: result.threadId });
    return result;
  } catch (err) {
    patch(id, { lastRunAt: Date.now(), lastStatus: `error: ${err.message}` });
    throw err;
  } finally {
    busy.delete(id);
    quietUntil.set(id, Date.now() + SELF_CHANGE_GRACE_MS);
  }
}

function tick() {
  const now = Date.now();
  for (const s of listSchedules()) {
    const due = nextRunAt(s, now);
    if (due !== null && due <= now && !busy.has(s.id)) {
      const why = s.trigger.type === 'daily' ? `Daily at ${s.trigger.time}` : `Every ${s.trigger.minutes} min`;
      runNow(s.id, why).catch(() => {});
    }
  }
}

function syncWatchers() {
  const wanted = new Map(listSchedules().filter((s) => s.enabled && s.trigger.type === 'folder').map((s) => [s.id, s]));
  for (const [id, w] of watchers) {
    if (!wanted.has(id) || wanted.get(id).trigger.folder !== w.folder) { w.watcher.close(); clearTimeout(w.debounce); watchers.delete(id); }
  }
  for (const [id, s] of wanted) {
    if (watchers.has(id)) continue;
    try {
      const w = { folder: s.trigger.folder, changed: new Set(), debounce: null };
      w.watcher = fs.watch(s.trigger.folder, { recursive: true }, (_event, name) => {
        if (!name || (quietUntil.get(id) ?? 0) > Date.now()) return;
        if (/(^|[\\/])(\.git|node_modules)([\\/]|$)|~\$|\.tmp$|\.crdownload$|\.part$/i.test(name)) return;
        w.changed.add(name.replaceAll('\\', '/'));
        clearTimeout(w.debounce);
        w.debounce = setTimeout(() => {
          const files = [...w.changed].slice(0, 50);
          w.changed.clear();
          runNow(id, `Files changed: ${files.join(', ')}`).catch(() => {});
        }, FOLDER_DEBOUNCE_MS);
      });
      watchers.set(id, w);
    } catch { /* folder vanished; shows as idle */ }
  }
}

export function startScheduler(run) {
  runFn = run;
  // A run that was interrupted by quitting shouldn't look stuck forever.
  const list = listSchedules();
  for (const s of list) if (s.lastStatus === 'running') s.lastStatus = 'interrupted';
  saveAll(list);
  syncWatchers();
  clearInterval(timer);
  timer = setInterval(tick, TICK_MS);
  setTimeout(tick, 5_000);
}

export function stopScheduler() {
  clearInterval(timer);
  for (const w of watchers.values()) { w.watcher.close(); clearTimeout(w.debounce); }
  watchers.clear();
}
