// The constellation launcher: the orb's screen as a map of the user's work.
// Each project is a constellation: a warm star with its apps (large planets),
// folders and documents (smaller moons) and websites on orbits around it;
// orbit distance is relevance, brightness is recent use, lines are links.
// Zoomed out, every project is a star in the galaxy.
//
// Click an item to open it, the star to resume the project (reopen its saved
// session), drag an item onto another to link them or somewhere else to pin
// it there, scroll or pinch to zoom (out to the galaxy), drag the background
// to look around, type anywhere to search. Files dragged in from File Explorer
// join the project. A list view gives the same map as plain lists.
//
// It offers the same calls as the 3D orb (orb.js), so voice, hand gestures,
// apps inside the orb and Scorpion's own shortcuts work unchanged.
import { KINDS, newProject, newNode, markUsed, layoutProject, layoutGalaxy, ringRadii, search, link, linksOf, removeNode, baseName, recency } from './constellation-core.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const COLORS = ['#ffcf70', '#7fd3ff', '#b69cff', '#7ff0b2', '#ff9f8a', '#f7a8ff'];
const GLOBE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>';
const ago = (t) => { if (!t) return 'not opened yet'; const m = (Date.now() - t) / 6e4; return m < 1 ? 'just now' : m < 60 ? `${Math.round(m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
// A stable colour per app (planets are coloured; documents stay neutral).
const hueOf = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

export function createConstellation(container, { accent, api, toast = () => {}, errText = String, settings = () => ({}) } = {}) {
  const C = {
    data: { projects: [] }, view: 'galaxy', focus: null, zoom: 1, pan: { x: 0, y: 0 }, items: [], icons: {}, appIcons: {}, missing: new Map(),
    query: '', hits: { projects: new Set(), nodes: new Set() }, compact: false, running: false, state: 'standby', spin: 0, hover: null, saveTimer: 0,
  };
  const opts = () => ({ recommend: true, motion: true, large: false, contrast: false, ...(settings().constellation || {}) });
  const reduced = () => !opts().motion || matchMedia('(prefers-reduced-motion: reduce)').matches;

  const root = document.createElement('div');
  root.className = 'cx';
  root.innerHTML = `
    <canvas class="cx-stars" aria-hidden="true"></canvas>
    <div class="cx-view" tabindex="-1">
      <div class="cx-world"><svg class="cx-links" aria-hidden="true"></svg><div class="cx-layer"></div></div>
    </div>
    <div class="cx-bar" role="toolbar" aria-label="Constellations">
      <nav class="cx-crumbs"></nav>
      <input class="cx-search" type="search" placeholder="Type to search your work…" aria-label="Search projects and items" autocomplete="off">
      <span class="cx-found"></span>
      <button type="button" class="cx-btn" data-act="add" title="Add apps, files, folders, websites or recent files to this project">+ Add</button>
      <button type="button" class="cx-btn" data-act="new" title="A new project">New project</button>
      <button type="button" class="cx-btn" data-act="resume" title="Reopen this project's saved session">Resume</button>
      <button type="button" class="cx-btn" data-act="save" title="Remember the apps open now as this project's session">Save session</button>
      <button type="button" class="cx-btn" data-act="list" title="The same map as plain lists" aria-pressed="false">List</button>
      <button type="button" class="cx-btn" data-act="more" title="Zoom to fit, import and export">⋯</button>
    </div>
    <nav class="cx-rail" aria-label="Scorpion"></nav>
    <div class="cx-preview" hidden></div>
    <div class="cx-menu" role="menu" hidden></div>
    <div class="cx-panel" role="dialog" aria-modal="false" hidden></div>
    <div class="cx-sr" aria-live="polite"></div>`;
  container.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const view = $('.cx-view');
  const world = $('.cx-world');
  const layer = $('.cx-layer');
  const svg = $('.cx-links');
  const say = (text) => { $('.cx-sr').textContent = text; };
  root.style.setProperty('--cx-accent', accent || '#f0a830');

  // ---------- data ----------
  const project = (id = C.focus) => C.data.projects.find((p) => p.id === id);
  const saveSoon = () => { clearTimeout(C.saveTimer); C.saveTimer = setTimeout(() => api.constSave(C.data).catch((err) => toast(errText(err))), 400); };
  async function load() {
    try { C.data = await api.constGet(); } catch (err) { toast(errText(err)); }
    try { C.appIcons = await api.shellAppIcons(); } catch { /* letters instead */ }
    C.focus = C.data.projects.find((p) => !p.archived)?.id || null;
    C.view = C.focus ? 'focus' : 'galaxy';
    render();
    fit(true);
  }

  // Icons: an app's own (from the Apps screen's set), a file's or folder's as
  // Windows shows it; fetched once each.
  function iconOf(n) {
    if (n.kind === 'website') return null;
    if (n.kind === 'app' && C.appIcons[n.target]) return C.appIcons[n.target];
    if (C.icons[n.target] !== undefined) return C.icons[n.target];
    C.icons[n.target] = null;
    if (n.kind !== 'app' || /^[a-z]:\\/i.test(n.target)) api.constIcon(n.target).then((url) => { C.icons[n.target] = url; if (url) render(); }).catch(() => {});
    return null;
  }
  // Files and folders that are gone show as eclipsed (red); checked once a session.
  function isMissing(n) {
    if (n.kind !== 'file' && n.kind !== 'folder') return false;
    if (!C.missing.has(n.target)) {
      C.missing.set(n.target, false);
      api.constPathInfo(n.target).then((i) => { if (!i.exists) { C.missing.set(n.target, true); render(); } }).catch(() => {});
    }
    return C.missing.get(n.target);
  }

  // Open windows: the ones belonging to an app in the project ride along with
  // it as satellites; the rest circle the outside ("running now").
  const windows = () => C.items.filter((i) => i.kind === 'window');
  function windowsOfNode(n) {
    if (n.kind !== 'app') return [];
    const t = n.target.toLowerCase();
    return windows().filter((w) => (w.exe && w.exe.toLowerCase() === t)
      || (w.label && n.label && w.label.toLowerCase().endsWith(` - ${n.label.toLowerCase()}`))
      || (w.app && t.includes(w.app.toLowerCase()) && w.app.length > 3));
  }

  // ---------- drawing ----------
  const scale = () => (opts().large ? 1.25 : 1);
  function render() {
    root.classList.toggle('cx-reduced', reduced());
    root.classList.toggle('cx-contrast', Boolean(opts().contrast));
    root.classList.toggle('cx-compact', C.compact);
    C.hits = search(C.data.projects, C.query);
    renderRail();
    if (C.view === 'focus' && project()) renderProject(project()); else { C.view = 'galaxy'; renderGalaxy(); }
    renderCrumbs();
    applyTransform();
    if (!$('.cx-panel').hidden && $('.cx-panel').dataset.kind === 'list') renderList();
  }

  function renderRail() {
    const tools = C.items.filter((i) => i.kind !== 'window');
    $('.cx-rail').innerHTML = tools.map((t) => `<button type="button" class="cx-rail-btn" data-sat="${esc(t.id)}" title="${esc(t.label)}">${esc(t.label)}</button>`).join('');
  }

  function nodeHtml(n, pos, p) {
    const icon = iconOf(n);
    const live = windowsOfNode(n);
    const glow = Math.max(0.35, pos.glow);
    const dim = C.query && !C.hits.nodes.has(n.id);
    const hit = C.query && C.hits.nodes.has(n.id);
    const links = linksOf(p, n.id).map((id) => p.nodes.find((x) => x.id === id)?.label).filter(Boolean);
    const label = `${n.label}, ${KINDS[n.kind].label.toLowerCase()}${live.length ? ', open now' : ''}${n.pinned ? ', pinned' : ''}${isMissing(n) ? ', missing' : ''}${links.length ? `, connected to ${links.join(', ')}` : ''}`;
    const sats = live.slice(0, 6).map((w, i) => {
      const a = -Math.PI / 2 + i * 0.7;
      const d = pos.r + 14;
      return `<button type="button" class="cx-sat cx-sat-on" data-sat="${esc(w.id)}" title="${esc(w.label)}" style="--sx:${(Math.cos(a) * d).toFixed(1)};--sy:${(Math.sin(a) * d).toFixed(1)}">${w.icon ? `<img src="${esc(w.icon)}" alt="">` : ''}</button>`;
    }).join('');
    return `<div class="cx-item" style="--x:${pos.x.toFixed(1)};--y:${pos.y.toFixed(1)}">
      <button type="button" class="cx-node k-${n.kind}${live.length ? ' live' : ''}${n.pinned ? ' pinned' : ''}${isMissing(n) ? ' missing' : ''}${dim ? ' dim' : ''}${hit ? ' hit' : ''}"
        data-node="${esc(n.id)}" aria-label="${esc(label)}" style="--r:${pos.r.toFixed(1)};--glow:${glow.toFixed(2)};--hue:${hueOf(n.label)}">
        <span class="cx-ball">${icon ? `<img src="${esc(icon)}" alt="">` : n.kind === 'website' ? GLOBE : `<b>${esc(n.label.slice(0, 1).toUpperCase())}</b>`}</span>
        <span class="cx-label">${esc(n.label)}</span>
      </button>${sats}</div>`;
  }

  function renderProject(p) {
    const running = new Set(p.nodes.filter((n) => windowsOfNode(n).length).map((n) => n.id));
    const L = layoutProject(p, { running, recommend: opts().recommend, scale: scale() });
    const at = new Map(L.map((x) => [x.id, x]));
    // The orbits, the threads from the star, and the links.
    const rings = ringRadii(scale()).map((R) => `<ellipse class="cx-orbit" cx="0" cy="0" rx="${R}" ry="${R * 0.82}"/>`).join('');
    const spokes = L.map((x) => `<line class="cx-spoke" x1="0" y1="0" x2="${x.x.toFixed(1)}" y2="${x.y.toFixed(1)}" style="opacity:${(0.08 + x.glow * 0.25).toFixed(2)}"/>`).join('');
    const links = p.links.map(([a, b]) => {
      const A = at.get(a); const B = at.get(b);
      if (!A || !B) return '';
      const mx = (A.x + B.x) / 2 * 0.8; const my = (A.y + B.y) / 2 * 0.8;
      return `<path class="cx-link" d="M${A.x.toFixed(1)},${A.y.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${B.x.toFixed(1)},${B.y.toFixed(1)}"/>`;
    }).join('');
    svg.innerHTML = rings + spokes + links;
    // Unmatched open windows: an outer ring of small satellites.
    const used = new Set(p.nodes.flatMap((n) => windowsOfNode(n).map((w) => w.id)));
    const loose = windows().filter((w) => !used.has(w.id));
    const outer = (ringRadii(scale())[2] + 100);
    const looseHtml = loose.map((w, i) => {
      const a = Math.PI * 0.62 + (i / Math.max(loose.length, 1)) * Math.PI * 0.76;
      return `<div class="cx-item" style="--x:${(Math.cos(a) * outer).toFixed(1)};--y:${(Math.sin(a) * outer * 0.82).toFixed(1)}"><button type="button" class="cx-sat cx-loose" data-sat="${esc(w.id)}" title="${esc(w.label)} (open now)">${w.icon ? `<img src="${esc(w.icon)}" alt="">` : '<b>•</b>'}</button></div>`;
    }).join('');
    // Items in orbital order (inner orbit first, around), so Tab follows the orbits.
    const order = [...L].sort((a, b) => (a.ring === -1 ? 9 : a.ring) - (b.ring === -1 ? 9 : b.ring) || Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
    const nodes = order.map((x) => nodeHtml(p.nodes.find((n) => n.id === x.id), x, p)).join('');
    const empty = p.nodes.length ? '' : '<div class="cx-item" style="--x:0;--y:120"><p class="cx-hint">Drag files or folders here, or use + Add.</p></div>';
    layer.innerHTML = `<div class="cx-item" style="--x:0;--y:0"><button type="button" class="cx-star${p.archived ? ' archived' : ''}" data-project="${esc(p.id)}" data-state="${C.state}"
      style="--pc:${esc(p.color || COLORS[0])}" aria-label="${esc(p.name)}: resume this project (opens its saved session)"><span class="cx-core"></span><span class="cx-name">${esc(p.name)}</span></button></div>${nodes}${looseHtml}${empty}`;
  }

  function renderGalaxy() {
    const G = layoutGalaxy(C.data.projects);
    svg.innerHTML = '';
    layer.innerHTML = G.map((g) => {
      const p = project(g.id);
      const L = layoutProject(p, { recommend: opts().recommend, scale: 0.2 }).slice(0, 12);
      const dots = L.map((x) => `<span class="cx-dot k-${p.nodes.find((n) => n.id === x.id).kind}" style="--dx:${x.x.toFixed(1)};--dy:${x.y.toFixed(1)};--glow:${Math.max(0.3, x.glow).toFixed(2)}"></span>`).join('');
      const dim = C.query && !C.hits.projects.has(p.id);
      const hit = C.query && C.hits.projects.has(p.id);
      const busy = p.nodes.some((n) => windowsOfNode(n).length);
      const fresh = Math.max(0, ...p.nodes.map((n) => recency(n)));
      return `<div class="cx-item" style="--x:${g.x.toFixed(1)};--y:${g.y.toFixed(1)}"><button type="button" class="cx-proj${p.archived ? ' archived' : ''}${dim ? ' dim' : ''}${hit ? ' hit' : ''}${busy ? ' live' : ''}"
        data-project="${esc(p.id)}" style="--pc:${esc(p.color || COLORS[0])};--glow:${Math.max(0.4, fresh).toFixed(2)}" aria-label="${esc(p.name)}, ${p.nodes.length} items${p.archived ? ', archived' : ''}">
        <span class="cx-mini">${dots}</span><span class="cx-core"></span><span class="cx-name">${esc(p.name)}</span><span class="cx-count">${p.nodes.length}</span></button></div>`;
    }).join('') || '<div class="cx-item" style="--x:0;--y:0"><p class="cx-hint">No projects yet. Start one with New project.</p></div>';
  }

  function renderCrumbs() {
    const p = project();
    $('.cx-crumbs').innerHTML = `<button type="button" class="cx-crumb${C.view === 'galaxy' ? ' on' : ''}" data-act="galaxy">Galaxy</button>${C.view === 'focus' && p ? `<span>›</span><button type="button" class="cx-crumb on" data-act="rename" title="Rename">${esc(p.name)}</button>` : ''}`;
    for (const b of root.querySelectorAll('[data-act="resume"],[data-act="save"],[data-act="add"]')) b.disabled = C.view !== 'focus';
    const n = C.hits.nodes.size;
    $('.cx-found').textContent = C.query ? (n ? `${n} found` : C.hits.projects.size ? `${C.hits.projects.size} projects` : 'nothing found') : '';
  }

  // ---------- the view: zoom and pan ----------
  const size = () => ({ w: view.clientWidth || innerWidth, h: view.clientHeight || innerHeight });
  function centre() {
    const { w, h } = size();
    return C.compact ? { x: w * 0.82, y: h * 0.5 } : { x: w / 2, y: h * 0.47 };
  }
  function applyTransform() {
    const c = centre();
    world.style.transform = `translate(${(c.x + C.pan.x).toFixed(1)}px, ${(c.y + C.pan.y).toFixed(1)}px) scale(${C.zoom.toFixed(3)})`;
    drawStars();
  }
  // Zoom to show the whole project, or the whole galaxy.
  function fit(instant = false) {
    const { w, h } = size();
    let reach;
    if (C.view === 'focus') reach = (ringRadii(scale())[2] + 130);
    else {
      const G = layoutGalaxy(C.data.projects);
      reach = Math.max(260, ...G.map((g) => Math.hypot(g.x, g.y / 0.8) + 140));
    }
    const room = Math.min(w * (C.compact ? 0.16 : 0.5), h * (C.compact ? 0.4 : 0.42));
    C.zoom = Math.max(0.15, Math.min(1.2, room / reach));
    C.pan = { x: 0, y: 0 };
    world.classList.toggle('cx-instant', instant);
    applyTransform();
    if (instant) requestAnimationFrame(() => world.classList.remove('cx-instant'));
  }
  function zoomAt(f, cx, cy) {
    const before = C.zoom;
    C.zoom = Math.max(0.12, Math.min(2.5, C.zoom * f));
    // Keep the point under the pointer where it is.
    if (cx != null) {
      const c = centre();
      const k = C.zoom / before;
      C.pan.x = (cx - c.x) - ((cx - c.x) - C.pan.x) * k;
      C.pan.y = (cy - c.y) - ((cy - c.y) - C.pan.y) * k;
    }
    world.classList.add('cx-instant');
    applyTransform();
    clearTimeout(C.zoomTimer);
    C.zoomTimer = setTimeout(() => world.classList.remove('cx-instant'), 120);
    // Far enough out of a project: the galaxy.
    if (C.view === 'focus' && C.zoom < 0.32) { C.view = 'galaxy'; render(); fit(); say('Galaxy: all your projects.'); }
  }

  function focusProject(id) {
    const p = project(id);
    if (!p) return;
    C.focus = id;
    C.view = 'focus';
    render();
    fit();
    say(`${p.name}: ${p.nodes.length} items.`);
  }

  // ---------- the starfield ----------
  const canvas = $('.cx-stars');
  const stars = Array.from({ length: 240 }, () => ({ x: Math.random(), y: Math.random(), z: 0.2 + Math.random() * 0.8, t: Math.random() * 6 }));
  let raf = 0;
  function drawStars(time = performance.now()) {
    const { w, h } = size();
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const still = reduced();
    for (const s of stars) {
      // A little parallax as the map moves (none with motion off).
      const px = still ? 0 : C.pan.x * 0.04 * s.z;
      const py = still ? 0 : C.pan.y * 0.04 * s.z;
      const tw = still ? 0.7 : 0.55 + 0.45 * Math.sin(time / 1400 + s.t);
      g.globalAlpha = 0.18 + 0.5 * s.z * tw;
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(((s.x * w + px) % w + w) % w, ((s.y * h + py) % h + h) % h, s.z * 1.3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  function loop(t) {
    if (!C.running) return;
    drawStars(t);
    raf = reduced() ? 0 : setTimeout(() => requestAnimationFrame(loop), 80); // a slow twinkle: ~12 frames a second
  }

  // ---------- pointer: open, drag to link or pin, pan, zoom ----------
  const pointers = new Map();
  let drag = null;
  const worldPoint = (e) => { const r = view.getBoundingClientRect(); const c = centre(); return { x: (e.clientX - r.left - c.x - C.pan.x) / C.zoom, y: (e.clientY - r.top - c.y - C.pan.y) / C.zoom }; };
  view.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    hideMenu();
    if (pointers.size === 2) { drag = { pinch: true, d: dist2() }; return; }
    const el = e.target.closest('.cx-node, .cx-proj, .cx-star');
    drag = { el, x: e.clientX, y: e.clientY, pan: { ...C.pan }, moved: false };
    try { view.setPointerCapture(e.pointerId); } catch { /* a pointer the page can't hold */ }
  });
  const dist2 = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  view.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!drag) return;
    if (drag.pinch) { if (pointers.size === 2) { const d = dist2(); zoomAt(d / drag.d); drag.d = d; } return; }
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    drag.moved = true;
    hidePreview();
    if (!drag.el) { // the background: look around
      C.pan = { x: drag.pan.x + e.clientX - drag.x, y: drag.pan.y + e.clientY - drag.y };
      world.classList.add('cx-instant');
      applyTransform();
      return;
    }
    // An item or a project star follows the pointer.
    const item = drag.el.closest('.cx-item');
    const p = worldPoint(e);
    item.style.setProperty('--x', p.x.toFixed(1));
    item.style.setProperty('--y', p.y.toFixed(1));
    item.classList.add('cx-dragging');
    // Over another item: they'll be linked.
    const under = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.classList?.contains('cx-node') && x !== drag.el);
    for (const x of root.querySelectorAll('.cx-node.drop')) if (x !== under) x.classList.remove('drop');
    under?.classList.add('drop');
    drag.target = under || null;
  });
  view.addEventListener('pointerup', (e) => {
    pointers.delete(e.pointerId);
    const d = drag;
    drag = null;
    world.classList.remove('cx-instant');
    if (!d || d.pinch) return;
    for (const x of root.querySelectorAll('.cx-node.drop')) x.classList.remove('drop');
    if (!d.moved) { if (d.el) activate(d.el); return; }
    if (!d.el) return;
    const pt = worldPoint(e);
    if (d.el.classList.contains('cx-node')) {
      const p = project();
      const n = p?.nodes.find((x) => x.id === d.el.dataset.node);
      if (!n) return;
      if (d.target) {
        const other = p.nodes.find((x) => x.id === d.target.dataset.node);
        if (link(p, n.id, other.id)) { toast(`Connected ${n.label} and ${other.label}.`); say(`Connected ${n.label} and ${other.label}.`); }
      } else {
        // Dropped somewhere: it stays there (pinned).
        n.pinned = true;
        n.pos = { x: Math.round(pt.x / scale()), y: Math.round(pt.y / scale()) };
        say(`${n.label} pinned here.`);
      }
      saveSoon();
      render();
    } else if (d.el.dataset.project && C.view === 'galaxy') {
      const p = project(d.el.dataset.project);
      p.pos = { x: Math.round(pt.x), y: Math.round(pt.y) };
      saveSoon();
      render();
    }
  });
  view.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); drag = null; });
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = view.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  // Keyboard (and screen readers): Enter or Space on an item opens it.
  view.addEventListener('click', (e) => { if (e.detail === 0) { const el = e.target.closest('.cx-node, .cx-proj, .cx-star'); if (el) activate(el); } });
  view.addEventListener('dblclick', (e) => { if (!e.target.closest('button') && C.view === 'galaxy') { const r = view.getBoundingClientRect(); zoomAt(1.6, e.clientX - r.left, e.clientY - r.top); } });

  // What clicking does: an item opens; a project in the galaxy comes to the
  // centre; the centre star resumes the project.
  async function activate(el) {
    if (el.dataset.node) return openNode(el.dataset.node);
    if (el.classList.contains('cx-proj')) return focusProject(el.dataset.project);
    if (el.classList.contains('cx-star')) return resume();
  }
  async function openNode(id, p = project()) {
    const n = p?.nodes.find((x) => x.id === id);
    if (!n) return;
    try {
      await api.constOpen(n);
      markUsed(n);
      saveSoon();
      toast(`Opening ${n.label}…`);
      say(`Opening ${n.label}.`);
    } catch (err) { toast(errText(err)); }
  }
  async function resume() {
    const p = project();
    if (!p) return;
    let ids = (p.session || []).filter((id) => p.nodes.some((n) => n.id === id));
    if (!ids.length) ids = p.nodes.filter((n) => n.kind === 'app').slice(0, 6).map((n) => n.id);
    if (!ids.length) { toast('Nothing to resume yet: add apps, or open them and use Save session.'); return; }
    toast(`Resuming ${p.name}: ${ids.length} item${ids.length > 1 ? 's' : ''}.`);
    for (const id of ids) { await openNode(id, p); await new Promise((r) => setTimeout(r, 450)); }
  }
  // The apps open right now become this project's session (added as items when new).
  function saveSession() {
    const p = project();
    if (!p) return;
    const ids = [];
    for (const w of windows()) {
      let n = p.nodes.find((x) => windowsOfNode(x).some((y) => y.id === w.id));
      if (!n && w.exe) {
        const name = w.label.includes(' - ') ? w.label.split(' - ').pop().trim() : w.app || baseName(w.exe);
        n = newNode('app', w.exe, name);
        p.nodes.push(n);
      }
      if (n && !ids.includes(n.id)) ids.push(n.id);
    }
    p.session = ids;
    saveSoon();
    render();
    toast(ids.length ? `Saved: Resume reopens ${ids.length} app${ids.length > 1 ? 's' : ''}.` : 'No apps are open to save.');
  }

  // ---------- hover: previews ----------
  let hoverTimer = 0;
  view.addEventListener('pointerover', (e) => {
    const el = e.target.closest('.cx-node');
    if (!el || drag) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => showPreview(el), 380);
  });
  view.addEventListener('pointerout', (e) => { if (e.target.closest('.cx-node') && !e.relatedTarget?.closest?.('.cx-node')) { clearTimeout(hoverTimer); hidePreview(); } });
  view.addEventListener('focusin', (e) => { const el = e.target.closest('.cx-node'); if (el) showPreview(el); });
  async function showPreview(el) {
    const p = project();
    const n = p?.nodes.find((x) => x.id === el.dataset.node);
    if (!n) return;
    const box = $('.cx-preview');
    const live = windowsOfNode(n);
    const links = linksOf(p, n.id).map((id) => p.nodes.find((x) => x.id === id)?.label).filter(Boolean);
    box.innerHTML = `<div class="cx-pv-head"><b>${esc(n.label)}</b><span>${KINDS[n.kind].label}${n.pinned ? ' · pinned' : ''}</span></div>
      <div class="cx-pv-img"></div>
      <div class="cx-pv-path">${esc(n.target)}</div>
      <div class="cx-pv-meta">${isMissing(n) ? '<span class="cx-warn">Not there any more</span> · ' : ''}${live.length ? `${live.length} window${live.length > 1 ? 's' : ''} open · ` : ''}Opened ${n.uses || 0}× · ${ago(n.lastUsed)}${links.length ? `<br>Connected to ${esc(links.join(', '))}` : ''}</div>`;
    const r = el.getBoundingClientRect();
    const host = root.getBoundingClientRect();
    box.style.left = `${Math.min(host.width - 300, Math.max(8, r.right - host.left + 12))}px`;
    box.style.top = `${Math.min(host.height - 260, Math.max(8, r.top - host.top - 20))}px`;
    box.hidden = false;
    // A live picture of its window, or the document's own thumbnail.
    const what = live[0]?.hwnd ? { hwnd: live[0].hwnd } : n.kind === 'file' ? { path: n.target } : null;
    if (what) {
      const token = (C.previewToken = Symbol('preview'));
      const img = await api.constPreview(what).catch(() => null);
      if (img && C.previewToken === token && !box.hidden) box.querySelector('.cx-pv-img').innerHTML = `<img src="${esc(img)}" alt="">`;
    }
  }
  function hidePreview() { C.previewToken = null; $('.cx-preview').hidden = true; }

  // ---------- menus and panels ----------
  view.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.cx-node, .cx-star, .cx-proj');
    if (!el) return;
    e.preventDefault();
    hidePreview();
    const p = project(el.dataset.project) || project();
    let items = [];
    if (el.dataset.node) {
      const n = p.nodes.find((x) => x.id === el.dataset.node);
      items = [['Open', () => openNode(n.id)],
        [n.pinned ? 'Unpin (let it find its orbit)' : 'Pin it where it is', () => { n.pinned = !n.pinned; if (!n.pinned) n.pos = null; else { const it = el.closest('.cx-item'); n.pos = { x: Math.round(+it.style.getPropertyValue('--x') / scale()), y: Math.round(+it.style.getPropertyValue('--y') / scale()) }; } saveSoon(); render(); }],
        ...(linksOf(p, n.id).length ? [['Remove its connections', () => { p.links = p.links.filter(([a, b]) => a !== n.id && b !== n.id); saveSoon(); render(); }]] : []),
        ['Remove from this project', () => { removeNode(p, n.id); saveSoon(); render(); }]];
    } else {
      items = [['Open', () => focusProject(p.id)], ['Resume', () => { focusProject(p.id); resume(); }], ['Rename…', () => { focusProject(p.id); panelRename(); }],
        ['Colour', () => { p.color = COLORS[(COLORS.indexOf(p.color) + 1) % COLORS.length]; saveSoon(); render(); }],
        [p.archived ? 'Bring back (unarchive)' : 'Archive (done)', () => { p.archived = !p.archived; saveSoon(); render(); }],
        ['Delete project…', () => { if (confirm(`Delete the project "${p.name}"? Its apps and files stay where they are.`)) { C.data.projects = C.data.projects.filter((x) => x.id !== p.id); if (C.focus === p.id) { C.focus = null; C.view = 'galaxy'; } saveSoon(); render(); fit(); } }]];
    }
    showMenu(items, e.clientX, e.clientY);
  });
  function showMenu(items, x, y) {
    const m = $('.cx-menu');
    m.innerHTML = items.map(([label], i) => `<button type="button" role="menuitem" data-i="${i}">${esc(label)}</button>`).join('');
    m._items = items;
    const host = root.getBoundingClientRect();
    m.style.left = `${Math.min(host.width - 230, x - host.left)}px`;
    m.style.top = `${Math.min(host.height - items.length * 34 - 10, y - host.top)}px`;
    m.hidden = false;
    m.querySelector('button')?.focus();
  }
  function hideMenu() { $('.cx-menu').hidden = true; }
  $('.cx-menu').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b) return; const item = $('.cx-menu')._items[+b.dataset.i]; hideMenu(); item[1](); });

  function panel(kind, html) {
    const box = $('.cx-panel');
    box.dataset.kind = kind;
    box.innerHTML = `<button type="button" class="cx-close" data-act="close-panel" aria-label="Close">✕</button>${html}`;
    box.hidden = false;
    $('[data-act="list"]').setAttribute('aria-pressed', String(kind === 'list'));
    box.querySelector('input, button:not(.cx-close)')?.focus();
  }
  function closePanel() { $('.cx-panel').hidden = true; $('[data-act="list"]').setAttribute('aria-pressed', 'false'); }

  function panelNew() {
    panel('new', `<h3>New project</h3><form data-form="new"><input name="name" placeholder="What are you working on?" maxlength="60" required>
      <div class="cx-swatches">${COLORS.map((c, i) => `<label><input type="radio" name="color" value="${c}"${i === 0 ? ' checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div>
      <button type="submit" class="cx-btn on">Create</button></form>`);
  }
  function panelRename() {
    const p = project();
    if (!p) return;
    panel('rename', `<h3>Rename</h3><form data-form="rename"><input name="name" value="${esc(p.name)}" maxlength="60" required><button type="submit" class="cx-btn on">Save</button></form>`);
  }
  // Adding to a project: apps (searchable, with their icons), files and
  // folders (a dialog, or drag them in), a website, or a recent file.
  async function panelAdd(tab = 'apps') {
    const p = project();
    if (!p) return;
    const tabs = [['apps', 'Apps'], ['recent', 'Recent files'], ['web', 'Website'], ['files', 'Files'], ['folders', 'Folders']];
    panel('add', `<h3>Add to ${esc(p.name)}</h3><div class="cx-tabs">${tabs.map(([k, l]) => `<button type="button" class="cx-btn${k === tab ? ' on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div><div class="cx-tabbody"></div>`);
    const body = $('.cx-tabbody');
    if (tab === 'apps') {
      body.innerHTML = '<input class="cx-filter" placeholder="Find an app" autocomplete="off"><div class="cx-picks"><p class="cx-hint">Loading…</p></div>';
      const apps = await api.shellApps().catch(() => []);
      const draw = (q = '') => {
        const list = apps.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())).slice(0, 80);
        body.querySelector('.cx-picks').innerHTML = list.map((a) => `<button type="button" class="cx-pick" data-add-app="${esc(a.id)}" data-name="${esc(a.name)}">${C.appIcons[a.id] ? `<img src="${esc(C.appIcons[a.id])}" alt="">` : '<b></b>'}${esc(a.name)}</button>`).join('') || '<p class="cx-hint">No app matches.</p>';
      };
      draw();
      body.querySelector('.cx-filter').addEventListener('input', (e) => draw(e.target.value));
      body.querySelector('.cx-filter').focus();
    } else if (tab === 'recent') {
      body.innerHTML = '<div class="cx-picks"><p class="cx-hint">Loading…</p></div>';
      const list = (await api.constRecent().catch(() => [])).filter((r) => !p.nodes.some((n) => n.target.toLowerCase() === r.path.toLowerCase()));
      body.querySelector('.cx-picks').innerHTML = list.map((r) => `<button type="button" class="cx-pick" data-add-path="${esc(r.path)}" data-dir="${r.dir ? 1 : ''}"><b>${r.dir ? '▣' : '▤'}</b><span>${esc(baseName(r.path))}<small>${esc(r.path)} · ${ago(r.at)}</small></span></button>`).join('') || '<p class="cx-hint">No recent files.</p>';
    } else if (tab === 'web') {
      body.innerHTML = '<form data-form="web"><input name="url" placeholder="Address, e.g. example.com" required><input name="name" placeholder="Name (optional)" maxlength="60"><button type="submit" class="cx-btn on">Add website</button></form>';
      body.querySelector('input').focus();
    } else {
      const paths = await api.constPick(tab === 'folders' ? 'folder' : 'file').catch(() => []);
      addPaths(paths, tab === 'folders');
      closePanel();
    }
  }
  function addNode(kind, target, label) {
    const p = project();
    if (!p) return;
    if (p.nodes.some((n) => n.kind === kind && n.target.toLowerCase() === String(target).toLowerCase())) { toast(`${label} is already in ${p.name}.`); return; }
    p.nodes.push(newNode(kind, target, label));
    saveSoon();
    render();
    say(`${label} added to ${p.name}.`);
  }
  async function addPaths(paths, dirs = null) {
    for (const path of paths) {
      const dir = dirs ?? (await api.constPathInfo(path).catch(() => ({}))).dir;
      addNode(dir ? 'folder' : 'file', path, baseName(path));
    }
  }

  function renderList() {
    const list = C.data.projects.map((p) => `<section><h4><button type="button" class="cx-lproj" data-list-project="${esc(p.id)}">${esc(p.name)}</button>${p.archived ? ' <small>(archived)</small>' : ''} <small>${p.nodes.length} items</small></h4>
      <ul>${p.nodes.map((n) => { const links = linksOf(p, n.id).map((id) => p.nodes.find((x) => x.id === id)?.label).filter(Boolean); return `<li><button type="button" class="cx-litem${C.query && !C.hits.nodes.has(n.id) ? ' dim' : ''}" data-list-project="${esc(p.id)}" data-list-node="${esc(n.id)}">${esc(n.label)}</button> <small>${KINDS[n.kind].label}${links.length ? ` · connected to ${esc(links.join(', '))}` : ''}${isMissing(n) ? ' · missing' : ''}</small></li>`; }).join('')}</ul></section>`).join('');
    panel('list', `<h3>All projects</h3><div class="cx-listview">${list || '<p class="cx-hint">No projects yet.</p>'}</div>`);
  }

  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.dataset.form;
    const v = Object.fromEntries(new FormData(e.target));
    if (f === 'new') {
      const p = newProject(v.name, { color: v.color });
      C.data.projects.push(p);
      saveSoon();
      closePanel();
      focusProject(p.id);
      toast(`${p.name}: add apps, files and websites with + Add, or drag files in.`);
    } else if (f === 'rename') {
      project().name = String(v.name).slice(0, 60);
      saveSoon(); closePanel(); render();
    } else if (f === 'web') {
      const url = String(v.url).trim();
      const name = String(v.name || '').trim() || url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
      addNode('website', url, name);
      closePanel();
    }
  });
  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.closest('.cx-view')) return;
    const act = t.dataset.act;
    if (act === 'galaxy') { C.view = 'galaxy'; render(); fit(); say('Galaxy: all your projects.'); }
    else if (act === 'rename') panelRename();
    else if (act === 'new') panelNew();
    else if (act === 'add') panelAdd();
    else if (act === 'resume') resume();
    else if (act === 'save') saveSession();
    else if (act === 'list') { if (!$('.cx-panel').hidden && $('.cx-panel').dataset.kind === 'list') closePanel(); else renderList(); }
    else if (act === 'close-panel') closePanel();
    else if (act === 'more') {
      const r = t.getBoundingClientRect();
      showMenu([['Fit to screen', () => fit()], ['Galaxy (all projects)', () => { C.view = 'galaxy'; render(); fit(); }],
        ['Export…', async () => { const where = await api.constExport(C.data).catch((err) => toast(errText(err))); if (where) toast(`Exported to ${where}`); }],
        ['Import…', async () => { const merged = await api.constImport(C.data).catch((err) => toast(errText(err))); if (merged) { C.data = merged; render(); fit(); toast('Imported.'); } }]], r.left, r.bottom + 6);
    } else if (t.dataset.tab) panelAdd(t.dataset.tab);
    else if (t.dataset.addApp) { addNode('app', t.dataset.addApp, t.dataset.name); t.classList.add('added'); }
    else if (t.dataset.addPath) { addNode(t.dataset.dir ? 'folder' : 'file', t.dataset.addPath, baseName(t.dataset.addPath)); t.classList.add('added'); }
    else if (t.dataset.listNode) { focusProject(t.dataset.listProject); openNode(t.dataset.listNode); }
    else if (t.dataset.listProject) { closePanel(); focusProject(t.dataset.listProject); }
  });

  // ---------- search: type anywhere ----------
  const input = $('.cx-search');
  input.addEventListener('input', () => { C.query = input.value; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // The first match: an item opens (its project comes to the centre), a project is focused.
    for (const p of C.data.projects) {
      const n = p.nodes.find((x) => C.hits.nodes.has(x.id));
      if (n) { focusProject(p.id); openNode(n.id); return; }
    }
    const p = C.data.projects.find((x) => C.hits.projects.has(x.id));
    if (p) focusProject(p.id);
  });
  const onKey = (e) => {
    if (!C.running || C.compact || e.ctrlKey || e.metaKey || e.altKey) return;
    const inField = e.target.closest?.('input, textarea, select');
    // Arrows walk the items in orbital order (or the projects).
    if (!inField && ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
      const all = [...layer.querySelectorAll(C.view === 'focus' ? '.cx-star, .cx-node' : '.cx-proj')];
      if (!all.length) return;
      const i = all.indexOf(document.activeElement);
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      all[(i + step + all.length) % all.length].focus();
      e.preventDefault();
      return;
    }
    // Any letter or digit starts a search.
    if (!inField && e.key.length === 1 && e.key !== ' ') input.focus();
  };
  document.addEventListener('keydown', onKey);

  // Files dragged in from File Explorer join the project (in the galaxy: the
  // project they are dropped on).
  view.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); root.classList.add('cx-dropping'); } });
  view.addEventListener('dragleave', () => root.classList.remove('cx-dropping'));
  view.addEventListener('drop', async (e) => {
    e.preventDefault();
    root.classList.remove('cx-dropping');
    const onto = e.target.closest('.cx-proj');
    if (onto) C.focus = onto.dataset.project;
    if (!project()) { const p = newProject('New project'); C.data.projects.push(p); C.focus = p.id; }
    const paths = [...e.dataTransfer.files].map((f) => { try { return api.pathForFile(f); } catch { return null; } }).filter(Boolean);
    await addPaths(paths);
    if (C.view !== 'focus') focusProject(C.focus);
  });

  const ro = new ResizeObserver(() => { applyTransform(); });
  ro.observe(view);
  load();

  // ---------- the calls the orb offers ----------
  const at = (x, y) => { const r = root.getBoundingClientRect(); return document.elementFromPoint(r.left + ((x + 1) / 2) * r.width, r.top + ((1 - y) / 2) * r.height); };
  return {
    // Scorpion's own shortcuts (a rail) and the open windows (satellites).
    setSatellites(items) { C.items = items; render(); },
    pick: (x, y) => at(x, y)?.closest?.('[data-sat]')?.dataset.sat || null,
    pointAt(x, y) {
      for (const el of root.querySelectorAll('.hover')) el.classList.remove('hover');
      if (x == null) return null;
      const el = at(x, y)?.closest?.('[data-sat], .cx-node, .cx-proj, .cx-star');
      el?.classList.add('hover');
      return el?.dataset.sat || null;
    },
    // A hand's tap on an item, a project or the star.
    tap(x, y) { const el = at(x, y)?.closest?.('.cx-node, .cx-proj, .cx-star'); if (el) { activate(el); return true; } return false; },
    // Scorpion's state lights the centre star (listening, thinking, speaking…).
    setState(name) { C.state = name; for (const s of root.querySelectorAll('.cx-star')) s.dataset.state = name; },
    setLevel(v) { root.style.setProperty('--cx-level', String(Math.max(0, Math.min(1, v || 0)))); },
    setGaze() {},
    setAccent(color) { root.style.setProperty('--cx-accent', color); },
    setFrameCap() {},
    rotateBy(dTheta, dPhi) { C.pan.x += dTheta * 120; C.pan.y += dPhi * 120; applyTransform(); },
    zoomBy(f) { zoomAt(1 / f); },
    zoomIn: () => zoomAt(1.35),
    zoomOut: () => zoomAt(1 / 1.35),
    resetView: () => fit(),
    // An app open inside the orb: the map shrinks into the right-hand column.
    setCompact(on) { C.compact = Boolean(on); render(); fit(); },
    pulse(kind = 'info') { root.dataset.pulse = ''; void root.offsetWidth; root.dataset.pulse = kind; setTimeout(() => { root.dataset.pulse = ''; }, 2600); },
    zoomToward(id, t = 0) {
      if (!id || t <= 0) { fit(); return; }
      const el = root.querySelector(`[data-sat="${CSS.escape(id)}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect(); const v = view.getBoundingClientRect();
      zoomAt(1 + t * 0.08, r.left + r.width / 2 - v.left, r.top + r.height / 2 - v.top);
    },
    // Two fingers up or down (a scroll gesture): the next or previous item.
    spinRings(by) {
      C.spin += by * 4;
      if (Math.abs(C.spin) < 1) return;
      const all = [...layer.querySelectorAll(C.view === 'focus' ? '.cx-node' : '.cx-proj')];
      if (all.length) { const i = all.indexOf(document.activeElement); all[(i + Math.sign(C.spin) + all.length) % all.length].focus(); }
      C.spin = 0;
    },
    // Letters typed go to the search, not to the orb's one-key shortcuts.
    takesTyping: true,
    // Esc: closes a menu, panel or preview, clears the search, then goes out to
    // the galaxy; true when it did something (the orb itself stays).
    handleEscape() {
      if (!$('.cx-menu').hidden) { hideMenu(); return true; }
      if (!$('.cx-panel').hidden) { closePanel(); return true; }
      if (C.query) { C.query = ''; input.value = ''; render(); return true; }
      if (C.view === 'focus') { C.view = 'galaxy'; render(); fit(); return true; }
      return false;
    },
    focusSearch() { input.focus(); input.select(); },
    refreshSettings() { render(); },
    start() {
      if (C.running) return;
      C.running = true;
      root.hidden = false;
      applyTransform();
      requestAnimationFrame(loop);
    },
    stop() { C.running = false; clearTimeout(raf); },
    dispose() { this.stop(); ro.disconnect(); document.removeEventListener('keydown', onKey); root.remove(); },
  };
}
