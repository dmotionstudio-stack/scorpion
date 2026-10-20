// The taskbar along the bottom of the screen while Scorpion is the Windows
// desktop: Scorpion, Apps and Files, the open windows, then network, battery,
// volume, the clock and the power menu.
const api = window.scorpion;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let windows = [];

async function applyTheme(settings) {
  const s = settings || (await api.state().catch(() => null))?.settings;
  if (s?.theme) document.documentElement.dataset.theme = s.theme;
}

function renderWindows() {
  $('#tb-windows').innerHTML = windows.map((w) => `<button class="tb-btn tb-win${w.active ? ' active' : ''}" data-hwnd="${esc(w.hwnd)}" title="${esc(w.title)}">${
    w.icon ? `<img src="${esc(w.icon)}" alt="">` : `<span class="tb-initial">${esc((w.process || w.title).slice(0, 1).toUpperCase())}</span>`
  }<span class="tb-title">${esc(w.title)}</span></button>`).join('');
}

async function refreshWindows() {
  try {
    const next = await api.shellWindows();
    const key = (list) => list.map((w) => `${w.hwnd}|${w.title}|${w.active}`).join('\n');
    if (key(next) !== key(windows)) { windows = next; renderWindows(); }
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
  $('#tb-battery').hidden = !hasBattery;
  if (hasBattery) {
    $('#tb-battery-pct').textContent = `${t.battery}%`;
    $('#tb-battery-fill').setAttribute('width', String(Math.max(1, Math.round(14 * t.battery / 100))));
    $('#tb-battery').title = `Battery ${t.battery}%${t.charging ? ', charging' : ''}`;
    $('#tb-battery').classList.toggle('tb-battery-low', t.battery <= 15 && !t.charging);
  }
}

async function refreshStatus() {
  const s = await api.shellStatus().catch(() => null);
  $('#tb-preview').hidden = s?.mode !== 'preview';
}

$('#tb-home').addEventListener('click', () => api.shellShow('home'));
$('#tb-apps').addEventListener('click', () => api.shellShow('apps'));
$('#tb-files').addEventListener('click', () => api.shellShow('files'));
$('#tb-power').addEventListener('click', () => api.shellMenu({ kind: 'power' }));
$('#tb-clock').addEventListener('click', () => api.shellMenu({ kind: 'clock' }));
$('#tb-volume').addEventListener('click', () => api.shellVolume('mute'));
$('#tb-volume').addEventListener('wheel', (e) => { e.preventDefault(); api.shellVolume(e.deltaY < 0 ? 'up' : 'down'); }, { passive: false });

$('#tb-windows').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-hwnd]');
  if (!b) return;
  const w = windows.find((x) => x.hwnd === b.dataset.hwnd);
  // Clicking the window in front minimizes it, like the Windows taskbar.
  await api.shellWindow({ hwnd: b.dataset.hwnd, action: w?.active ? 'minimize' : 'focus' }).catch(() => {});
  setTimeout(refreshWindows, 250);
});
$('#tb-windows').addEventListener('auxclick', (e) => {
  const b = e.target.closest('[data-hwnd]');
  if (b && e.button === 1) api.shellWindow({ hwnd: b.dataset.hwnd, action: 'close' }).catch(() => {});
});
$('#tb-windows').addEventListener('contextmenu', (e) => {
  const b = e.target.closest('[data-hwnd]');
  if (!b) return;
  e.preventDefault();
  const w = windows.find((x) => x.hwnd === b.dataset.hwnd);
  api.shellMenu({ kind: 'window', hwnd: b.dataset.hwnd, title: w?.title });
});

api.onSettingsChanged?.((s) => applyTheme(s));
applyTheme();
tick();
refreshWindows();
refreshTray();
refreshStatus();
setInterval(tick, 1000);
setInterval(refreshWindows, 1500);
setInterval(refreshTray, 30_000);
setInterval(refreshStatus, 5000);
