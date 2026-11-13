// The taskbar along the bottom of the screen (or the top, or down a side:
// Settings, or Position on its right-click menu) while Scorpion is the Windows
// desktop (or stands in for the Windows taskbar): Scorpion, Apps and Files,
// the pinned apps and the open windows with their icons, then network,
// battery, volume, the clock and the power menu. Right-click an empty part of
// it to customize it (app names, centered, size, look, tray items). Pinned
// apps can be put in groups (right-click one → Group): a group is one icon
// that drops down its apps; an app's open windows share one icon that drops
// down the windows (taskbar-core.js).
import { layoutTaskbar } from './taskbar-core.js';

const api = window.scorpion;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let windows = [];
let pinned = []; // [{ id, name, icon }]
let links = []; // folders and files kept on the bar: [{ path, name, dir, icon }]
let look = { labels: true, center: false, size: 'normal', style: 'holo', show: {}, groups: [], combine: true };
let shown = { pins: [], wins: [] }; // what's on the bar now (layoutTaskbar)

async function applySettings(settings) {
  const s = settings || (await api.state().catch(() => null))?.settings;
  if (!s) return;
  if (s.theme) document.documentElement.dataset.theme = s.theme;
  look = { labels: true, center: false, size: 'normal', style: 'holo', ...(s.taskbar || {}), show: { home: true, apps: true, files: true, power: true, network: true, battery: true, volume: true, clock: true, notifications: true, mail: true, chat: true, ...(s.taskbar?.show || {}) } };
  const b = document.body.classList;
  for (const c of [...b]) if (/^tb-(style|size)-/.test(c)) b.remove(c);
  b.add(`tb-style-${look.style}`, `tb-size-${look.size}`);
  b.toggle('tb-icons-only', !look.labels);
  b.toggle('tb-centered', Boolean(look.center));
  // The status icons in one dropdown, when asked for.
  b.toggle('tb-tray-grouped', look.groupTray === true);
  $('#tb-tray').hidden = look.groupTray !== true;
  const edge = ['bottom', 'top', 'left', 'right'].includes(look.edge) ? look.edge : 'bottom';
  for (const e of ['bottom', 'top', 'left', 'right']) b.toggle(`at-${e}`, e === edge);
  for (const [k, el] of [['network', '#tb-net'], ['volume', '#tb-volume'], ['clock', '#tb-clock'], ['notifications', '[data-glance="notifications"]'], ['mail', '[data-glance="mail"]'], ['chat', '[data-glance="chat"]']]) $(el).hidden = look.show[k] === false;
  $('#tb-battery').dataset.off = look.show.battery === false ? '1' : '';
  showDrives(lastDrives);
  refreshTray();
  for (const k of ['home', 'apps', 'files', 'power']) { const b = document.getElementById(`tb-${k}`); if (b) b.hidden = look.show[k] === false; } // the buttons at the ends
  pinned = await api.shellPinned().catch(() => pinned);
  const l = await (api.shellLinks?.() ?? Promise.resolve(links)).catch(() => links);
  links = Array.isArray(l) ? l : [];
  render();
}

function render() {
  const icon = (src, name) => (src ? `<img src="${esc(src)}" alt="">` : `<span class="tb-initial">${esc(String(name).slice(0, 1).toUpperCase())}</span>`);
  const count = (n) => (n > 1 ? `<span class="tb-count" aria-hidden="true">${n}</span>` : '');
  shown = layoutTaskbar({ pinned, windows, groups: look.groups, combine: look.combine !== false });
  $('#tb-pinned').innerHTML = shown.pins.map((it) => {
    const state = `${it.running ? ' running' : ''}${it.active ? ' active' : ''}`;
    // A group: up to four of its apps' icons, small, and its name; a click drops down its apps.
    if (it.kind === 'group') return `<button class="tb-btn tb-win tb-pin tb-group${state}" data-group="${esc(it.id)}" aria-haspopup="menu" title="${esc(it.name)}: ${esc(it.apps.map((a) => a.name).join(', '))}"><span class="tb-stack">${it.apps.slice(0, 4).map((a) => icon(a.icon, a.name)).join('')}</span><span class="tb-title">${esc(it.name)}</span></button>`;
    const p = it.app;
    return `<button class="tb-btn tb-win tb-pin${state}" data-pin="${esc(p.id)}" title="${esc(p.name)}${it.windows.length > 1 ? ` (${it.windows.length} windows)` : ''}">${icon(p.icon, p.name)}<span class="tb-title">${esc(p.name)}</span>${count(it.windows.length)}</button>`;
  }).join('');
  $('#tb-windows').innerHTML = shown.wins.map((it) => {
    // An app's windows together: a click drops down the list of them.
    if (it.kind === 'windows') return `<button class="tb-btn tb-win running${it.active ? ' active' : ''}" data-wins="${esc(it.key)}" aria-haspopup="menu" title="${esc(it.name)} (${it.windows.length} windows)">${icon(it.icon, it.name)}<span class="tb-title">${esc(it.name)}</span>${count(it.windows.length)}</button>`;
    const w = it.w;
    return `<button class="tb-btn tb-win running${w.active ? ' active' : ''}" data-hwnd="${esc(w.hwnd)}" title="${esc(w.title)}">${icon(w.icon, w.process || w.title)}<span class="tb-title">${esc(w.title)}</span></button>`;
  }).join('');
  const folder = '<svg class="tb-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  const linksEl = $('#tb-links');
  if (linksEl) linksEl.innerHTML = links.map((l) => `<button class="tb-btn tb-win tb-pin tb-link" data-link="${esc(l.path)}" title="${esc(l.path)}">${l.dir ? folder : icon(l.icon, l.name)}<span class="tb-title">${esc(l.name)}</span></button>`).join('');
  $('#tb-sep').hidden = !(shown.pins.length || links.length) || !shown.wins.length;
}
// The dropdowns (native menus, so they reach above the thin bar): a group's
// apps, or an app's windows.
const groupMenu = (id) => api.shellMenu({ kind: 'group', id });
const windowsMenu = (list, name) => api.shellMenu({ kind: 'windows', name, hwnds: list.map((w) => w.hwnd) });

