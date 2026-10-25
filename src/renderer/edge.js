// The edge rail: Scorpion's taskbar down the right edge of the screen, for a
// glance (the clock, battery, network, notifications, mail and chat), the
// pinned apps and the open windows, then volume and power. The summon dot in
// the bottom-left corner opens the intent wheel (summon.js). Right-click an
// empty part of it to customize it (or go back to the bar along the bottom).
const api = window.scorpion;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let windows = [];
let pinned = []; // [{ id, name, icon }]
let show = {};

async function applySettings(settings) {
  const s = settings || (await api.state().catch(() => null))?.settings;
  if (!s) return;
  if (s.theme) document.documentElement.dataset.theme = s.theme;
  show = { network: true, battery: true, volume: true, clock: true, ...(s.taskbar?.show || {}) };
  $('#eg-net').hidden = show.network === false;
  $('#eg-volume').hidden = show.volume === false;
  $('#eg-clock').hidden = show.clock === false;
  refreshTray();
  pinned = await api.shellPinned().catch(() => pinned);
  render();
}

// A pinned program's windows (matched by its path); Store apps can't be matched.
const sameFile = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();
const windowsOf = (p) => windows.filter((w) => sameFile(w.exe, p.id));

function render() {
  const icon = (src, name) => (src ? `<img src="${esc(src)}" alt="">` : `<span class="eg-initial">${esc(String(name).slice(0, 1).toUpperCase())}</span>`);
  const pins = pinned.map((p) => {
    const open = windowsOf(p);
    const active = open.some((w) => w.active);
    return `<button class="eg-app${open.length ? ' running' : ''}${active ? ' active' : ''}" data-pin="${esc(p.id)}" title="${esc(p.name)}${open.length > 1 ? ` (${open.length} windows)` : ''}">${icon(p.icon, p.name)}</button>`;
  }).join('');
  const shown = windows.filter((w) => !pinned.some((p) => sameFile(w.exe, p.id)));
  const wins = shown.map((w) => `<button class="eg-app running${w.active ? ' active' : ''}" data-hwnd="${esc(w.hwnd)}" title="${esc(w.title)}">${icon(w.icon, w.process || w.title)}</button>`).join('');
  $('#eg-apps').innerHTML = pins + (pins && wins ? '<span class="eg-sep"></span>' : '') + wins;
}

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

for (const b of document.querySelectorAll('[data-glance]')) b.addEventListener('click', () => {
  // In the native shell host the bell opens Scorpion's own notification list.
  if (b.dataset.glance === 'notifications' && window.scorpionHost) { api.host({ type: 'panel', name: 'notify', toggle: true }); api.notificationAct({ action: 'read' }).catch(() => {}); return; }
  api.shellGlance(b.dataset.glance).catch(() => {});
});
// The bell's count of unread notifications (the native shell host is the notification server).
const setBadge = (s) => { const n = s?.unread || 0; $('#eg-badge').hidden = !n; $('#eg-badge').textContent = n > 9 ? '9+' : String(n); };
if (api.notifications) { api.notifications().then(setBadge).catch(() => {}); api.onNotificationsChanged?.(setBadge); }
$('#eg-clock').addEventListener('click', () => api.shellMenu({ kind: 'clock' }));
$('#eg-power').addEventListener('click', () => api.shellMenu({ kind: 'power' }));
$('#eg-volume').addEventListener('click', () => api.shellVolume('mute'));
$('#eg-volume').addEventListener('wheel', (e) => { e.preventDefault(); api.shellVolume(e.deltaY < 0 ? 'up' : 'down'); }, { passive: false });

// A window: to the front, or (if it is in front) minimized, like the Windows taskbar.
const toggleWindow = async (w) => {
  await api.shellWindow({ hwnd: w.hwnd, action: w.active ? 'minimize' : 'focus' }).catch(() => {});
  setTimeout(refreshWindows, 250);
};
$('#eg-apps').addEventListener('click', (e) => {
  const win = e.target.closest('[data-hwnd]');
  if (win) { const w = windows.find((x) => x.hwnd === win.dataset.hwnd); if (w) toggleWindow(w); return; }
  const pin = e.target.closest('[data-pin]');
  if (!pin) return;
  const p = pinned.find((x) => x.id === pin.dataset.pin);
  const open = windowsOf(p);
  // Not running: open it. One window: like a window button. Several: the next one.
  if (!open.length) { pin.classList.add('launching'); setTimeout(() => pin.classList.remove('launching'), 1200); api.shellLaunch({ id: p.id, name: p.name }).catch(() => {}); return; }
  if (open.length === 1) { toggleWindow(open[0]); return; }
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
  const pin = e.target.closest('[data-pin]');
  if (pin) { const p = pinned.find((x) => x.id === pin.dataset.pin); api.shellMenu({ kind: 'pinned', id: p.id, name: p.name }); return; }
  if (!e.target.closest('button')) api.shellMenu({ kind: 'bar' }); // an empty part: customize
});

api.onSettingsChanged?.((s) => applySettings(s));
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
