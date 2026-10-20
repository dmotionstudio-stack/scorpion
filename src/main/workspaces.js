// Workspaces: the folders Scorpion works in, saved by name. One is active
// (settings.workspace, where new chats start); each chat remembers the
// workspace it started in, so switching doesn't move older chats elsewhere.
import fs from 'node:fs';
import path from 'node:path';
import { getSettings, updateSettings, newId, listThreads, getThread } from './store.js';

const clean = (p) => path.resolve(String(p));
const same = (a, b) => Boolean(a && b) && clean(a).toLowerCase() === clean(b).toLowerCase();

function saved() {
  const s = getSettings();
  const list = Array.isArray(s.workspaces) ? s.workspaces : [];
  // A workspace set before this list existed (or by the agent) joins it.
  if (s.workspace && !list.some((w) => same(w.path, s.workspace))) {
    const next = [...list, { id: newId(), name: path.basename(s.workspace) || s.workspace, path: s.workspace, addedAt: Date.now(), lastUsed: Date.now() }];
    updateSettings({ workspaces: next });
    return next;
  }
  return list;
}

// Every saved workspace with whether it's active, still exists, and its chats.
export function listWorkspaces() {
  const s = getSettings();
  const chats = new Map();
  for (const { id, updatedAt } of listThreads()) {
    const ws = getThread(id)?.workspace;
    if (!ws) continue;
    const key = clean(ws).toLowerCase();
    const c = chats.get(key) || { count: 0, last: 0 };
    chats.set(key, { count: c.count + 1, last: Math.max(c.last, updatedAt || 0) });
  }
  return saved().map((w) => {
    const c = chats.get(clean(w.path).toLowerCase()) || { count: 0, last: 0 };
    return { ...w, active: same(w.path, s.workspace), exists: fs.existsSync(w.path), chats: c.count, lastActivity: Math.max(c.last, w.lastUsed || 0) };
  }).sort((a, b) => (b.active - a.active) || b.lastActivity - a.lastActivity);
}

export function addWorkspace(folder, name = null) {
  if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error('Choose an existing folder');
  const list = saved();
  const existing = list.find((w) => same(w.path, folder));
  if (existing) return existing;
  const w = { id: newId(), name: String(name || path.basename(folder) || folder).slice(0, 60), path: clean(folder), addedAt: Date.now(), lastUsed: 0 };
  updateSettings({ workspaces: [...list, w] });
  return w;
}

// Makes a workspace the active one (where new chats start).
export function useWorkspace(id) {
  const list = saved();
  const w = list.find((x) => x.id === id);
  if (!w) throw new Error('Workspace not found');
  if (!fs.existsSync(w.path)) throw new Error(`${w.path} no longer exists`);
  return updateSettings({ workspace: w.path, workspaces: list.map((x) => (x.id === id ? { ...x, lastUsed: Date.now() } : x)) });
}

export function renameWorkspace(id, name) {
  const n = String(name || '').trim().slice(0, 60);
  if (!n) throw new Error('Give the workspace a name');
  updateSettings({ workspaces: saved().map((x) => (x.id === id ? { ...x, name: n } : x)) });
}

// Forgets a workspace; the folder and its files are not touched.
export function removeWorkspace(id) {
  const s = getSettings();
  const list = saved();
  const w = list.find((x) => x.id === id);
  if (!w) return;
  updateSettings({ workspaces: list.filter((x) => x.id !== id), ...(same(w.path, s.workspace) ? { workspace: null } : {}) });
}

export const findWorkspace = (id) => saved().find((x) => x.id === id) || null;
