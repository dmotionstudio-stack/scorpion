// Stage: the strip that slides in from the screen's left edge (the right one
// while the taskbar is on the left) with your open
// apps' windows, each a live picture, gently turned toward the middle of the
// screen. Pick one and it flies onto the stage (comes forward) while the
// window that was in front steps aside. A window just minimized flies the
// other way: from the middle of the screen, big, into its place in the strip.
// On Windows shell.js shows and hides this window as the pointer reaches the
// edge or moves away; on Scorpion OS the shell host does, as a panel
// (os/.../scorpion-shell), calling window.scorpionStage.
import { kindOf, titleOf } from './wheel-core.js';
import { stageWindows } from './stage-core.js';

const api = window.scorpion;
const strip = document.getElementById('st-strip');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let busy = false;

// minimized: the window that just flew in is listed even though it's away.
async function fill() {
  const list = stageWindows(await api.shellWindows().catch(() => []));
  if (!list.length) {
    strip.innerHTML = '<div class="st-empty">No other windows open</div>';
    return;
  }
  strip.innerHTML = list.map((w, i) => {
    const icon = w.icon ? `<img class="st-icon" src="${esc(w.icon)}" alt="">` : '';
    return `<button class="st-card${w.minimized ? ' away' : ''}" role="listitem" data-hwnd="${esc(w.hwnd)}" style="--i:${i}" title="${esc(w.title)}">
      <span class="st-thumb" data-thumb="${esc(w.hwnd)}"></span>
      <span class="st-name">${icon}<span>${esc(titleOf(w))}</span></span>
      <span class="st-kind">${esc(kindOf(w))}${w.minimized ? ' · minimized' : ''}</span>
    </button>`;
  }).join('');
  for (const w of list) {
    api.constPreview({ hwnd: w.hwnd }).then((src) => {
      const el = strip.querySelector(`[data-thumb="${CSS.escape(w.hwnd)}"]`);
      if (el && src) el.style.backgroundImage = `url("${src}")`;
    }).catch(() => {});
  }
}

function show() {
  document.body.classList.remove('out');
  fill().then(() => {
    // A timer, not an animation frame: a panel just shown may not run those yet.
    setTimeout(() => document.body.classList.add('in'), 16);
  });
}
function hide() {
  document.body.classList.remove('in');
  document.body.classList.add('out');
}
// The flight: the card starts in the middle of the screen at three times its
// size and lands in its place (the window covers the screen meanwhile).
const FLIGHT_MS = 650;
async function arrive({ hwnd } = {}) {
  // Scorpion OS: the host shows the strip first.
  if (window.scorpionHost) {
    api.host({ type: 'stage', arriving: true });
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  document.body.classList.add('arriving');
  document.body.classList.remove('out');
  // The host is told it landed whatever happens, or it would keep waiting.
  const landed = () => {
    document.body.classList.remove('arriving');
    api.host?.({ type: 'stage', arrived: true });
  };
  try { await fill(); } catch { landed(); return; }
  const card = strip.querySelector(`[data-hwnd="${CSS.escape(String(hwnd))}"]`);
  if (card && document.documentElement.dataset.perf !== 'light' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // Its place in the strip without its slide (layout, not the transform);
    // it grows from its left edge (transform-origin), so three times its size
    // puts its middle one and a half widths along.
    // On Scorpion OS the flight stays inside the strip (its panel doesn't
    // cover the screen), so the card starts less big there.
    // From the right, it grows from its right edge instead.
    const s = window.scorpionHost ? 1.8 : 3;
    const left = card.offsetLeft + strip.offsetLeft;
    const top = card.offsetTop - strip.scrollTop;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const middle = onRight() ? left + w - (s / 2) * w : left + (s / 2) * w;
    card.style.setProperty('--fly', `translate(${innerWidth / 2 - middle}px, ${innerHeight / 2 - (top + h / 2)}px) scale(${s})`);
    card.classList.add('flying');
    card.getBoundingClientRect(); // starts from there
    setTimeout(() => card.classList.add('landed'), 30);
  }
  document.body.classList.add('in');
  setTimeout(() => {
    card?.classList.remove('flying', 'landed');
    landed();
  }, FLIGHT_MS);
}
window.scorpionStage = { show, hide, arrive };

strip.addEventListener('click', (e) => {
  const card = e.target.closest('[data-hwnd]');
  if (!card || busy) return;
  busy = true;
  card.classList.add('picked');
  setTimeout(() => {
    api.host?.({ type: 'stage', visible: false });
    api.shellStagePick(card.dataset.hwnd).catch(() => {}).finally(() => { busy = false; });
  }, 200);
});

api.onStageShow?.(show);
api.onStageHide?.(hide);
api.onStageArrive?.(arrive);
// The shell host shows Stage only while it's on, and on which side.
const sideOf = (s) => (s?.taskbar?.edge === 'left' ? 'right' : 'left');
const onRight = () => document.body.classList.contains('st-right');
const tellHost = (s) => {
  document.body.classList.toggle('st-right', sideOf(s) === 'right');
  api.host?.({ type: 'stage', enabled: s?.stage !== false, arrive: s?.minimizeToStage !== false, side: sideOf(s) });
};
api.onSettingsChanged?.((s) => { if (s?.theme) document.documentElement.dataset.theme = s.theme; tellHost(s); });
api.onPerfChanged?.((level) => { document.documentElement.dataset.perf = level; });
// Scorpion may not answer yet when the host loads this page: asked again until it does.
const start = () => api.state().then((st) => {
  if (st?.settings?.theme) document.documentElement.dataset.theme = st.settings.theme;
  document.documentElement.dataset.perf = st?.perf || 'full';
  tellHost(st?.settings);
}).catch(() => setTimeout(start, 2000));
start();
