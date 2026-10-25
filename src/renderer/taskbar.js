// The taskbar along the bottom of the screen while Scorpion is the Windows
// desktop (or stands in for the Windows taskbar): Scorpion, Apps and Files,
// the pinned apps and the open windows with their icons, then network,
// battery, volume, the clock and the power menu. Right-click an empty part of
// it to customize it (app names, centered, size, look, tray items).
const api = window.scorpion;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let windows = [];
let pinned = []; // [{ id, name, icon }]
let look = { labels: true, center: false, size: 'normal', style: 'holo', show: {} };

async function applySettings(settings) {
  const s = settings || (await api.state().catch(() => null))?.settings;
  if (!s) return;
  if (s.theme) document.documentElement.dataset.theme = s.theme;
  look = { labels: true, center: false, size: 'normal', style: 'holo', ...(s.taskbar || {}), show: { network: true, battery: true, volume: true, clock: true, ...(s.taskbar?.show || {}) } };
  const b = document.body.classList;
  for (const c of [...b]) if (/^tb-(style|size)-/.test(c)) b.remove(c);
  b.add(`tb-style-${look.style}`, `tb-size-${look.size}`);
  b.toggle('tb-icons-only', !look.labels);
  b.toggle('tb-centered', Boolean(look.center));
  for (const [k, el] of [['network', '#tb-net'], ['volume', '#tb-volume'], ['clock', '#tb-clock']]) $(el).hidden = look.show[k] === false;
  $('#tb-battery').dataset.off = look.show.battery === false ? '1' : '';
  refreshTray();
  pinned = await api.shellPinned().catch(() => pinned);
  render();
}

// A pinned program's windows (matched by its path); Store apps can't be matched.
const sameFile = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();
const windowsOf = (p) => windows.filter((w) => sameFile(w.exe, p.id));

function render() {
  const icon = (src, name) => (src ? `<img src="${esc(src)}" alt="">` : `<span class="tb-initial">${esc(String(name).slice(0, 1).toUpperCase())}</span>`);
  $('#tb-pinned').innerHTML = pinned.map((p) => {
    const open = windowsOf(p);
    const active = open.some((w) => w.active);
    return `<button class="tb-btn tb-win tb-pin${open.length ? ' running' : ''}${active ? ' active' : ''}" data-pin="${esc(p.id)}" title="${esc(p.name)}${open.length > 1 ? ` (${open.length} windows)` : ''}">${icon(p.icon, p.name)}<span class="tb-title">${esc(p.name)}</span></button>`;
  }).join('');
  const shown = windows.filter((w) => !pinned.some((p) => sameFile(w.exe, p.id)));
  $('#tb-windows').innerHTML = shown.map((w) => `<button class="tb-btn tb-win running${w.active ? ' active' : ''}" data-hwnd="${esc(w.hwnd)}" title="${esc(w.title)}">${icon(w.icon, w.process || w.title)}<span class="tb-title">${esc(w.title)}</span></button>`).join('');
  $('#tb-sep').hidden = !pinned.length || !shown.length;
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
  $('#tb-time').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('#tb-date').textContent = now.toLocaleDateString();
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

$('#tb-home').addEventListener('click', () => api.shellShow('desktop'));
$('#tb-apps').addEventListener('click', () => api.shellShow('apps'));
$('#tb-files').addEventListener('click', () => api.shellShow('files'));
$('#tb-power').addEventListener('click', () => api.shellMenu({ kind: 'power' }));
$('#tb-clock').addEventListener('click', () => api.shellMenu({ kind: 'clock' }));
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
$('#tb-apps-area').addEventListener('auxclick', (e) => {
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
