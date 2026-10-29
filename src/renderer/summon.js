// The summon dot and the intent wheel. The dot sits in the bottom-left corner;
// clicking it (or Win+Shift+Space, which opens the wheel where the pointer is)
// opens the wheel: six intents around Scorpion's button (Write, Browse, Talk,
// Create, Files, Focus) and the windows you used last around the outside.
// Flick from anywhere on the wheel toward an intent to act, or click one;
// click a window to bring it back; right-click an intent to choose what it
// opens. Esc, a click outside or switching away closes it.
import { INTENTS, SEGMENT, segmentAt, flick, centreOf, ago, kindOf, titleOf, polar, tilePath, tileSlots, glowOf } from './wheel-core.js';

const api = window.scorpion;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const R_IN = 78; // the centre button's edge
const R_OUT = 232; // the intents' outer edge
const R_TILE = [280, 412]; // the recent windows' tiles on the outer ring
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

// The fixed artwork: the dark disc the windows sit on, the rounded glass
// segments, the dark centre's blue rim and the flick arrow.
function drawArt() {
  const seg = INTENTS.map((it, i) => `<path class="sm-seg" data-seg="${it.id}" style="--i:${i}" d="${tilePath(i * SEGMENT, (i + 1) * SEGMENT, R_IN + 8, R_OUT, 11, 18)}"/>`).join('');
  const rims = INTENTS.map((it, i) => { const r = R_OUT - 3, a = polar(i * SEGMENT + 9, r), b = polar((i + 1) * SEGMENT - 9, r); return `<path class="sm-rim-lit" data-seg-rim="${it.id}" style="--i:${i}" d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${r} ${r} 0 0 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}"/>`; }).join('');
  const ticks = Array.from({ length: 120 }, (_, i) => { const a = polar(i * 3, 258), b = polar(i * 3, i % 5 ? 261 : 264); return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`; }).join('');
  $('#sm-art').innerHTML = `
    <defs>
      <radialGradient id="sm-glass" cx="0" cy="0" r="${R_OUT}" gradientUnits="userSpaceOnUse">
        <stop offset=".35" stop-color="rgba(20,36,60,.92)"/><stop offset=".72" stop-color="rgba(36,62,98,.92)"/><stop offset="1" stop-color="rgba(70,108,156,.94)"/>
      </radialGradient>
      <radialGradient id="sm-hot" cx="0" cy="0" r="${R_OUT}" gradientUnits="userSpaceOnUse">
        <stop offset=".35" class="sm-hot-a"/><stop offset=".75" class="sm-hot-m"/><stop offset="1" class="sm-hot-b"/>
      </radialGradient>
      <linearGradient id="sm-sheen" x1="0" y1="${-R_OUT}" x2="0" y2="${R_OUT}" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="rgba(255,255,255,.1)"/><stop offset=".45" stop-color="rgba(255,255,255,.02)"/><stop offset=".55" stop-color="rgba(255,255,255,0)"/>
      </linearGradient>
      <marker id="sm-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="sm-head"/></marker>
    </defs>
    <circle class="sm-halo" r="${R_TILE[1] + 10}"/>
    <circle class="sm-rim" r="${R_TILE[0] - 16}"/>
    <g class="sm-ticks">${ticks}</g>
    <g class="sm-tiles" id="sm-tiles"></g>
    <g class="sm-arcs" id="sm-arcs"></g>
    <circle class="sm-bed" r="${R_OUT + 6}"/>
    <g class="sm-segs">${seg}</g>
    <path class="sm-sheen" d="${INTENTS.map((_, i) => tilePath(i * SEGMENT, (i + 1) * SEGMENT, R_IN + 8, R_OUT, 11, 18)).join(' ')}"/>
    <g class="sm-rims">${rims}</g>
    <circle class="sm-core-ring" r="${R_IN - 2}"/>
    <line class="sm-arrow" id="sm-arrow" x1="0" y1="0" x2="0" y2="0" marker-end="url(#sm-head)"/>`;
  $('#sm-layer').innerHTML = INTENTS.map((it, i) => {
    const p = polar(centreOf(it.id), (R_IN + R_OUT) / 2 + 6);
    return `<button class="sm-intent" data-intent="${it.id}" style="left:${p.x + EXTENT}px;top:${p.y + EXTENT}px;--i:${i}" aria-keyshortcuts="${i + 1}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[it.id]}</svg><span>${it.label}</span></button>`;
  }).join('') + '<div class="sm-cards" id="sm-cards"></div>';
}

