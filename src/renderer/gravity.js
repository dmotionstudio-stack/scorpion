// The Scorpion taskbar: your apps as stones on a horizon along the bottom of
// the screen (gravity.html; Layout → Scorpion). Each stone is an app:
// the pinned ones and every program with a window open, a live picture of its
// window set into the rock. The app in front is the big sapphire stone, its
// windows fanned inside. Gestures:
//   click          bring the app forward (open it if it isn't running); on
//                  the app in front, its card: recent windows, or actions
//   raise (drag up)    defer: its windows step away (minimized)
//   drop (drag down)   focus: it comes forward and everything else steps away
// Dotted orbits link the stones. Underneath: OPEN (Scorpion), the rail's
// name, network, volume, battery and the clock.
import { kindOf, titleOf, ago } from './wheel-core.js';

const api = window.scorpion;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const H = 200; // the rail's design height (gravity.css), scaled to the window
const host = Boolean(window.scorpionHost);

let windows = [];
let pinned = []; // [{ id, name, icon }]
let lastUsed = new Map(); // hwnd → when it was last in front (shell:recent)
let z = 1;
let popKey = null; // the stone whose card is open
let shownKey = '';

// ---------- the stones ----------
const NAMES = { chrome: 'Chrome', msedge: 'Edge', firefox: 'Firefox', brave: 'Brave', explorer: 'File Explorer', code: 'VS Code', winword: 'Word', excel: 'Excel', powerpnt: 'PowerPoint',
  outlook: 'Outlook', olk: 'Outlook', spotify: 'Spotify', teams: 'Teams', 'ms-teams': 'Teams', notepad: 'Notepad', windowsterminal: 'Terminal', slack: 'Slack', discord: 'Discord',
  scorpion: 'Scorpion', obsidian: 'Obsidian', notion: 'Notion', figma: 'Figma', photoshop: 'Photoshop', blender: 'Blender', vlc: 'VLC', zoom: 'Zoom', whatsapp: 'WhatsApp' };
// Each kind of app has its own rock; the rest are told apart by name.
const MATERIAL = { Browser: 'slate', Document: 'pale', Mail: 'pale', Folder: 'moss', Music: 'moss', Chat: 'moss', Code: 'ember', Design: 'ember', Spreadsheet: 'ember', Slides: 'ember' };
const ROCKS = ['stone', 'moss', 'pale', 'slate', 'ember'];
const program = (w) => String(w.exe || w.appId || '').split(/[\\/]/).pop().replace(/\.(exe|desktop)$/i, '').toLowerCase() || String(w.process || '').toLowerCase();
const keyOf = (w) => String(w.exe || w.appId || w.process || w.title || '').toLowerCase();
const sameFile = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();
function appName(w) {
  const p = program(w);
  if (NAMES[p]) return NAMES[p];
  const proc = String(w.process || p || '').replace(/\.desktop$/, '').split('.').pop();
  return proc ? proc[0].toUpperCase() + proc.slice(1) : titleOf(w);
}
function materialOf(name, kind) {
  if (MATERIAL[kind]) return MATERIAL[kind];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ROCKS[h % ROCKS.length];
}
// The pinned apps (in their order), then every other program with windows;
// each with its windows, the one last in front first.
function groups() {
  const out = pinned.map((p) => ({ key: p.id.toLowerCase(), name: p.name, icon: p.icon, pin: p, wins: windows.filter((w) => sameFile(w.exe, p.id)) }));
  for (const w of windows) {
    if (out.some((g) => g.pin && sameFile(w.exe, g.pin.id))) continue;
    const k = keyOf(w);
    let g = out.find((x) => !x.pin && x.key === k);
    if (!g) out.push(g = { key: k, name: appName(w), icon: w.icon, wins: [] });
    g.wins.push(w);
  }
  for (const g of out) {
    g.wins.sort((a, b) => Number(b.active) - Number(a.active) || (lastUsed.get(b.hwnd) || 0) - (lastUsed.get(a.hwnd) || 0));
    g.active = g.wins.some((w) => w.active);
    g.kind = g.wins[0] ? kindOf(g.wins[0]) : kindOf({ exe: g.pin?.id });
    g.material = materialOf(g.name, g.kind);
  }
  return out.slice(0, 12);
}
let current = [];

