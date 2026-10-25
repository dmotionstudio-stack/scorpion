// The summon dot and the intent wheel. The dot sits in the bottom-left corner;
// clicking it (or Win+Shift+Space, which opens the wheel where the pointer is)
// opens the wheel: six intents around Scorpion's button (Write, Browse, Talk,
// Create, Files, Focus) and the windows you used last around the outside.
// Flick from anywhere on the wheel toward an intent to act, or click one;
// click a window to bring it back; right-click an intent to choose what it
// opens. Esc, a click outside or switching away closes it.
import { INTENTS, SEGMENT, segmentAt, flick, centreOf, ago, kindOf, titleOf, ringSlots, polar, sectorPath } from './wheel-core.js';

const api = window.scorpion;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const R_IN = 78; // the centre button's edge
const R_OUT = 232; // the intents' outer edge
const R_CARD = 345; // where the recent windows sit
const EXTENT = 425; // the whole wheel, cards included, from its centre

const ICONS = {
  write: '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z"/><path d="M14 3.5v4h4"/><path d="M9.5 11.5h6M9.5 14.5h6M9.5 17.5h4"/>',
  browse: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5z"/>',
  talk: '<path d="M12 4c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7c-1 0-2-.1-2.9-.4L5 19.5l1.2-3.6C4.5 14.6 3.5 12.9 3.5 11 3.5 7.1 7.3 4 12 4z"/><circle cx="8.5" cy="11" r=".6"/><circle cx="12" cy="11" r=".6"/><circle cx="15.5" cy="11" r=".6"/>',
  create: '<path d="M14.5 5.5l4 4L9 19l-4.5.5L5 15z"/><path d="M12.5 7.5l4 4"/>',
  files: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 10h17"/>',
  focus: '<path d="M19.5 12a7.5 7.5 0 1 1-3-6"/><circle cx="12" cy="12" r="3.2"/><path d="M16.5 3.5v3h3"/>',
};

const W = { open: false, centre: { x: 0, y: 0 }, scale: 1, recent: [], intents: {}, hover: null, press: null, focusIdx: -1 };

// The fixed artwork: the glass ring, the six segments and the flick arrow.
function drawArt() {
  const seg = INTENTS.map((it, i) => `<path class="sm-seg" data-seg="${it.id}" d="${sectorPath(i * SEGMENT, (i + 1) * SEGMENT, R_IN + 6, R_OUT, 7)}"/>`).join('');
  const ticks = Array.from({ length: 72 }, (_, i) => { const a = polar(i * 5, 252), b = polar(i * 5, i % 3 ? 256 : 260); return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`; }).join('');
  $('#sm-art').innerHTML = `
    <defs>
      <radialGradient id="sm-glass" cx="0" cy="0" r="${R_OUT}" gradientUnits="userSpaceOnUse">
        <stop offset=".35" stop-color="rgba(120,150,200,.10)"/><stop offset="1" stop-color="rgba(120,150,200,.26)"/>
      </radialGradient>
      <radialGradient id="sm-hot" cx="0" cy="0" r="${R_OUT}" gradientUnits="userSpaceOnUse">
        <stop offset=".3" class="sm-hot-a"/><stop offset="1" class="sm-hot-b"/>
      </radialGradient>
      <marker id="sm-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="sm-head"/></marker>
    </defs>
    <circle class="sm-halo" r="300"/>
    <circle class="sm-track" r="${R_OUT + 22}"/>
    <g class="sm-ticks">${ticks}</g>
    <g class="sm-arcs" id="sm-arcs"></g>
    <g class="sm-segs">${seg}</g>
    <line class="sm-arrow" id="sm-arrow" x1="0" y1="0" x2="0" y2="0" marker-end="url(#sm-head)"/>`;
  $('#sm-layer').innerHTML = INTENTS.map((it, i) => {
    const p = polar(centreOf(it.id), (R_IN + R_OUT) / 2 + 4);
    return `<button class="sm-intent" data-intent="${it.id}" style="left:${p.x + EXTENT}px;top:${p.y + EXTENT}px" aria-keyshortcuts="${i + 1}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[it.id]}</svg><span>${it.label}</span></button>`;
  }).join('') + '<div class="sm-cards" id="sm-cards"></div>';
}

