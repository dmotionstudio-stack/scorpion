// Stage (Windows): the strip that slides in from the screen's left edge with
// your recent windows, each a live picture, gently turned toward the middle
// of the screen. Pick one and it flies onto the stage (comes forward) while
// the window that was in front steps aside (shell.js shows and hides this
// window as the pointer reaches the edge or moves away).
import { kindOf, titleOf } from './wheel-core.js';
import { stageWindows } from './stage-core.js';

const api = window.scorpion;
const strip = document.getElementById('st-strip');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let busy = false;

async function fill() {
  const list = stageWindows(await api.shellRecent().catch(() => []));
  if (!list.length) {
    strip.innerHTML = '<div class="st-empty">No other windows open</div>';
    return;
  }
  strip.innerHTML = list.map((w, i) => {
    const icon = w.icon ? `<img class="st-icon" src="${esc(w.icon)}" alt="">` : '';
    return `<button class="st-card" role="listitem" data-hwnd="${esc(w.hwnd)}" style="--i:${i}" title="${esc(w.title)}">
      <span class="st-thumb" data-thumb="${esc(w.hwnd)}"></span>
      <span class="st-name">${icon}<span>${esc(titleOf(w))}</span></span>
      <span class="st-kind">${esc(kindOf(w))}</span>
    </button>`;
  }).join('');
  for (const w of list) {
    api.constPreview({ hwnd: w.hwnd }).then((src) => {
      const el = strip.querySelector(`[data-thumb="${CSS.escape(w.hwnd)}"]`);
      if (el && src) el.style.backgroundImage = `url("${src}")`;
    }).catch(() => {});
  }
}

strip.addEventListener('click', (e) => {
  const card = e.target.closest('[data-hwnd]');
  if (!card || busy) return;
  busy = true;
  card.classList.add('picked');
  setTimeout(() => { api.shellStagePick(card.dataset.hwnd).catch(() => {}).finally(() => { busy = false; }); }, 200);
});

api.onStageShow?.(() => {
  document.body.classList.remove('out');
  fill().then(() => requestAnimationFrame(() => document.body.classList.add('in')));
});
api.onStageHide?.(() => { document.body.classList.remove('in'); document.body.classList.add('out'); });
api.onSettingsChanged?.((s) => { if (s?.theme) document.documentElement.dataset.theme = s.theme; });
api.onPerfChanged?.((level) => { document.documentElement.dataset.perf = level; });
api.state().then((st) => {
  if (st?.settings?.theme) document.documentElement.dataset.theme = st.settings.theme;
  document.documentElement.dataset.perf = st?.perf || 'full';
}).catch(() => {});