function render() {
  const list = groups();
  current = list;
  // Drawn again only when the stones themselves change (so they don't
  // replay their entrance): their apps, which is in front, how many windows.
  const key = list.map((g) => `${g.key}|${g.active}|${g.wins.length}|${g.name}`).join('\n');
  if (key === shownKey) { pictures(); return; }
  shownKey = key;
  const total = windows.length || 1;
  const icon = (g) => (g.icon ? `<img src="${esc(g.icon)}" alt="">` : '');
  $('#gr-stones').innerHTML = list.map((g, i) => {
    const fan = g.wins.slice(0, 3).map((w) => `<span class="gr-card" data-pic="${esc(w.hwnd)}">${icon(g)}</span>`).join('');
    const label = `${g.name}${g.wins.length ? `, ${g.wins.length} window${g.wins.length === 1 ? '' : 's'}` : ', not open'}`;
    return `<div class="gr-stone m-${g.material}${g.active ? ' active' : ''}${g.wins.length ? '' : ' idle'}" role="listitem" tabindex="0" data-key="${esc(g.key)}" style="--i:${i}" aria-label="${esc(label)}" title="${esc(label)}">
      <div class="gr-body"><span class="gr-light"></span>
        <div class="gr-rock"><div class="gr-hole"${g.wins[0] ? ` data-pic="${esc(g.wins[0].hwnd)}"` : ''}>${icon(g)}</div><div class="gr-fan">${fan}</div></div>
        ${g.wins.length > 1 ? `<span class="gr-count" style="--p:${Math.round((100 * g.wins.length) / total)}"></span><span class="gr-count-n">${g.wins.length}</span>` : ''}
      </div>
      <span class="gr-ring"></span>
      <span class="gr-name">${esc(g.name)}</span>
    </div>`;
  }).join('');
  layout();
  pictures(true);
  if (popKey && !list.some((g) => g.key === popKey)) closePop();
}