function setHover(id) {
  if (W.hover === id) return;
  W.hover = id;
  for (const el of document.querySelectorAll('[data-seg]')) el.classList.toggle('hot', el.dataset.seg === id);
  for (const el of document.querySelectorAll('[data-intent]')) el.classList.toggle('hot', el.dataset.intent === id);
  if (id) $('#sm-hint').textContent = `${INTENTS.find((i) => i.id === id).label}${W.intents[id] ? `: ${W.intents[id]}` : ''}`;
  else $('#sm-hint').textContent = 'Flick toward an intent, or click one';
}

// The recent windows on the outer ring, with a live picture of each.
function renderCards() {
  const slots = ringSlots(W.recent.length);
  $('#sm-cards').innerHTML = W.recent.map((w, i) => {
    const s = slots[i];
    const p = polar(s.angle, R_CARD);
    const icon = w.icon ? `<img class="sm-card-icon" src="${esc(w.icon)}" alt="">` : '';
    return `<button class="sm-card" data-hwnd="${esc(w.hwnd)}" style="left:${p.x + EXTENT}px;top:${p.y + EXTENT}px;--tilt:${s.tilt}deg;--i:${i}" title="${esc(w.title)}">
      <span class="sm-thumb" data-thumb="${esc(w.hwnd)}"></span>
      <span class="sm-card-text"><span class="sm-card-title">${icon}${esc(titleOf(w))}</span><span class="sm-card-sub">${esc(kindOf(w))} · ${w.at ? ago(w.at) : 'open'}</span></span>
    </button>`;
  }).join('');
  // A short glowing arc beside each window, like a moon's orbit.
  $('#sm-arcs').innerHTML = slots.map((s) => {
    const a = polar(s.angle - 13, R_OUT + 40), b = polar(s.angle + 13, R_OUT + 40);
    return `<path d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${R_OUT + 40} ${R_OUT + 40} 0 0 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}"/>`;
  }).join('');
  for (const w of W.recent) {
    api.constPreview({ hwnd: w.hwnd }).then((src) => {
      const el = document.querySelector(`[data-thumb="${CSS.escape(w.hwnd)}"]`);
      if (el && src) el.style.backgroundImage = `url("${src}")`;
    }).catch(() => {});
  }
}

function place() {
  const vw = innerWidth, vh = innerHeight;
  W.scale = Math.min(1, (Math.min(vw, vh) / 2 - 12) / EXTENT);
  const half = EXTENT * W.scale;
  const x = Math.min(Math.max(W.centre.x, half), vw - half);
  const y = Math.min(Math.max(W.centre.y, half), vh - half);
  const el = $('#sm-wheel');
  el.style.left = `${x - EXTENT}px`;
  el.style.top = `${y - EXTENT}px`;
  el.style.setProperty('--scale', W.scale);
}

async function open(centre) {
  W.centre = centre || { x: innerWidth / 2, y: innerHeight / 2 };
  W.open = true;
  W.focusIdx = -1;
  setHover(null);
  W.recent = [];
  renderCards();
  place();
  document.body.classList.add('open');
  requestAnimationFrame(() => document.body.classList.add('shown'));
  $('#sm-sr').textContent = 'Intent wheel open. Arrow keys choose, Enter opens, Escape closes.';
  const [recent, intents] = await Promise.all([api.shellRecent().catch(() => []), api.shellIntents().catch(() => ({}))]);
  if (!W.open) return;
  W.recent = recent;
  W.intents = intents;
  for (const el of document.querySelectorAll('[data-intent]')) el.title = `${INTENTS.find((i) => i.id === el.dataset.intent).label}: ${intents[el.dataset.intent] || ''}`;
  renderCards();
}

let closing = 0;
function close() {
  if (!W.open) return;
  W.open = false;
  W.press = null;
  document.body.classList.remove('shown');
  clearTimeout(closing);
  closing = setTimeout(() => { if (!W.open) { document.body.classList.remove('open'); api.shellWheel({ open: false }); } }, 170);
}

function act(id) {
  if (!id) return;
  setHover(id);
  $(`[data-intent="${id}"]`)?.classList.add('fired');
  setTimeout(() => { close(); api.shellIntent(id).catch(() => {}); }, 120);
}