function setHover(id) {
  if (W.hover === id) return;
  W.hover = id;
  for (const el of document.querySelectorAll('[data-seg]')) el.classList.toggle('hot', el.dataset.seg === id);
  for (const el of document.querySelectorAll('[data-seg-rim]')) el.classList.toggle('hot', el.dataset.segRim === id);
  for (const el of document.querySelectorAll('[data-intent]')) el.classList.toggle('hot', el.dataset.intent === id);
  if (id) $('#sm-hint').textContent = `${INTENTS.find((i) => i.id === id).label}${W.intents[id] ? `: ${W.intents[id]}` : ''}`;
  else $('#sm-hint').textContent = 'Flick toward an intent, click one, or type to search';
}

// The recent windows: glass cards on the outer ring, each with a live
// picture of the window on top and its name and when it was last used under
// it, turned a little along the ring, and a short arc glowing in its kind's
// colour. CARD: the card's size and the picture's height (wheel units).
const CARD = { w: 158, h: 138, pic: 84 };
function renderCards() {
  const slots = tileSlots(W.recent.length);
  const [r0, r1] = R_TILE;
  const mid = (r0 + r1) / 2;
  const { w: cw, h: ch, pic } = CARD;
  $('#sm-tiles').innerHTML = W.recent.map((w, i) => {
    const s = slots[i];
    const c = polar(s.angle, mid);
    return `<g class="sm-tile" data-hwnd="${esc(w.hwnd)}" style="--i:${i}">
      <g transform="translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) rotate(${s.tilt})">
        <clipPath id="sm-clip-${i}"><rect x="${-cw / 2 + 6}" y="${-ch / 2 + 6}" width="${cw - 12}" height="${pic}" rx="11"/></clipPath>
        <rect class="sm-tile-bed" x="${-cw / 2}" y="${-ch / 2}" width="${cw}" height="${ch}" rx="16"/>
        <rect class="sm-tile-pic" x="${-cw / 2 + 6}" y="${-ch / 2 + 6}" width="${cw - 12}" height="${pic}" rx="11"/>
        <image data-thumb="${esc(w.hwnd)}" clip-path="url(#sm-clip-${i})" x="${-cw / 2 + 6}" y="${-ch / 2 + 6}" width="${cw - 12}" height="${pic}" preserveAspectRatio="xMidYMid slice"/>
        <rect class="sm-tile-edge" x="${-cw / 2}" y="${-ch / 2}" width="${cw}" height="${ch}" rx="16"/>
      </g>
    </g>`;
  }).join('');
  // The names: under each picture, turned with its card.
  const under = ch / 2 - (ch - pic - 6) / 2;
  $('#sm-cards').innerHTML = W.recent.map((w, i) => {
    const s = slots[i];
    const c = polar(s.angle, mid);
    const t = (s.tilt * Math.PI) / 180;
    const p = { x: c.x - Math.sin(t) * under, y: c.y + Math.cos(t) * under };
    const icon = w.icon ? `<img class="sm-card-icon" src="${esc(w.icon)}" alt="">` : '';
    return `<button class="sm-card" data-hwnd="${esc(w.hwnd)}" style="left:${(p.x + EXTENT).toFixed(1)}px;top:${(p.y + EXTENT).toFixed(1)}px;--tilt:${s.tilt}deg;--i:${i}" title="${esc(w.title)}">
      <span class="sm-card-title">${icon}${esc(titleOf(w))}</span><span class="sm-card-sub">${esc(kindOf(w))} · ${w.at ? ago(w.at) : 'open'}</span>
    </button>`;
  }).join('');
  // A glowing arc along each tile's inner edge, in its kind's colour.
  $('#sm-arcs').innerHTML = slots.map((s, i) => {
    const r = r0 - 9;
    const a = polar(s.angle - s.span / 2 + 5, r), b = polar(s.angle + s.span / 2 - 5, r);
    const glow = glowOf(kindOf(W.recent[i]));
    return `<path style="--i:${i}${glow ? `;--glow:${glow}` : ''}" d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${r} ${r} 0 0 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}"/>`;
  }).join('');
  // A tile and its name light up together.
  for (const el of document.querySelectorAll('#sm-tiles [data-hwnd], #sm-cards [data-hwnd]')) {
    const both = () => document.querySelectorAll(`[data-hwnd="${CSS.escape(el.dataset.hwnd)}"]`);
    el.addEventListener('pointerenter', () => { for (const x of both()) x.classList.add('hot'); });
    el.addEventListener('pointerleave', () => { for (const x of both()) x.classList.remove('hot'); });
  }
  for (const w of W.recent) {
    api.constPreview({ hwnd: w.hwnd }).then((src) => {
      const el = document.querySelector(`image[data-thumb="${CSS.escape(w.hwnd)}"]`);
      if (el && src) el.setAttribute('href', src);
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
  // Opened from the dot: the wheel grows out of it and shrinks back into it.
  const dot = W.centre.dot;
  document.body.classList.toggle('from-dot', Boolean(dot));
  if (dot) {
    const ox = dot.x - (x - EXTENT), oy = dot.y - (y - EXTENT);
    el.style.transformOrigin = `${ox}px ${oy}px`;
    // Scaled down on a small screen, it would also slide toward the dot: this
    // keeps its centre where it was placed.
    el.style.setProperty('--fix-x', `${(1 - W.scale) * (EXTENT - ox)}px`);
    el.style.setProperty('--fix-y', `${(1 - W.scale) * (EXTENT - oy)}px`);
    const d = $('#sm-dot');
    d.style.left = `${dot.x}px`;
    d.style.top = `${dot.y - 32}px`; // its margin centres it sideways only
    d.style.bottom = 'auto';
  } else el.style.transformOrigin = '';
}

async function open(centre) {
  W.centre = centre && Number.isFinite(centre.x) ? centre : { x: innerWidth / 2, y: innerHeight / 2, dot: centre?.dot };
  // Frosted glass: the screen as it was, blurred behind the wheel (shell.js sends it).
  const shot = centre?.backdrop;
  const bd = $('#sm-backdrop');
  bd.classList.toggle('frosted', Boolean(shot?.src));
  if (shot?.src) {
    bd.style.setProperty('--shot', `url("${shot.src}")`);
    bd.style.setProperty('--shot-size', `${shot.w}px ${shot.h}px`);
  } else bd.style.removeProperty('--shot');
  W.open = true;
  W.focusIdx = -1;
  setHover(null);
  W.recent = [];
  renderCards();
  place();
  api.host?.({ type: 'wheel', open: true }); // the native shell host: the whole screen
  document.body.classList.add('open');
  requestAnimationFrame(() => document.body.classList.add('shown'));
  $('#sm-sr').textContent = 'Intent wheel open. Arrow keys choose, Enter opens, Escape closes.';
  const [recent, intents] = await Promise.all([api.shellRecent().catch(() => []), api.shellIntents().catch(() => ({}))]);
  if (!W.open) return;
  W.recent = recent.slice(0, 5); // five tiles fit the ring above the hint
  W.intents = intents;
  // Named for screen readers; the hint under the wheel says the same on hover.
  for (const el of document.querySelectorAll('[data-intent]')) el.setAttribute('aria-label', `${INTENTS.find((i) => i.id === el.dataset.intent).label}: ${intents[el.dataset.intent] || ''}`);
  renderCards();
}

let closing = 0;
function close() {
  if (!W.open) return;
  W.open = false;
  W.press = null;
  document.body.classList.remove('shown');
  clearTimeout(closing);
  closing = setTimeout(() => {
    if (W.open) return;
    document.body.classList.remove('open');
    // Back to its corner in the small window (the dot was placed for the big one).
    const d = $('#sm-dot');
    d.style.left = d.style.top = d.style.bottom = '';
    api.host?.({ type: 'wheel', open: false });
    api.shellWheel({ open: false });
  }, 200);
}

function act(id) {
  if (!id) return;
  setHover(id);
  $(`[data-intent="${id}"]`)?.classList.add('fired');
  $(`[data-seg="${id}"]`)?.classList.add('fired');
  setTimeout(() => { close(); api.shellIntent(id).catch(() => {}); }, 160);
}
// A recent window: its card swells toward you as the window comes forward.
function bringBack(card) {
  for (const el of document.querySelectorAll(`[data-hwnd="${CSS.escape(card.dataset.hwnd)}"]`)) el.classList.add('launch');
  setTimeout(() => { close(); api.shellWindow({ hwnd: card.dataset.hwnd, action: 'focus' }).catch(() => {}); }, 170);
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
  if (e.button !== 0 || e.target.closest('[data-hwnd]')) return;
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
  if (card) { bringBack(card); return; }
  if (e.target.closest('#sm-stage')) { toggleStage(); return; }
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
// The dot: a click opens the wheel; dragged, it follows the pointer and stays
// where it's dropped (main keeps the spot). On Windows the dot's window moves
// under the pointer (screen terms); on Scorpion OS the page moves the host's
// panel, which carries the pointer along, so each move counts from the press.
const dotEl = $('#sm-dot');
let dotDrag = null;
let dragged = false;
dotEl.addEventListener('pointerdown', (e) => {
  if (W.open || e.button !== 0 || !api.shellDot) return;
  dotDrag = { sx: e.screenX, sy: e.screenY, cx: e.clientX, cy: e.clientY, moved: false, at: null, frame: 0 };
  try { dotEl.setPointerCapture(e.pointerId); } catch { /* gone */ }
  api.shellDot({ phase: 'get' }).then((c) => { if (dotDrag) dotDrag.at = c; }).catch(() => {});
});
const keepOnScreen = (p, at) => {
  const half = at.size / 2;
  return { x: Math.min(Math.max(p.x, half), at.w - half), y: Math.min(Math.max(p.y, half), at.h - half) };
};
const hostDot = (p, at) => api.host?.({ type: 'dot', left: Math.round(p.x - at.size / 2), bottom: Math.round(at.h - p.y - at.size / 2) });
dotEl.addEventListener('pointermove', (e) => {
  const d = dotDrag;
  if (!d?.at) return;
  const inHost = Boolean(window.scorpionHost);
  const dx = inHost ? e.clientX - d.cx : e.screenX - d.sx;
  const dy = inHost ? e.clientY - d.cy : e.screenY - d.sy;
  if (!d.moved && Math.hypot(dx, dy) < 6) return;
  d.moved = true;
  dotEl.classList.add('dragging');
  if (d.frame) return; // one move a frame (about 60 a second)
  d.frame = setTimeout(() => {
    d.frame = 0;
    if (inHost) {
      d.at = { ...d.at, ...keepOnScreen({ x: d.at.x + dx, y: d.at.y + dy }, d.at) };
      hostDot(d.at, d.at);
    } else {
      d.to = { x: d.at.x + dx, y: d.at.y + dy };
      api.shellDot({ phase: 'move', ...d.to }).catch(() => {});
    }
  }, 16);
});
const endDrag = async (e) => {
  const d = dotDrag;
  dotDrag = null;
  if (!d?.moved) return;
  dragged = true; // the click that follows isn't one
  dotEl.classList.remove('dragging');
  const inHost = Boolean(window.scorpionHost);
  const to = inHost ? d.at : { x: d.at.x + (e.screenX - d.sx), y: d.at.y + (e.screenY - d.sy) };
  const kept = await api.shellDot({ phase: 'end', x: to.x, y: to.y }).catch(() => null);
  if (inHost && kept) hostDot(kept, d.at);
};
dotEl.addEventListener('pointerup', endDrag);
dotEl.addEventListener('pointercancel', endDrag);
dotEl.addEventListener('click', () => {
  if (dragged) { dragged = false; return; }
  if (W.open) close(); else api.shellWheel({ open: true });
});
dotEl.title = 'Summon the intent wheel (Win+Shift+Space opens it where your pointer is). Drag it to put it anywhere';

document.addEventListener('keydown', (e) => {
  if (!W.open) return;
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  const n = Number(e.key);
  if (n >= 1 && n <= INTENTS.length) { act(INTENTS[n - 1].id); return; }
  // Typing a letter searches everything Scorpion can do (the command palette).
  if (/^\p{L}$/u.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); close(); api.shellPalette(e.key); return; }
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

// Stage (Windows): on or off from the wheel.
function showStage(on) {
  $('#sm-stage').setAttribute('aria-pressed', String(Boolean(on)));
  $('#sm-stage-text').textContent = on ? 'Stage on' : 'Stage';
}
async function toggleStage() {
  const on = $('#sm-stage').getAttribute('aria-pressed') !== 'true';
  showStage(on);
  try { showStage(await api.shellStage(on)); } catch { showStage(!on); }
  $('#sm-hint').textContent = on ? 'Stage on: touch the left edge of the screen for your windows' : 'Stage off';
}

api.onWheelOpen?.((centre) => { clearTimeout(closing); open(centre); });
api.onWheelClose?.(() => close());
// Scorpion OS: the host's dot panel goes where the dot was dropped (or back to its corner).
const placeHostDot = () => { if (window.scorpionHost && !W.open) api.shellDot?.({ phase: 'get' }).then((c) => hostDot(c, c)).catch(() => {}); };
let lastDotAt;
api.onSettingsChanged?.((s) => {
  if (s?.theme) document.documentElement.dataset.theme = s.theme;
  if (s && 'stage' in s) showStage(s.stage);
  if (s && JSON.stringify(s.dotAt ?? null) !== lastDotAt) { lastDotAt = JSON.stringify(s.dotAt ?? null); placeHostDot(); }
});
placeHostDot();
api.onPerfChanged?.((level) => { document.documentElement.dataset.perf = level; });
api.state().then((st) => {
  if (st?.platform === 'win32' && api.shellStage) { $('#sm-stage').hidden = false; showStage(st.settings?.stage); }
  if (st?.settings?.theme) document.documentElement.dataset.theme = st.settings.theme;
  document.documentElement.dataset.perf = st?.perf || 'full';
}).catch(() => {});
addEventListener('resize', () => { if (W.open) place(); });
drawArt();