// The stones' size and spacing for how many there are, and the orbits between them.
function layout() {
  const row = $('#gr-stones');
  const n = Math.max(1, current.length);
  document.body.classList.toggle('narrow', innerWidth / z < 1180);
  const room = row.clientWidth || innerWidth / z - 300;
  const s = Math.max(0.6, Math.min(1, room / (n * 114 + 100 + 26 * (n - 1))));
  const gap = Math.max(14, Math.min(96, (room - (n * 114 + 100) * s) / Math.max(1, n - 1)));
  row.style.setProperty('--s', s.toFixed(3));
  row.style.setProperty('--gap', `${Math.round(gap)}px`);
  drawOrbits();
  setTimeout(drawOrbits, 620); // after a stone grows or shrinks
}
// Where a stone's light is, in the scene's terms.
function lightOf(el) {
  const row = $('#gr-stones');
  const body = el.querySelector('.gr-body');
  const light = el.querySelector('.gr-light');
  return { x: row.offsetLeft + el.offsetLeft + el.offsetWidth / 2, y: row.offsetTop + el.offsetTop + body.offsetTop + light.offsetTop + 3.5 };
}
function drawOrbits() {
  const stones = [...document.querySelectorAll('.gr-stone')];
  const still = document.documentElement.dataset.perf === 'light';
  let svg = '';
  for (let i = 0; i + 1 < stones.length; i++) {
    const a = lightOf(stones[i]), b = lightOf(stones[i + 1]);
    const d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${((a.x + b.x) / 2).toFixed(1)} ${(Math.min(a.y, b.y) - 22).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    svg += `<path d="${d}"/>`;
    if (!still && i % 2 === 0) svg += `<circle r="2.2"><animateMotion dur="${7 + i}s" repeatCount="indefinite" path="${d}"/></circle>`;
  }
  $('#gr-orbits').innerHTML = svg;
}

// Live pictures of the windows, set into the stones (each asked for again
// every few seconds at most).
const pics = new Map(); // hwnd → { src, at }
function pictures(now = false) {
  const t = Date.now();
  for (const el of document.querySelectorAll('[data-pic]')) {
    const hwnd = el.dataset.pic;
    const known = pics.get(hwnd);
    if (known?.src) { el.style.backgroundImage = `url("${known.src}")`; el.classList.add('pic'); }
    if (known && t - known.at < (now ? 2000 : 8000)) continue;
    pics.set(hwnd, { src: known?.src, at: t });
    api.constPreview({ hwnd }).then((src) => {
      if (!src) return;
      pics.set(hwnd, { src, at: Date.now() });
      for (const x of document.querySelectorAll(`[data-pic="${CSS.escape(hwnd)}"]`)) { x.style.backgroundImage = `url("${src}")`; x.classList.add('pic'); }
    }).catch(() => {});
  }
}

async function refreshWindows() {
  try {
    const [next, recent] = await Promise.all([api.shellWindows(), api.shellRecent().catch(() => [])]);
    for (const w of recent) if (w.at) lastUsed.set(w.hwnd, w.at);
    windows = next;
    render();
  } catch { /* locked or busy: keep the last list */ }
}

// ---------- what a stone does ----------
const groupOf = (key) => current.find((g) => g.key === key);
const stoneOf = (key) => document.querySelector(`.gr-stone[data-key="${CSS.escape(key)}"]`);
const settle = () => setTimeout(refreshWindows, 300);
const play = (key, cls, ms) => { const el = stoneOf(key); if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); };
const launch = (g) => {
  const id = g.pin?.id || g.wins[0]?.exe;
  if (!id) return;
  play(g.key, 'launching', 1100);
  api.shellLaunch({ id, name: g.name }).catch(() => {});
};
// Forward: its windows in front, the one last used on top.
async function forward(g) {
  for (const w of [...g.wins].reverse()) await api.shellWindow({ hwnd: w.hwnd, action: 'focus' }).catch(() => {});
}
// Raised: its windows step away.
async function defer(g) {
  play(g.key, 'deferred', 700);
  for (const w of g.wins) await api.shellWindow({ hwnd: w.hwnd, action: 'minimize' }).catch(() => {});
  settle();
}
// Dropped: it comes forward and everything else steps away (Scorpion's own window stays).
async function focus(g) {
  if (!g.wins.length) { launch(g); return; }
  play(g.key, 'focused', 600);
  play(g.key, 'flare', 1300);
  for (const w of windows) if (!w.self && !g.wins.includes(w) && !w.minimized) await api.shellWindow({ hwnd: w.hwnd, action: 'minimize' }).catch(() => {});
  await forward(g);
  settle();
}
async function pick(g) {
  if (!g.wins.length) { launch(g); return; }
  if (g.active) { if (popKey === g.key) closePop(); else openPop(g); return; }
  await forward(g);
  settle();
}

