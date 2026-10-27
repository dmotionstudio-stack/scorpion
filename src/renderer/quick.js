// Quick settings on Scorpion OS: the panel the rail's network, battery and
// volume open (the native shell host shows this page beside the rail).
// Wi-Fi and Bluetooth (on/off, networks and devices), volume and the sound
// output, brightness, the battery and the power mode. Every change goes to
// the main process (shell:quick), which answers with how things are now.
import { wifiSub, btSub, batteryLine, bars, needsPassword } from './quick-core.js';

const api = window.scorpion;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const Q = { open: false, state: null, expanded: null, joining: null, busy: false, scanning: { wifi: false, bt: false }, closedAt: 0, focused: false, timer: 0, found: [] };

// The host makes the panel as tall as the page, and hides it when closed.
function fit() {
  api.host?.({ type: 'size', panel: 'quick', height: Math.ceil(document.body.scrollHeight), visible: Q.open });
}
function say(text, error = false) {
  $('#qs-msg').hidden = !text;
  $('#qs-msg').textContent = text || '';
  $('#qs-msg').classList.toggle('error', error);
  fit();
}

function render() {
  const s = Q.state;
  if (!s?.supported) { say('Quick settings are part of Scorpion OS.'); return; }
  const { wifi, bluetooth: bt, sound, brightness, battery } = s;

  // Tiles.
  const tile = (id, on, none, sub) => {
    $(id).classList.toggle('on', on);
    $(id).classList.toggle('none', none);
    $(`${id} .qs-tile-main`).setAttribute('aria-pressed', String(on));
    $(`${id} small`).textContent = sub;
  };
  tile('#qs-wifi', wifi.adapter && wifi.on, !wifi.adapter, wifiSub(wifi));
  tile('#qs-bt', bt.adapter && bt.on, !bt.adapter, btSub(bt));
  for (const b of document.querySelectorAll('[data-expand]')) b.setAttribute('aria-expanded', String(Q.expanded === b.dataset.expand));
  renderWifiList();
  renderBtList();

  // Sound: the slider isn't moved while it's being dragged.
  const vol = $('#qs-volume');
  if (sound.level !== null && document.activeElement !== vol) vol.value = sound.level;
  $('#qs-volume-pct').textContent = sound.level === null ? '' : sound.muted ? 'Muted' : `${sound.level}%`;
  $('#qs-mute').classList.toggle('muted', sound.muted);
  $('#qs-mute').title = sound.muted ? 'Unmute' : 'Mute';
  $('#qs-output-row').hidden = sound.outputs.length < 2;
  $('#qs-output').innerHTML = sound.outputs.map((o) => `<option value="${o.id}"${o.active ? ' selected' : ''}>${esc(o.name)}</option>`).join('');

  $('#qs-bright').hidden = !brightness;
  if (brightness && document.activeElement !== $('#qs-brightness')) $('#qs-brightness').value = brightness.level;
  if (brightness) $('#qs-bright-pct').textContent = `${brightness.level}%`;

  const line = batteryLine(battery);
  $('#qs-battery').hidden = !line && !battery.profile;
  $('#qs-battery-pct').textContent = line?.pct || 'Power mode';
  $('#qs-battery-time').textContent = line?.detail || '';
  $('#qs-modes').hidden = !battery.profile;
  for (const b of document.querySelectorAll('[data-profile]')) b.setAttribute('aria-checked', String(b.dataset.profile === battery.profile));
  fit();
}

function renderWifiList() {
  const box = $('#qs-wifi-list');
  box.hidden = Q.expanded !== 'wifi';
  if (box.hidden) return;
  const { wifi } = Q.state;
  if (!wifi.on) { box.innerHTML = '<div class="qs-note">Wi-Fi is off.</div>'; return; }
  const nets = wifi.networks;
  const rows = (nets || []).map((n) => `
    <button class="qs-item${n.connected ? ' current' : ''}" data-ssid="${esc(n.ssid)}">
      <span class="qs-bars">${[1, 2, 3, 4].map((i) => `<i class="${i <= bars(n.signal) ? 'lit' : ''}" style="height:${i * 3}px"></i>`).join('')}</span>
      <span class="qs-name">${esc(n.ssid)}</span>
      <span class="qs-side">${n.connected ? 'Connected' : n.secure ? '🔒' : 'Open'}</span>
    </button>
    ${Q.joining === n.ssid ? `<form class="qs-join" data-join="${esc(n.ssid)}"><input type="password" placeholder="Password" autocomplete="off" aria-label="Password for ${esc(n.ssid)}" required><button class="qs-btn primary">Join</button></form>` : ''}`).join('');
  box.innerHTML = (nets === null ? '<div class="qs-note">Looking for networks…</div>' : rows || '<div class="qs-note">No networks in range.</div>')
    + `<div class="qs-list-foot"><button class="qs-btn" data-wifi-scan>${Q.scanning.wifi ? 'Searching…' : 'Search again'}</button>${wifi.connected ? '<button class="qs-btn" data-wifi-off>Disconnect</button>' : ''}</div>`;
  box.querySelector('.qs-join input')?.focus();
}