async function refreshWindows() {
  try {
    const next = await api.shellWindows();
    const key = (list) => list.map((w) => `${w.hwnd}|${w.title}|${w.active}`).join('\n');
    if (key(next) !== key(windows)) { windows = next; render(); }
  } catch { /* locked or busy: keep the last list */ }
}

function tick() {
  const now = new Date();
  // The same on every taskbar: hours and minutes, and a short date.
  $('#tb-time').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s*[AaPp]\.?[Mm]\.?$/, '');
  $('#tb-date').textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

async function refreshTray() {
  const t = await api.shellTray().catch(() => ({}));
  $('#tb-net').title = t.network ? `Connected: ${t.network}` : 'Not connected';
  $('#tb-net').style.opacity = t.network ? 1 : 0.4;
  const hasBattery = typeof t.battery === 'number';
  $('#tb-battery').hidden = !hasBattery || $('#tb-battery').dataset.off === '1';
  if (hasBattery) {
    $('#tb-battery-pct').textContent = `${t.battery}%`;
    $('#tb-battery-fill').setAttribute('width', String(Math.max(1, Math.round(14 * t.battery / 100))));
    $('#tb-battery').title = `Battery ${t.battery}%${t.charging ? ', charging' : ''}`;
    $('#tb-battery').classList.toggle('tb-battery-low', t.battery <= 15 && !t.charging);
  }
}

$('#tb-summon').addEventListener('click', () => api.shellWheel({ open: true, centre: true }));
$('#tb-home').addEventListener('click', () => api.shellShow('desktop'));
$('#tb-apps').addEventListener('click', () => api.shellShow('apps'));
$('#tb-files').addEventListener('click', () => api.shellShow('files'));
$('#tb-power').addEventListener('click', () => api.shellMenu({ kind: 'power' }));
for (const b of document.querySelectorAll('[data-glance]')) b.addEventListener('click', () => api.shellGlance(b.dataset.glance).catch(() => {}));
$('#tb-clock').addEventListener('click', () => api.shellMenu({ kind: 'clock' }));
$('#tb-tray').addEventListener('click', () => api.shellMenu({ kind: 'tray' }));
$('#tb-drives').addEventListener('click', () => api.shellMenu({ kind: 'drives' }));
// USB sticks and external drives: the icon is there while one is plugged in (checked every so often, and when one is ejected).
let lastDrives = [];
const showDrives = (list) => { lastDrives = Array.isArray(list) ? list : []; const n = lastDrives.length; $('#tb-drives').hidden = !n || look.show.drives === false; $('#tb-drives').title = n ? `${n} USB or external drive${n === 1 ? '' : 's'}: click to open or eject` : 'USB and external drives'; };
const pollDrives = () => api.shellDrives?.().then(showDrives).catch(() => {});
api.onDrivesChanged?.(showDrives);
pollDrives();
setInterval(pollDrives, 30_000);
$('#tb-volume').addEventListener('click', () => api.shellVolume('mute'));
$('#tb-volume').addEventListener('wheel', (e) => { e.preventDefault(); api.shellVolume(e.deltaY < 0 ? 'up' : 'down'); }, { passive: false });

