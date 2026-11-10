// The edge rail: Scorpion's taskbar down the right edge of the screen (or the
// left, or along the top or bottom: Settings, or Position on its right-click
// menu), for a glance (the clock, battery, network, notifications, mail and
// chat), the pinned apps and the open windows, then volume and power. The
// summon button opens the intent wheel (summon.js). Right-click an empty part of
// it to customize it (or switch to the classic bar). Pinned apps can be put
// in groups (right-click one → Group): a group is one icon that drops down
// its apps; an app's open windows share one icon that drops down the windows
// (taskbar-core.js).
import { layoutTaskbar } from './taskbar-core.js';

const api = window.scorpion;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let windows = [];
let pinned = []; // [{ id, name, icon }]
let show = {};
let look = { groups: [], combine: true };
let shown = { pins: [], wins: [] }; // what's on the rail now (layoutTaskbar)
const EDGES = ['right', 'left', 'top', 'bottom'];

async function applySettings(settings) {
  const s = settings || (await api.state().catch(() => null))?.settings;
  if (!s) return;
  if (s.theme) document.documentElement.dataset.theme = s.theme;
  const edge = EDGES.includes(s.taskbar?.edge) ? s.taskbar.edge : 'right';
  for (const e of EDGES) document.body.classList.toggle(`at-${e}`, e === edge);
  // The same choices as the classic bar: names, centred, size, look.
  const t = { labels: true, center: false, size: 'normal', style: 'holo', ...(s.taskbar || {}) };
  look = { groups: t.groups || [], combine: t.combine !== false };
  // The status icons in one dropdown, when asked for.
  document.body.classList.toggle('eg-tray-grouped', t.groupTray === true);
  $('#eg-tray').hidden = t.groupTray !== true;
  const b = document.body.classList;
  for (const c of [...b]) if (/^eg-(style|size)-/.test(c)) b.remove(c);
  b.add(`eg-style-${t.style}`, `eg-size-${t.size}`);
  b.toggle('eg-labels', t.labels !== false);
  b.toggle('eg-centered', Boolean(t.center));
  show = { network: true, battery: true, volume: true, clock: true, notifications: true, mail: true, chat: true, ...(s.taskbar?.show || {}) };
  $('#eg-net').hidden = show.network === false;
  for (const k of ['notifications', 'mail', 'chat']) $(`[data-glance="${k}"]`).hidden = show[k] === false;
  // Scorpion OS: the shell host hides the rail itself when it should.
  api.host?.({ type: 'rail', autoHide: s.taskbar?.autoHide === true, edge, size: s.taskbar?.sizes?.[`rail-${edge === 'top' || edge === 'bottom' ? 'across' : 'side'}`] || 0 });
  $('#eg-volume').hidden = show.volume === false;
  $('#eg-clock').hidden = show.clock === false;
  refreshTray();
  pinned = await api.shellPinned().catch(() => pinned);
  render();
}