// ---------- raise and drop ----------
let drag = null;
let dragged = false;
$('#gr-stones').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.gr-stone');
  if (!el || e.button !== 0) return;
  drag = { key: el.dataset.key, el, y0: e.clientY, dy: 0, moving: false };
  try { el.setPointerCapture(e.pointerId); } catch { /* gone */ }
});
$('#gr-stones').addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dy = Math.max(-72, Math.min(34, (e.clientY - drag.y0) / z));
  if (!drag.moving && Math.abs(dy) < 8) return;
  drag.moving = true;
  drag.dy = dy;
  drag.el.classList.add('dragging');
  drag.el.style.setProperty('--dy', `${dy}px`);
  // Beside the stone as it moves (above it there's no room left).
  const p = lightOf(drag.el);
  const beside = { x: p.x + drag.el.offsetWidth / 2 + 70, y: p.y + dy + 30, beside: true };
  hint('defer', dy < -10 ? beside : null);
  hint('focus', dy > 8 ? beside : null);
});
const endDrag = () => {
  const d = drag;
  drag = null;
  if (!d?.moving) return;
  dragged = true;
  d.el.classList.remove('dragging');
  d.el.style.removeProperty('--dy');
  hint('defer', null);
  hint('focus', null);
  const g = groupOf(d.key);
  if (!g) return;
  if (d.dy < -34) defer(g);
  else if (d.dy > 16) focus(g);
};
$('#gr-stones').addEventListener('pointerup', endDrag);
$('#gr-stones').addEventListener('pointercancel', endDrag);
$('#gr-stones').addEventListener('click', (e) => {
  if (dragged) { dragged = false; return; }
  const el = e.target.closest('.gr-stone');
  const g = el && groupOf(el.dataset.key);
  if (g) pick(g);
});
$('#gr-stones').addEventListener('keydown', (e) => {
  const el = e.target.closest('.gr-stone');
  const g = el && groupOf(el.dataset.key);
  if (!g) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(g); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); defer(g); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); focus(g); }
});
$('#gr-stones').addEventListener('auxclick', (e) => {
  const el = e.target.closest('.gr-stone');
  const g = el && groupOf(el.dataset.key);
  if (g && e.button === 1 && g.wins[0]) api.shellWindow({ hwnd: g.wins[0].hwnd, action: 'close' }).then(settle).catch(() => {});
});
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const el = e.target.closest('.gr-stone');
  const g = el && groupOf(el.dataset.key);
  if (g?.wins[0]) { const w = g.wins[0]; api.shellMenu({ kind: 'window', hwnd: w.hwnd, title: w.title, exe: w.exe }); return; }
  if (g?.pin) { api.shellMenu({ kind: 'pinned', id: g.pin.id, name: g.pin.name }); return; }
  if (!e.target.closest('button, .gr-pop')) api.shellMenu({ kind: 'bar' }); // an empty part: customize
});

// ---------- the handwritten hints ----------
// Over a stone (raise, drop) or the first orbit; all three the first few
// times the pointer comes onto the rail.
function hint(which, el) {
  const h = $(`#gr-hint-${which}`);
  if (!el) { h.classList.remove('on'); return; }
  const p = el instanceof Element ? lightOf(el) : el;
  h.style.left = `${p.x - h.offsetWidth / 2}px`;
  h.style.top = `${p.beside ? p.y - h.offsetHeight / 2 : p.y - h.offsetHeight - 8}px`;
  h.classList.add('on');
}
let intro = 0;
try { intro = Number(localStorage.getItem('gravity-intro') || 0); } catch { /* none */ }
$('#gr-scene').addEventListener('pointerenter', () => {
  if (intro >= 3 || drag) return;
  const stones = [...document.querySelectorAll('.gr-stone')];
  if (stones.length < 2) return;
  intro++;
  try { localStorage.setItem('gravity-intro', String(intro)); } catch { /* fine */ }
  const a = lightOf(stones[0]), b = lightOf(stones[1]);
  hint('defer', stones[0]);
  hint('orbit', { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 6 });
  hint('focus', stones.find((s) => s.classList.contains('m-ember')) || stones.at(-1));
  setTimeout(() => { if (!drag) for (const w of ['defer', 'orbit', 'focus']) hint(w, null); }, 4500);
}, { once: false });