// Where a pointer is, relative to the wheel's centre, in wheel units.
const fromCentre = (e) => {
  const r = $('#sm-wheel').getBoundingClientRect();
  return { x: (e.clientX - (r.left + r.width / 2)) / W.scale, y: (e.clientY - (r.top + r.height / 2)) / W.scale };
};
const arrow = (d) => {
  const len = Math.hypot(d.x, d.y);
  const k = len ? Math.min(R_OUT - 30, Math.max(R_IN + 20, len)) / len : 0;
  const a = $('#sm-arrow');
  a.setAttribute('x2', (d.x * k).toFixed(1));
  a.setAttribute('y2', (d.y * k).toFixed(1));
  a.classList.toggle('on', Boolean(len));
};

const wheel = $('#sm-wheel');
wheel.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.sm-card')) return;
  const p = fromCentre(e);
  if (Math.hypot(p.x, p.y) > R_OUT + 30) return;
  W.press = { x: p.x, y: p.y, dragging: false };
  try { wheel.setPointerCapture(e.pointerId); } catch { /* gone */ }
});
wheel.addEventListener('pointermove', (e) => {
  const p = fromCentre(e);
  if (!W.press) { setHover(Math.hypot(p.x, p.y) <= R_OUT ? segmentAt(p.x, p.y, R_IN) : null); return; }
  const d = { x: p.x - W.press.x, y: p.y - W.press.y };
  if (Math.hypot(d.x, d.y) > 14) W.press.dragging = true;
  if (W.press.dragging) { setHover(flick(d.x, d.y, 14)); arrow(d); }
});
wheel.addEventListener('pointerup', (e) => {
  const press = W.press;
  W.press = null;
  arrow({ x: 0, y: 0 });
  if (!press) return;
  const p = fromCentre(e);
  if (press.dragging) { act(flick(p.x - press.x, p.y - press.y)); return; }
  if (Math.hypot(p.x, p.y) < R_IN) { act('home'); return; }
  act(segmentAt(p.x, p.y, R_IN));
});
wheel.addEventListener('pointercancel', () => { W.press = null; arrow({ x: 0, y: 0 }); });
wheel.addEventListener('pointerleave', () => { if (!W.press) setHover(null); });
// Keyboard: Enter or Space on a focused intent, the centre or a window.
wheel.addEventListener('click', (e) => {
  const card = e.target.closest('[data-hwnd]');
  if (card) { close(); api.shellWindow({ hwnd: card.dataset.hwnd, action: 'focus' }).catch(() => {}); return; }
  if (e.detail !== 0) return; // pointer clicks are handled above
  const b = e.target.closest('[data-intent]');
  if (b) act(b.dataset.intent);
  else if (e.target.closest('#sm-core')) act('home');
});
wheel.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const p = fromCentre(e);
  const id = e.target.closest('[data-intent]')?.dataset.intent || (Math.hypot(p.x, p.y) <= R_OUT ? segmentAt(p.x, p.y, R_IN) : null);
  if (id) api.shellMenu({ kind: 'intent', id });
});
$('#sm-backdrop').addEventListener('pointerdown', close);
$('#sm-dot').addEventListener('click', () => (W.open ? close() : api.shellWheel({ open: true })));

document.addEventListener('keydown', (e) => {
  if (!W.open) return;
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  const n = Number(e.key);
  if (n >= 1 && n <= INTENTS.length) { act(INTENTS[n - 1].id); return; }
  // Arrow keys walk round the wheel, clockwise or back.
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (step) {
    e.preventDefault();
    W.focusIdx = (W.focusIdx + step + INTENTS.length) % INTENTS.length;
    if (W.focusIdx < 0) W.focusIdx = 0;
    const id = INTENTS[W.focusIdx].id;
    setHover(id);
    $(`[data-intent="${id}"]`).focus();
  }
});

api.onWheelOpen?.((centre) => { clearTimeout(closing); open(centre); });
api.onWheelClose?.(() => close());
api.onSettingsChanged?.((s) => { if (s?.theme) document.documentElement.dataset.theme = s.theme; });
api.onPerfChanged?.((level) => { document.documentElement.dataset.perf = level; });
api.state().then((st) => {
  if (st?.settings?.theme) document.documentElement.dataset.theme = st.settings.theme;
  document.documentElement.dataset.perf = st?.perf || 'full';
}).catch(() => {});
addEventListener('resize', () => { if (W.open) place(); });
drawArt();