function renderBtList() {
  const box = $('#qs-bt-list');
  box.hidden = Q.expanded !== 'bt';
  if (box.hidden) return;
  const bt = Q.state.bluetooth;
  if (!bt.on) { box.innerHTML = '<div class="qs-note">Bluetooth is off.</div>'; return; }
  const known = bt.devices || [];
  const found = Q.found.filter((d) => !known.some((k) => k.mac === d.mac));
  const row = (d, label) => `<button class="qs-item${d.connected ? ' current' : ''}" data-mac="${esc(d.mac)}" data-connected="${d.connected ? 1 : ''}"><span class="qs-name">${esc(d.name)}</span><span class="qs-side">${label}</span></button>`;
  box.innerHTML = (known.map((d) => row(d, d.connected ? 'Disconnect' : 'Connect')).join('') || '<div class="qs-note">No devices yet.</div>')
    + (found.length ? `<div class="qs-note">Found nearby</div>${found.map((d) => row(d, 'Pair')).join('')}` : '')
    + `<div class="qs-list-foot"><button class="qs-btn" data-bt-scan>${Q.scanning.bt ? 'Searching… (put the device in pairing mode)' : 'Add a device'}</button></div>`;
}

// One call to the main process; the answer is the new state.
async function call(arg = {}, { quiet = false } = {}) {
  try {
    const s = await api.shellQuick(arg);
    if (arg.btScan && s.bluetooth?.devices) Q.found = s.bluetooth.devices.filter((d) => !d.paired);
    // Only a scan lists networks; between scans the last list stays, with
    // the network in use marked from what's true now.
    const last = Q.state?.wifi;
    if (s.wifi && s.wifi.networks === null && s.wifi.on && last?.networks) {
      s.wifi.networks = last.networks.map((n) => ({ ...n, connected: n.ssid === s.wifi.connected }));
      s.wifi.known = [...new Set([...(last.known || []), ...(s.wifi.connected ? [s.wifi.connected] : [])])];
    }
    Q.state = s;
    if (s.error) say(s.error, true); else if (!quiet) say(s.result || '');
    render();
    return s;
  } catch (err) {
    say(String(err.message || err), true);
    return null;
  }
}
const act = (action, value, more) => call({ action, value, ...more });

async function scanWifi() {
  Q.scanning.wifi = true; render();
  await call({ wifiScan: true }, { quiet: true });
  Q.scanning.wifi = false; render();
}
async function scanBt() {
  Q.scanning.bt = true; render();
  await call({ btScan: true }, { quiet: true });
  Q.scanning.bt = false; render();
}

function expand(which) {
  Q.expanded = Q.expanded === which ? null : which;
  Q.joining = null;
  render();
  if (Q.expanded === 'wifi' && Q.state?.wifi?.on && !Q.state.wifi.networks) scanWifi();
}

// Opened from the rail: "network" shows the networks, "battery" and "sound" the rest.
async function open(section) {
  if (Date.now() - Q.closedAt < 400) return; // the click on the rail that closed it
  Q.open = true;
  $('#qs').hidden = false;
  say('');
  fit();
  await call({}, { quiet: true });
  if (section === 'network' && Q.state?.wifi?.adapter) { Q.expanded = null; expand('wifi'); }
  clearInterval(Q.timer);
  Q.timer = setInterval(() => { if (!Q.scanning.wifi && !Q.scanning.bt && !Q.joining) call({}, { quiet: true }); }, 5000);
}
function close() {
  if (!Q.open) return;
  Q.open = false;
  Q.closedAt = Date.now();
  Q.focused = false;
  Q.joining = null;
  clearInterval(Q.timer);
  $('#qs').hidden = true;
  fit();
}