// ---------- an app's card ----------
let tab = 'recent';
async function tall(on) {
  if (host) api.host?.({ type: 'rail', tall: on });
  else await api.shellTall?.(on).catch(() => {});
}
async function openPop(g) {
  popKey = g.key;
  setPass(false);
  await tall(true);
  const el = stoneOf(g.key);
  const pop = $('#gr-pop');
  $('#gr-pop-title').textContent = g.name;
  pop.hidden = false;
  if (el) {
    const p = lightOf(el);
    const width = pop.offsetWidth;
    const scene = $('#gr-scene');
    pop.style.left = `${Math.max(12, Math.min(scene.clientWidth - width - 12, p.x - width / 2))}px`;
    pop.style.bottom = `${scene.clientHeight - p.y + 18}px`;
  }
  showTab(tab);
}
function closePop() {
  if (!popKey) return;
  popKey = null;
  $('#gr-pop').hidden = true;
  tall(false);
}
function showTab(which) {
  tab = which;
  for (const t of document.querySelectorAll('.gr-tab')) t.setAttribute('aria-selected', String(t.dataset.tab === which));
  const g = groupOf(popKey);
  if (!g) return;
  const icon = g.icon ? `<img src="${esc(g.icon)}" alt="">` : '';
  if (which === 'recent') {
    $('#gr-pop-body').innerHTML = g.wins.map((w) => {
      const at = lastUsed.get(w.hwnd);
      const sub = w.active ? 'In front' : w.minimized ? 'Minimized' : at ? `Used ${ago(at)}` : 'Open';
      return `<button class="gr-row" data-hwnd="${esc(w.hwnd)}"><span class="gr-thumb" data-pic="${esc(w.hwnd)}">${icon}</span><span class="gr-row-text"><span class="gr-row-title">${esc(titleOf(w))}</span><span class="gr-row-sub">${esc(sub)}</span></span></button>`;
    }).join('') || '<div class="gr-empty">No windows open.</div>';
    pictures();
  } else {
    const ACTIONS = [
      ['forward', 'Bring forward', '<path d="M4 14 10 8l6 6"/>'],
      ['focus', 'Focus on it (everything else steps away)', '<circle cx="10" cy="10" r="6"/><circle cx="10" cy="10" r="1.6"/>'],
      ['defer', 'Defer (step away for now)', '<path d="M4 6l6 6 6-6"/>'],
      ['new', 'New window', '<path d="M10 4v12M4 10h12"/>'],
      ['close', 'Close all its windows', '<path d="M5 5l10 10M15 5 5 15"/>'],
    ];
    $('#gr-pop-body').innerHTML = ACTIONS.map(([id, label, path]) => `<button class="gr-row" data-act="${id}"><span class="gr-row-ico"><svg viewBox="0 0 20 20">${path}</svg></span><span class="gr-row-text"><span class="gr-row-title">${label}</span></span></button>`).join('');
  }
}
for (const t of document.querySelectorAll('.gr-tab')) t.addEventListener('click', () => showTab(t.dataset.tab));
$('#gr-pop-x').addEventListener('click', closePop);
$('#gr-pop-body').addEventListener('click', async (e) => {
  const g = groupOf(popKey);
  if (!g) return;
  const row = e.target.closest('[data-hwnd]');
  if (row) { closePop(); await api.shellWindow({ hwnd: row.dataset.hwnd, action: 'focus' }).catch(() => {}); settle(); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  closePop();
  if (act === 'forward') { await forward(g); settle(); }
  else if (act === 'focus') focus(g);
  else if (act === 'defer') defer(g);
  else if (act === 'new') launch(g);
  else if (act === 'close') { for (const w of g.wins) await api.shellWindow({ hwnd: w.hwnd, action: 'close' }).catch(() => {}); settle(); }
});
// A click anywhere else closes it.
document.addEventListener('pointerdown', (e) => { if (popKey && !e.target.closest('.gr-pop, .gr-stone.active')) closePop(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });

// ---------- clicks through the empty sky (Windows) ----------
// Only the stones, the strip underneath and an open card take the pointer;
// elsewhere the apps under the rail get it (shell.js; the pointer's moves
// still come here, to notice it reaching a stone).
let passing = null;
function setPass(on) {
  if (host || !api.shellPass || on === passing) return;
  passing = on;
  api.shellPass(on).catch(() => {});
}
document.addEventListener('mousemove', (e) => {
  if (document.body.classList.contains('rail-hidden')) { passing = null; return; }
  setPass(!popKey && !drag && !e.target.closest('.gr-stone, .gr-foot, .gr-pop'));
});

// ---------- underneath ----------
function tick() {
  $('#gr-clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s*[AaPp]\.?[Mm]\.?$/, '');
}
async function refreshTray() {
  const t = await api.shellTray().catch(() => ({}));
  for (const id of ['#gr-signal', '#gr-wifi']) {
    $(id).classList.toggle('off', !t.network);
    $(id).title = t.network ? `Connected: ${t.network}` : 'Not connected';
  }
  const has = typeof t.battery === 'number';
  $('#gr-battery').hidden = !has;
  if (has) {
    $('#gr-battery-pct').textContent = `${t.battery}%`;
    $('#gr-battery-fill').style.width = `${t.battery}%`;
    $('#gr-battery-knob').style.left = `${t.battery}%`;
    $('#gr-battery').title = `Battery ${t.battery}%${t.charging ? ', charging' : ''}`;
    $('#gr-battery').classList.toggle('low', t.battery <= 15 && !t.charging);
  }
}
$('#gr-open').addEventListener('click', () => (api.shellShow ? api.shellShow('desktop') : api.shellWheel({ open: true })));
$('#gr-clock').addEventListener('click', () => api.shellMenu({ kind: 'clock' }));
$('#gr-volume').addEventListener('click', () => (host ? api.host({ type: 'panel', name: 'quick', section: 'sound' }) : api.shellVolume('mute')));
$('#gr-volume').addEventListener('wheel', (e) => { e.preventDefault(); api.shellVolume(e.deltaY < 0 ? 'up' : 'down'); }, { passive: false });
if (host) for (const id of ['#gr-signal', '#gr-wifi']) $(id).addEventListener('click', () => api.host({ type: 'panel', name: 'quick', section: 'network' }));

// ---------- settings, size, auto-hide ----------
// How tall the rail is on this screen (shell.js says the same for its window).
const railHeight = () => Math.round(Math.min(200, Math.max(140, screen.height * 0.19)));
async function applySettings(settings) {
  const s = settings || (await api.state().catch(() => null))?.settings;
  if (!s) return;
  if (s.theme) document.documentElement.dataset.theme = s.theme;
  // Scorpion OS: the shell host places and hides the rail, and swaps back
  // to the edge rail when another layout is chosen.
  if (host) {
    if ((s.taskbar?.layout || 'gravity') !== 'gravity') { api.host({ type: 'rail', page: 'edge.html' }); return; }
    api.host({ type: 'rail', autoHide: s.taskbar?.autoHide === true, edge: 'bottom', thickness: railHeight() });
  }
  pinned = await api.shellPinned().catch(() => pinned);
  shownKey = '';
  render();
}
function fit() {
  if (popKey) return; // the window is taller while a card is open
  z = Math.max(0.5, Math.min(1.5, innerHeight / H));
  document.documentElement.style.setProperty('--z', z.toFixed(4));
  layout();
}
addEventListener('resize', fit);
api.onSettingsChanged?.((s) => applySettings(s));
const setHidden = (hidden) => { document.body.classList.toggle('rail-hidden', Boolean(hidden)); passing = null; if (hidden) closePop(); };
api.onRail?.(({ hidden } = {}) => setHidden(hidden));
window.scorpionRail = setHidden;
fit();
applySettings();
tick();
refreshWindows();
refreshTray();
setInterval(tick, 1000);
setInterval(refreshTray, 30_000);
const POLL = { full: 1500, balanced: 2500, light: 4000 };
let poll = setInterval(refreshWindows, POLL.full);
const setPerf = (level) => {
  document.documentElement.dataset.perf = level;
  clearInterval(poll);
  poll = setInterval(refreshWindows, POLL[level] || POLL.full);
  drawOrbits();
};
api.state().then((st) => setPerf(st?.perf || 'full')).catch(() => {});
api.onPerfChanged?.(setPerf);