function render() {
  const icon = (src, name) => (src ? `<img src="${esc(src)}" alt="">` : `<span class="eg-initial">${esc(String(name).slice(0, 1).toUpperCase())}</span>`);
  const count = (n) => (n > 1 ? `<span class="eg-count" aria-hidden="true">${n}</span>` : '');
  shown = layoutTaskbar({ pinned, windows, groups: look.groups, combine: look.combine });
  const pins = shown.pins.map((it) => {
    const state = `${it.running ? ' running' : ''}${it.active ? ' active' : ''}`;
    // A group: up to four of its apps' icons, small; a click drops down its apps.
    if (it.kind === 'group') return `<button class="eg-app eg-group${state}" data-group="${esc(it.id)}" aria-haspopup="menu" title="${esc(it.name)}: ${esc(it.apps.map((a) => a.name).join(', '))}"><span class="eg-stack">${it.apps.slice(0, 4).map((a) => icon(a.icon, a.name)).join('')}</span><span class="eg-name">${esc(it.name)}</span></button>`;
    const p = it.app;
    return `<button class="eg-app${state}" data-pin="${esc(p.id)}" title="${esc(p.name)}${it.windows.length > 1 ? ` (${it.windows.length} windows)` : ''}">${icon(p.icon, p.name)}<span class="eg-name">${esc(p.name)}</span>${count(it.windows.length)}</button>`;
  }).join('');
  const wins = shown.wins.map((it) => {
    // An app's windows together: a click drops down the list of them.
    if (it.kind === 'windows') return `<button class="eg-app running${it.active ? ' active' : ''}" data-wins="${esc(it.key)}" aria-haspopup="menu" title="${esc(it.name)} (${it.windows.length} windows)">${icon(it.icon, it.name)}<span class="eg-name">${esc(it.name)}</span>${count(it.windows.length)}</button>`;
    const w = it.w;
    return `<button class="eg-app running${w.active ? ' active' : ''}" data-hwnd="${esc(w.hwnd)}" title="${esc(w.title)}">${icon(w.icon, w.process || w.title)}<span class="eg-name">${esc(w.title)}</span></button>`;
  }).join('');
  $('#eg-apps').innerHTML = pins + (pins && wins ? '<span class="eg-sep"></span>' : '') + wins;
}
// The dropdowns (native menus, beside the rail): a group's apps, or an app's windows.
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
  // Hours and minutes only (no AM/PM), to fit the rail.
  $('#eg-time').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s*[AaPp]\.?[Mm]\.?$/, '');
  $('#eg-date').textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

async function refreshTray() {
  const t = await api.shellTray().catch(() => ({}));
  $('#eg-install').hidden = !t.live;
  $('#eg-net-label').textContent = t.network ? 'Connected' : 'Offline';
  $('#eg-net').title = t.network ? `Connected: ${t.network}` : 'Not connected';
  $('#eg-net').classList.toggle('off', !t.network);
  const hasBattery = typeof t.battery === 'number';
  $('#eg-battery').hidden = !hasBattery || show.battery === false;
  if (hasBattery) {
    $('#eg-battery-pct').textContent = `${t.battery}%`;
    $('#eg-battery-fill').setAttribute('width', String(Math.max(1, Math.round(13 * t.battery / 100))));
    $('#eg-battery').title = `Battery ${t.battery}%${t.charging ? ', charging' : ''}`;
    $('#eg-battery').classList.toggle('low', t.battery <= 15 && !t.charging);
  }
}

// Scorpion OS (the native shell host): the network and battery open the
// quick settings panel beside the rail (quick.html), the bell the
// notification list (notify.html).
const quick = (section) => api.host({ type: 'panel', name: 'quick', section });
for (const b of document.querySelectorAll('[data-glance]')) b.addEventListener('click', () => {
  if (b.dataset.glance === 'notifications' && window.scorpionHost) { api.host({ type: 'panel', name: 'notify', toggle: true }); api.notificationAct({ action: 'read' }).catch(() => {}); return; }
  if ((b.dataset.glance === 'network' || b.dataset.glance === 'battery') && window.scorpionHost) { quick(b.dataset.glance); return; }
  api.shellGlance(b.dataset.glance).catch(() => {});
});
// The bell's count of unread notifications (the native shell host is the notification server).
const setBadge = (s) => { const n = s?.unread || 0; $('#eg-badge').hidden = !n; $('#eg-badge').textContent = n > 9 ? '9+' : String(n); };
if (api.notifications) { api.notifications().then(setBadge).catch(() => {}); api.onNotificationsChanged?.(setBadge); }
$('#eg-clock').addEventListener('click', () => api.shellMenu({ kind: 'clock' }));
$('#eg-tray').addEventListener('click', () => api.shellMenu({ kind: 'tray' }));
$('#eg-drives').addEventListener('click', () => api.shellMenu({ kind: 'drives' }));
// USB sticks and external drives: the icon is there while one is plugged in (checked every so often, and when one is ejected).
const showDrives = (list) => { const n = Array.isArray(list) ? list.length : 0; $('#eg-drives').hidden = !n; $('#eg-drives').title = n ? `${n} USB or external drive${n === 1 ? '' : 's'}: click to open or eject` : 'USB and external drives'; };
const pollDrives = () => api.shellDrives?.().then(showDrives).catch(() => {});
api.onDrivesChanged?.(showDrives);
pollDrives();
setInterval(pollDrives, 30_000);
$('#eg-summon').addEventListener('click', () => api.shellWheel({ open: true, centre: true }));
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => api.shellShow?.(b.dataset.view));
$('#eg-power').addEventListener('click', () => api.shellMenu({ kind: 'power' }));
$('#eg-volume').addEventListener('click', () => (window.scorpionHost ? quick('sound') : api.shellVolume('mute')));
// The installer takes a while to appear, so the button says it's coming.
$('#eg-install').addEventListener('click', () => {
  const b = $('#eg-install');
  if (b.disabled) return;
  b.disabled = true;
  $('#eg-install-label').textContent = 'Opening…';
  setTimeout(() => { b.disabled = false; $('#eg-install-label').textContent = 'Install'; }, 45000);
  api.shellInstall().catch(() => { b.disabled = false; $('#eg-install-label').textContent = 'Install'; });
});
if (window.scorpionHost) $('#eg-volume').title = 'Sound: click for quick settings, scroll to change';
$('#eg-volume').addEventListener('wheel', (e) => { e.preventDefault(); api.shellVolume(e.deltaY < 0 ? 'up' : 'down'); }, { passive: false });

