// The bubbles around the orb, as Settings (General → The orb's bubbles)
// arranges them: Scorpion's places (each on or off, in your order), bubbles
// of your own (an app, a folder, a website or one of Scorpion's actions,
// each with a label and, if you like, its own colour), and the open windows
// on the outer ring (or not, and how many). Plain data, used by the orb
// (orb-system.js) and the tests. The orb no longer shows bubbles: the apps are tiles and the taskbar has the rest.

export const PLACE_IDS = ['apps', 'files', 'library', 'chats', 'people', 'settings'];
export const KINDS = ['app', 'folder', 'site', 'action'];
export const SIZES = { small: 0.75, normal: 1, large: 1.35 };
export const SPEEDS = { still: 0, slow: 0.5, normal: 1, fast: 2 };
export const MAX_CUSTOM = 12;

export const DEFAULT_BUBBLES = {
  places: PLACE_IDS.map((id) => ({ id, on: true })),
  custom: [], // { id, kind, label, target, color: '#rrggbb' | null }
  windows: true,
  maxWindows: 8,
  size: 'normal',
  speed: 'normal',
};

const HEX = /^#[0-9a-f]{6}$/i;

// Settings as saved, made whole: every place once (a place added in a newer
// Scorpion shows up on, at the end), your own bubbles checked, the rest
// within bounds.
export function normalizeBubbles(saved) {
  const b = { ...DEFAULT_BUBBLES, ...(saved && typeof saved === 'object' ? saved : {}) };
  const seen = new Set();
  const places = (Array.isArray(b.places) ? b.places : [])
    .filter((p) => p && PLACE_IDS.includes(p.id) && !seen.has(p.id) && seen.add(p.id))
    .map((p) => ({ id: p.id, on: p.on !== false }));
  for (const id of PLACE_IDS) if (!seen.has(id)) places.push({ id, on: true });
  const custom = (Array.isArray(b.custom) ? b.custom : [])
    .filter((c) => c && KINDS.includes(c.kind) && String(c.label || '').trim() && String(c.target || '').trim())
    .slice(0, MAX_CUSTOM)
    .map((c, i) => ({ id: String(c.id || `b${i}`), kind: c.kind, label: String(c.label).trim().slice(0, 40), target: String(c.target).trim(), color: HEX.test(c.color || '') ? c.color.toLowerCase() : null }));
  return {
    places,
    custom,
    windows: b.windows !== false,
    maxWindows: Math.max(1, Math.min(20, Math.round(Number(b.maxWindows) || DEFAULT_BUBBLES.maxWindows))),
    size: SIZES[b.size] ? b.size : 'normal',
    speed: SPEEDS[b.speed] !== undefined ? b.speed : 'normal',
  };
}

// The orb's bubbles, in ring order: available places (those this system has)
// that are on, then your own, then the open windows.
//   places: [{ id, label, say }] as the orb knows them
//   windows: [{ hwnd, title, process, icon, exe }]
export function bubbleItems(saved, places, windows = []) {
  const b = normalizeBubbles(saved);
  const byId = new Map(places.map((p) => [p.id, p]));
  return [
    ...b.places.filter((p) => p.on && byId.has(p.id)).map((p) => ({ ...byId.get(p.id), kind: 'tool' })),
    ...b.custom.map((c) => ({ id: `c:${c.id}`, kind: 'tool', label: c.label, say: [c.label], color: c.color, custom: c })),
    ...(b.windows ? windows.slice(0, b.maxWindows) : []).map((w) => ({ id: `w:${w.hwnd}`, kind: 'window', label: w.title, app: w.process, icon: w.icon, hwnd: w.hwnd, exe: w.exe })),
  ];
}

// The rings' look: how big the bubbles are and how fast the rings turn.
export const ringLook = (saved) => { const b = normalizeBubbles(saved); return { size: SIZES[b.size], speed: SPEEDS[b.speed] }; };

// A website's address made openable (https:// added), or null if it isn't one.
export function siteUrl(text) {
  const t = String(text || '').trim();
  if (!t || /\s/.test(t)) return null;
  const url = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href : null; } catch { return null; }
}