// A window: to the front, or (if it is in front) minimized, like the Windows taskbar.
const toggleWindow = async (w) => {
  await api.shellWindow({ hwnd: w.hwnd, action: w.active ? 'minimize' : 'focus' }).catch(() => {});
  setTimeout(refreshWindows, 250);
};
$('#tb-apps-area').addEventListener('click', async (e) => {
  const win = e.target.closest('[data-hwnd]');
  if (win) { const w = windows.find((x) => x.hwnd === win.dataset.hwnd); if (w) toggleWindow(w); return; }
  const group = e.target.closest('[data-group]');
  if (group) { groupMenu(group.dataset.group); return; }
  const wins = e.target.closest('[data-wins]');
  if (wins) { const it = shown.wins.find((x) => x.key === wins.dataset.wins); if (it) windowsMenu(it.windows, it.name); return; }
  const link = e.target.closest('[data-link]');
  if (link) { api.shellLinkOpen?.(link.dataset.link).catch(() => {}); return; }
  const pin = e.target.closest('[data-pin]');
  if (!pin) return;
  const it = shown.pins.find((x) => x.app?.id === pin.dataset.pin);
  if (!it) return;
  const p = it.app;
  const open = it.windows;
  // Not running: open it. One window: like a window button. Several: the list of them (or, not combined, the next one).
  if (!open.length) { pin.classList.add('launching'); setTimeout(() => pin.classList.remove('launching'), 1200); api.shellLaunch({ id: p.id, name: p.name }).catch(() => {}); return; }
  if (open.length === 1) { toggleWindow(open[0]); return; }
  if (look.combine !== false) { windowsMenu(open, p.name); return; }
  const i = open.findIndex((w) => w.active);
  toggleWindow({ ...open[(i + 1) % open.length], active: false });
});
$('#tb-apps-area').addEventListener('auxclick', (e) => {
  const b = e.target.closest('[data-hwnd]');
  if (b && e.button === 1) api.shellWindow({ hwnd: b.dataset.hwnd, action: 'close' }).catch(() => {});
});
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const win = e.target.closest('[data-hwnd]');
  if (win) { const w = windows.find((x) => x.hwnd === win.dataset.hwnd); api.shellMenu({ kind: 'window', hwnd: win.dataset.hwnd, title: w?.title, exe: w?.exe }); return; }
  const group = e.target.closest('[data-group]');
  if (group) { groupMenu(group.dataset.group); return; }
  const wins = e.target.closest('[data-wins]');
  if (wins) { const it = shown.wins.find((x) => x.key === wins.dataset.wins); if (it) windowsMenu(it.windows, it.name); return; }
  const link = e.target.closest('[data-link]');
  if (link) { const l = links.find((x) => x.path === link.dataset.link); if (l) api.shellMenu({ kind: 'link', path: l.path, name: l.name }); return; }
  const pin = e.target.closest('[data-pin]');
  if (pin) { const p = pinned.find((x) => x.id === pin.dataset.pin); api.shellMenu({ kind: 'pinned', id: p.id, name: p.name }); return; }
  if (!e.target.closest('button')) api.shellMenu({ kind: 'bar' }); // an empty part: customize
});

api.onSettingsChanged?.((s) => applySettings(s));
// Auto-hide: the bar slides down off the screen (a glowing line stays) and back.
api.onRail?.(({ hidden } = {}) => document.body.classList.toggle('rail-hidden', Boolean(hidden)));
applySettings();
tick();
refreshWindows();
setInterval(tick, 1000);
// How often the open windows are checked: by Performance (Settings → General).
const POLL = { full: 1500, balanced: 2500, light: 4000 };
let poll = setInterval(refreshWindows, POLL.full);
const setPerf = (level) => {
  document.documentElement.dataset.perf = level;
  clearInterval(poll);
  poll = setInterval(refreshWindows, POLL[level] || POLL.full);
};
api.state().then((st) => setPerf(st?.perf || 'full')).catch(() => {});
api.onPerfChanged?.(setPerf);
setInterval(refreshTray, 30_000);

// Drag the inner edge to make the taskbar thicker or thinner (kept). On
// Windows its window follows the pointer (shell.js); on Scorpion OS the shell
// host places its panel at the size this page works out.
const grip = $('#rail-grip');
let gripping = null;
const edgeNow = () => ['left', 'right', 'top', 'bottom'].find((e) => document.body.classList.contains(`at-${e}`)) || 'bottom';
const sizeAt = (ev) => ({ right: innerWidth - ev.clientX, left: ev.clientX, top: ev.clientY, bottom: innerHeight - ev.clientY })[edgeNow()];
grip.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  gripping = { frame: 0 };
  grip.classList.add('dragging');
  try { grip.setPointerCapture(ev.pointerId); } catch { /* gone */ }
});
grip.addEventListener('pointermove', (ev) => {
  if (!gripping || gripping.frame) return;
  gripping.frame = setTimeout(() => { if (gripping) gripping.frame = 0; }, 16); // about 60 a second
  if (window.scorpionHost) api.host({ type: 'rail', size: Math.round(sizeAt(ev)) });
  else api.shellRailSize({ phase: 'move', x: ev.screenX, y: ev.screenY }).catch(() => {});
});
const letGo = (ev) => {
  if (!gripping) return;
  gripping = null;
  grip.classList.remove('dragging');
  api.shellRailSize(window.scorpionHost ? { phase: 'end', size: Math.round(sizeAt(ev)) } : { phase: 'end', x: ev.screenX, y: ev.screenY }).catch(() => {});
};
grip.addEventListener('pointerup', letGo);
grip.addEventListener('pointercancel', letGo);
