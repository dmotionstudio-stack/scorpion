// How the taskbar lays out its icons (taskbar.js, edge.js; main.js for the
// menus): pinned apps on their own or in the person's own groups, and the
// open windows, an app's windows together under one icon. Plain functions,
// tested on their own (test/taskbar-groups.test.js).

// Names offered for a new group (Settings and the taskbar's right-click menu).
export const GROUP_NAMES = ['Work', 'Web', 'Games', 'Media', 'Tools', 'Social', 'School', 'Other'];

const same = (a, b) => Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase();
// The app a window belongs to (Windows: its program; Scorpion OS: its app id).
export const appKey = (w) => String(w?.exe || w?.appId || w?.process || '').toLowerCase();
// What to call an app's windows together: "chrome.exe" → "Chrome".
export function appName(w) {
  const raw = String(w?.process || w?.appId || w?.exe || w?.title || 'App').split(/[\\/]/).pop().replace(/\.(exe|desktop)$/i, '');
  return raw ? raw[0].toUpperCase() + raw.slice(1) : 'App';
}
const idOf = (name) => String(name).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'group';

// The groups as kept ({ id, name, apps: [pinned ids] }): only apps still
// pinned, each app in one group, no empty groups.
export function cleanGroups(groups, pinned = []) {
  const taken = new Set();
  const out = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    const name = String(g?.name || '').trim().slice(0, 40);
    if (!name || out.some((o) => same(o.name, name))) continue;
    const apps = [];
    for (const id of Array.isArray(g.apps) ? g.apps : []) {
      const p = pinned.find((x) => same(x.id, id));
      if (!p || taken.has(p.id.toLowerCase())) continue;
      taken.add(p.id.toLowerCase());
      apps.push(p.id);
    }
    if (apps.length) out.push({ id: g.id || idOf(name), name, apps });
  }
  return out;
}
// The group an app is in, or null.
export const groupOf = (groups, appId) => (Array.isArray(groups) ? groups : []).find((g) => (g.apps || []).some((id) => same(id, appId))) || null;
// An app put into the group of that name (made if there is none), or taken
// out of its group (name: null). Gives the new list of groups.
export function setGroup(groups, appId, name) {
  const rest = (Array.isArray(groups) ? groups : []).map((g) => ({ ...g, apps: (g.apps || []).filter((id) => !same(id, appId)) }));
  const wanted = String(name || '').trim().slice(0, 40);
  if (wanted) {
    const g = rest.find((x) => same(x.name, wanted));
    if (g) g.apps.push(String(appId));
    else rest.push({ id: idOf(wanted), name: wanted, apps: [String(appId)] });
  }
  return rest.filter((g) => g.apps.length);
}
// The names a new group can take: the usual ones not in use yet.
export const freeGroupNames = (groups) => GROUP_NAMES.filter((n) => !(Array.isArray(groups) ? groups : []).some((g) => same(g.name, n)));

// What the taskbar shows.
//   pins: [{ kind: 'group', id, name, apps: [{ ...pinned, windows }], windows, running, active }
//        | { kind: 'pin', app, windows, running, active }]   in the pinned apps' order (a group where its first app is)
//   wins: [{ kind: 'window', w } | { kind: 'windows', key, name, icon, windows, active }]   windows of apps that aren't pinned
// combine: an app's windows share one icon (false: one icon a window).
export function layoutTaskbar({ pinned = [], windows = [], groups = [], combine = true } = {}) {
  const windowsOf = (p) => windows.filter((w) => same(w.exe, p.id));
  const kept = cleanGroups(groups, pinned);
  const done = new Set();
  const pins = [];
  for (const p of pinned) {
    const g = groupOf(kept, p.id);
    if (!g) {
      const open = windowsOf(p);
      pins.push({ kind: 'pin', app: p, windows: open, running: open.length > 0, active: open.some((w) => w.active) });
      continue;
    }
    if (done.has(g.id)) continue;
    done.add(g.id);
    const apps = g.apps.map((id) => pinned.find((x) => same(x.id, id))).filter(Boolean).map((a) => ({ ...a, windows: windowsOf(a) }));
    const open = apps.flatMap((a) => a.windows);
    pins.push({ kind: 'group', id: g.id, name: g.name, apps, windows: open, running: open.length > 0, active: open.some((w) => w.active) });
  }
  const loose = windows.filter((w) => !pinned.some((p) => same(w.exe, p.id)));
  const wins = [];
  if (!combine) return { pins, wins: loose.map((w) => ({ kind: 'window', w })) };
  const byApp = new Map();
  for (const w of loose) {
    const key = appKey(w);
    // A window nobody can name stands alone.
    if (!key) { wins.push({ kind: 'window', w }); continue; }
    if (!byApp.has(key)) { const item = { kind: 'windows', key, name: appName(w), icon: w.icon || null, windows: [], active: false }; byApp.set(key, item); wins.push(item); }
    const item = byApp.get(key);
    item.windows.push(w);
    item.active ||= Boolean(w.active);
    item.icon ||= w.icon || null;
  }
  // One window: just that window.
  return { pins, wins: wins.map((it) => (it.kind === 'windows' && it.windows.length === 1 ? { kind: 'window', w: it.windows[0] } : it)) };
}
