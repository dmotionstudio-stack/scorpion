// The constellation launcher's logic, without any page: the shared file
// format, how relevant each item is right now, where items sit on their
// orbits, where projects sit in the galaxy, and search. Tested on its own.
//
// A project (constellation) holds nodes: apps, folders, files and websites.
// Orbit distance is relevance (recent, frequent, usual at this hour, open
// now); positions are stable: an item keeps its place on its orbit as long as
// it stays on that orbit, and pinned items never move.

export const FORMAT = 'scorpion-constellations/1';
const DAY = 864e5;

// Size (radius at zoom 1) and look per kind.
export const KINDS = {
  app: { size: 30, label: 'App' },
  folder: { size: 22, label: 'Folder' },
  file: { size: 18, label: 'Document' },
  website: { size: 18, label: 'Website' },
};
// Three orbits; how many items the inner two hold before the next one.
const RINGS = [165, 258, 350];
const RING_CAP = [6, 10];

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function newProject(name = 'New project', { color = null } = {}) {
  return { id: uid(), name: String(name).slice(0, 60) || 'New project', color, createdAt: Date.now(), archived: false, pos: null, nodes: [], links: [], session: [] };
}

export function newNode(kind, target, label) {
  if (!KINDS[kind]) throw new Error(`Unknown kind ${kind}`);
  return { id: uid(), kind, target: String(target), label: String(label || target).slice(0, 80), pinned: false, pos: null, addedAt: Date.now(), lastUsed: 0, uses: 0, hours: [] };
}

// A label for a file or folder path ("report.pdf", "Website").
export const baseName = (p) => String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p);

// Records a launch: recency, how often, and at what hour (for time-of-day relevance).
export function markUsed(node, now = Date.now()) {
  node.lastUsed = now;
  node.uses = (node.uses || 0) + 1;
  const h = new Date(now).getHours();
  node.hours = Array.from({ length: 24 }, (_, i) => (node.hours?.[i] || 0) + (i === h ? 1 : 0));
  return node;
}

// 0..1: how recently it was used (a 3-day fade).
export const recency = (node, now = Date.now()) => (node.lastUsed ? Math.exp(-(now - node.lastUsed) / (3 * DAY)) : 0);

// How relevant an item is now: recent use, frequent use, use at this time of
// day, and being open right now. With recommendations off: 0 (added order).
export function relevance(node, { now = Date.now(), running = new Set(), recommend = true } = {}) {
  if (!recommend) return 0;
  const hour = new Date(now).getHours();
  const hours = node.hours || [];
  const total = hours.reduce((a, b) => a + (b || 0), 0);
  const usual = total ? ((hours[hour] || 0) + 0.5 * ((hours[(hour + 23) % 24] || 0) + (hours[(hour + 1) % 24] || 0))) / total : 0;
  const often = Math.min(1, Math.log1p(node.uses || 0) / Math.log(50));
  return 1.2 * recency(node, now) + 0.8 * often + 0.6 * usual + (running.has(node.id) ? 0.5 : 0) + (node.kind === 'app' ? 0.15 : 0);
}