// ---------- wiring ----------
document.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.closest('#qs-close')) { close(); return; }
  if (t.closest('#qs-all')) { act('settings', { page: 'home' }); close(); return; }
  const toggle = t.closest('[data-toggle]');
  if (toggle) {
    const s = Q.state;
    if (toggle.dataset.toggle === 'wifi' && s.wifi.adapter) { await act('wifi', { on: !s.wifi.on }); if (Q.expanded === 'wifi' && Q.state.wifi.on) scanWifi(); }
    if (toggle.dataset.toggle === 'bluetooth' && s.bluetooth.adapter) act('bluetooth', { on: !s.bluetooth.on });
    return;
  }
  const more = t.closest('[data-expand]');
  if (more) { expand(more.dataset.expand); return; }
  if (t.closest('[data-wifi-scan]')) { scanWifi(); return; }
  if (t.closest('[data-wifi-off]')) { act('wifiDisconnect'); return; }
  if (t.closest('[data-bt-scan]')) { if (!Q.scanning.bt) scanBt(); return; }
  const net = t.closest('[data-ssid]');
  if (net) {
    const n = Q.state.wifi.networks.find((x) => x.ssid === net.dataset.ssid);
    if (!n || n.connected) return;
    // A secured network: ask for the password (a known one connects without).
    if (needsPassword(n, Q.state.wifi.known) && Q.joining !== n.ssid) { Q.joining = n.ssid; render(); return; }
    say(`Connecting to ${n.ssid}…`);
    await act('wifiConnect', { ssid: n.ssid });
    return;
  }
  const dev = t.closest('[data-mac]');
  if (dev) {
    say(dev.dataset.connected ? 'Disconnecting…' : 'Connecting… (this can take 20 seconds)');
    await act(dev.dataset.connected ? 'btDisconnect' : 'btConnect', { mac: dev.dataset.mac });
    Q.found = Q.found.filter((d) => d.mac !== dev.dataset.mac);
    render();
    return;
  }
  const mode = t.closest('[data-profile]');
  if (mode) act('profile', { profile: mode.dataset.profile });
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target.closest('[data-join]');
  if (!form) return;
  const ssid = form.dataset.join;
  const password = form.querySelector('input').value;
  form.querySelector('input').value = '';
  Q.joining = null;
  say(`Connecting to ${ssid}…`);
  await act('wifiConnect', { ssid, password });
  if (Q.state?.error) { Q.joining = ssid; render(); } // wrong password: try again
});

// Sliders: changes go out while dragging, a few times a second at most.
const throttled = (fn, ms = 150) => { let t = 0, last; return (v) => { last = v; if (!t) t = setTimeout(() => { t = 0; fn(last); }, ms); }; };
const setVolume = throttled((level) => act('volume', { level }, { quiet: true }));
const setBright = throttled((level) => act('brightness', { level }, { quiet: true }));
$('#qs-volume').addEventListener('input', (e) => { $('#qs-volume-pct').textContent = `${e.target.value}%`; setVolume(Number(e.target.value)); });
$('#qs-brightness').addEventListener('input', (e) => { $('#qs-bright-pct').textContent = `${e.target.value}%`; setBright(Number(e.target.value)); });
$('#qs-mute').addEventListener('click', () => act('mute'));
$('#qs-output').addEventListener('change', (e) => act('output', { id: Number(e.target.value) }));

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
// Clicking elsewhere closes it once it has been used (the compositor may hand
// a new panel the keyboard and take it straight back, which isn't a click
// elsewhere).
addEventListener('pointerdown', () => { Q.focused = true; }, true);
addEventListener('blur', () => { if (Q.focused) close(); });

// The host relays the rail's clicks (edge.js) as a toggle with a section.
window.scorpionPanel = { toggle: (section) => (Q.open ? close() : open(section)), close };
api.state?.().then((st) => { if (st?.settings?.theme) document.documentElement.dataset.theme = st.settings.theme; }).catch(() => {});
api.onSettingsChanged?.((s) => { if (s?.theme) document.documentElement.dataset.theme = s.theme; });
fit();