// A window: to the front, or (if it is in front) minimized, like the Windows taskbar.
const toggleWindow = async (w) => {
  await api.shellWindow({ hwnd: w.hwnd, action: w.active ? 'minimize' : 'focus' }).catch(() => {});
  setTimeout(refreshWindows, 250);
};
$('#eg-apps').addEventListener('click', (e) => {
  const win = e.target.closest('[data-hwnd]');
  if (win) { const w = windows.find((x) => x.hwnd === win.dataset.hwnd); if (w) toggleWindow(w); return; }
  const group = e.target.closest('[data-group]');
  if (group) { groupMenu(group.dataset.group); return; }
  const wins = e.target.closest('[data-wins]');
  if (wins) { const it = shown.wins.find((x) => x.key === wins.dataset.wins); if (it) windowsMenu(it.windows, it.name); return; }
  const pin = e.target.closest('[data-pin]');
  if (!pin) return;
  const it = shown.pins.find((x) => x.app?.id === pin.dataset.pin);
  if (!it) return;
  const p = it.app;
  const open = it.windows;
  // Not running: open it. One window: like a window button. Several: the list of them (or, not combined, the next one).
  if (!open.length) { pin.classList.add('launching'); setTimeout(() => pin.classList.remove('launching'), 1200); api.shellLaunch({ id: p.id, name: p.name }).catch(() => {}); return; }
  if (open.length === 1) { toggleWindow(open[0]); return; }
  if (look.combine) { windowsMenu(open, p.name); return; }
  const i = open.findIndex((w) => w.active);
  toggleWindow({ ...open[(i + 1) % open.length], active: false });
});
$('#eg-apps').addEventListener('auxclick', (e) => {
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
  const pin = e.target.closest('[data-pin]');
  if (pin) { const p = pinned.find((x) => x.id === pin.dataset.pin); api.shellMenu({ kind: 'pinned', id: p.id, name: p.name }); return; }
  if (!e.target.closest('button')) api.shellMenu({ kind: 'bar' }); // an empty part: customize
});

api.onSettingsChanged?.((s) => applySettings(s));
// Auto-hide: the rail slides off the edge (a glowing line stays) and back.
const setHidden = (hidden) => document.body.classList.toggle('rail-hidden', Boolean(hidden));
api.onRail?.(({ hidden } = {}) => setHidden(hidden));
window.scorpionRail = setHidden;
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
const edgeNow = () => ['left', 'right', 'top', 'bottom'].find((e) => document.body.classList.contains(`at-${e}`)) || 'right';
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
