// Scorpion OS's desktop background (wallpaper.html): the picture chosen in
// Scorpion (Settings → Windows and taskbar, or right-click here), shown
// again whenever it changes; the theme's colours otherwise. On top of it the
// items of the Desktop folder, as icons: double-click opens one, right-click
// gives its menu, and right-click on the background gives New ▸ (folder,
// documents), Refresh and the background's own menu.
const api = window.scorpion;
let shown = null;
async function show(settings) {
  const s = settings || (await api.state().catch(() => null))?.settings;
  if (s?.theme) document.documentElement.dataset.theme = s.theme;
  if (s && s.background === shown) return;
  shown = s?.background ?? null;
  const url = await api.desktopBackground().catch(() => null);
  document.documentElement.style.setProperty('--wall', url ? `url("${url}")` : 'none');
}

// ---------- the icons ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ICON = {
  dir: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M5 12a3 3 0 0 1 3-3h10l4 5h18a3 3 0 0 1 3 3v21a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" fill="currentColor" opacity=".85"/></svg>',
  file: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M11 5h18l9 9v29H11z" fill="currentColor" opacity=".25"/><path d="M11 5h18l9 9v29H11z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M29 5v9h9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M17 24h14M17 30h14M17 36h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};
const box = document.createElement('div');
box.className = 'dt-icons';
box.id = 'dt-icons';
document.body.append(box);
let items = [];
let selected = null;
let renaming = null;
let dir = null;

function render() {
  box.innerHTML = items.map((i) => {
    const label = renaming === i.path
      ? `<form class="dt-rename" data-rename="${esc(i.path)}"><input value="${esc(i.name)}" aria-label="New name" spellcheck="false"></form>`
      : `<span class="dt-name">${esc(i.name)}</span>`;
    return `<button type="button" class="dt-item${selected === i.path ? ' selected' : ''}" data-path="${esc(i.path)}" title="${esc(i.name)}">${i.dir ? ICON.dir : ICON.file}${label}</button>`;
  }).join('');
  const input = box.querySelector('.dt-rename input');
  if (input) { input.focus(); input.setSelectionRange(0, input.value.replace(/\.[^.]+$/, '').length || input.value.length); }
}
async function load({ select = null, rename = false } = {}) {
  try {
    const r = await api.desktopItems();
    dir = r.dir;
    items = (r.items || []).filter((i) => !i.hidden && !i.name.startsWith('.'));
    items.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  } catch { items = []; }
  selected = select || (items.some((i) => i.path === selected) ? selected : null);
  renaming = rename && select ? select : null;
  render();
  if (select) box.querySelector(`[data-path="${CSS.escape(select)}"]`)?.scrollIntoView({ block: 'nearest' });
}

box.addEventListener('click', (e) => {
  const b = e.target.closest('.dt-item');
  if (e.target.closest('.dt-rename')) return;
  selected = b ? b.dataset.path : null;
  render();
});
box.addEventListener('dblclick', (e) => {
  const b = e.target.closest('.dt-item');
  if (b && !e.target.closest('.dt-rename')) api.filesOpen(b.dataset.path).catch(() => {});
});
box.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target.closest('[data-rename]');
  const name = form.querySelector('input').value;
  try { const to = await api.filesRename({ from: form.dataset.rename, name }); renaming = null; await load({ select: to }); } catch { renaming = null; await load({ select: form.dataset.rename }); }
});
box.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && renaming) { renaming = null; render(); }
  if (e.key === 'F2' && selected && !renaming) { renaming = selected; render(); }
  if (e.key === 'Enter' && selected && !renaming) api.filesOpen(selected).catch(() => {});
});
box.addEventListener('focusout', (e) => {
  // Clicking away from a name being typed keeps what was typed.
  if (renaming && e.target.closest('.dt-rename') && !e.relatedTarget) e.target.closest('form').requestSubmit();
});

document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const b = e.target.closest('.dt-item');
  if (b && !e.target.closest('.dt-rename')) {
    selected = b.dataset.path;
    render();
    api.shellMenu({ kind: 'files', dir, path: b.dataset.path });
  } else api.shellMenu({ kind: 'desktop' });
});
api.onFilesChanged?.(({ dir: changed, select, rename } = {}) => {
  if (changed && dir && changed !== dir) return;
  load({ select, rename });
});
api.onSettingsChanged?.((s) => show(s));
// Scorpion may not answer yet when the host loads this page: asked again until it does.
const start = () => show().then(() => load()).catch(() => setTimeout(start, 2000));
start();