// A stable 0..1 number from an id: an item's place within its orbit.
export function hash01(id) {
  let h = 2166136261;
  for (const c of String(id)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

// Where everything in a project sits, relative to the project's star at (0, 0):
// [{ id, x, y, r, ring, glow }]. scale: bigger or smaller maps (node size setting).
export function layoutProject(project, { running = new Set(), recommend = true, now = Date.now(), scale = 1 } = {}) {
  const out = [];
  const free = [];
  for (const n of project.nodes) {
    const r = (KINDS[n.kind]?.size || 18) * scale;
    if (n.pinned && n.pos) out.push({ id: n.id, x: n.pos.x * scale, y: n.pos.y * scale, r, ring: -1, glow: recency(n, now) });
    else free.push(n);
  }
  // Most relevant first; ties keep the order they were added.
  free.sort((a, b) => relevance(b, { now, running, recommend }) - relevance(a, { now, running, recommend }) || a.addedAt - b.addedAt);
  const rings = [[], [], []];
  free.forEach((n, i) => rings[i < RING_CAP[0] ? 0 : i < RING_CAP[0] + RING_CAP[1] ? 1 : 2].push(n));
  rings.forEach((list, ring) => {
    // Within an orbit, the order comes from the ids, so places don't shuffle.
    const ordered = [...list].sort((a, b) => hash01(a.id) - hash01(b.id));
    const offset = ring * 0.6 + 0.3;
    ordered.forEach((n, i) => {
      const a = offset + (i / ordered.length) * Math.PI * 2;
      const R = RINGS[ring] * scale;
      out.push({ id: n.id, x: Math.cos(a) * R, y: Math.sin(a) * R * 0.82, r: (KINDS[n.kind]?.size || 18) * scale, ring, glow: recency(n, now) });
    });
  });
  return out;
}
export const ringRadii = (scale = 1) => RINGS.map((r) => r * scale);

// Where projects sit in the galaxy: a golden-angle spiral (stable as projects
// are added), archived ones on the outside; a project dragged somewhere stays.
export function layoutGalaxy(projects) {
  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);
  return [...active, ...archived].map((p, i) => {
    if (p.pos) return { id: p.id, x: p.pos.x, y: p.pos.y };
    const a = i * 2.399963;
    const R = i === 0 ? 0 : 250 * Math.sqrt(i);
    return { id: p.id, x: Math.cos(a) * R, y: Math.sin(a) * R * 0.8 };
  });
}

// Search: the projects and items whose names (or paths, addresses) contain
// every word typed. Returns { projects: Set, nodes: Set } of ids.
export function search(projects, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (s) => words.every((w) => String(s || '').toLowerCase().includes(w));
  const res = { projects: new Set(), nodes: new Set() };
  if (!words.length) return res;
  for (const p of projects) {
    if (hit(p.name)) res.projects.add(p.id);
    for (const n of p.nodes) if (hit(`${n.label} ${n.target}`)) { res.nodes.add(n.id); res.projects.add(p.id); }
  }
  return res;
}

// Links: undirected pairs of node ids within a project.
export function link(project, a, b) {
  if (a === b || !project.nodes.some((n) => n.id === a) || !project.nodes.some((n) => n.id === b)) return false;
  if (project.links.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return false;
  project.links.push([a, b]);
  return true;
}
export const linksOf = (project, id) => project.links.filter(([a, b]) => a === id || b === id).map(([a, b]) => (a === id ? b : a));

export function removeNode(project, id) {
  project.nodes = project.nodes.filter((n) => n.id !== id);
  project.links = project.links.filter(([a, b]) => a !== id && b !== id);
  project.session = (project.session || []).filter((x) => x !== id);
}

// The shared file: what Export writes and Import reads.
export function exportData(data) {
  return { format: FORMAT, exportedAt: new Date().toISOString(), projects: data.projects };
}
// Imported projects are added; a project with the same id replaces the old one.
export function importData(json, data) {
  const incoming = typeof json === 'string' ? JSON.parse(json) : json;
  if (incoming?.format !== FORMAT || !Array.isArray(incoming.projects)) throw new Error('That file is not a Scorpion constellation export.');
  const clean = incoming.projects.filter((p) => p && p.id && p.name && Array.isArray(p.nodes)).map((p) => ({
    ...newProject(p.name), ...p,
    nodes: p.nodes.filter((n) => n && n.id && KINDS[n.kind] && n.target).map((n) => ({ ...newNode(n.kind, n.target, n.label), ...n })),
    links: Array.isArray(p.links) ? p.links.filter((l) => Array.isArray(l) && l.length === 2) : [],
    session: Array.isArray(p.session) ? p.session : [],
  }));
  const ids = new Set(clean.map((p) => p.id));
  return { ...data, projects: [...data.projects.filter((p) => !ids.has(p.id)), ...clean] };
}
