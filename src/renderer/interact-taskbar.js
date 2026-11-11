// Scorpion's taskbar inside the orb's screen (Interact): the same bar the Windows desktop has (taskbar.js), with
// the same functions and the same settings, so the orb's screen needs nothing around it. Scorpion (back to the
// Scorpion page), the intent wheel, Apps and Files, the pinned apps and every open window (an app's windows under
// one icon, groups, right-click menus), then the drives, network, battery, notifications, mail, chat, volume, the
// clock, Settings and power. A click on an open window puts it in a tile of the orb.
//
// Customized as before (right-click an empty part: Layout, Position, Hide automatically, names, centered, size,
// look, which items show...): it can be on any edge of the screen, drag an empty part of it to another edge to
// move it, drag its inner edge to make it thicker or thinner, and it can hide until the pointer reaches its edge.
// It is hidden while Scorpion's own taskbar window is on the screen, so there are never two.
import { layoutTaskbar } from './taskbar-core.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ico = (body) => `<svg class="itb-ico" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const ICON = {
  apps: ico('<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>'),
  files: ico('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  tray: ico('<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><path d="m14.5 16.5 2.5 2.5 2.5-2.5"/>'),
  drives: ico('<path d="M12 3v13"/><circle cx="12" cy="19" r="2"/><path d="M12 10 8 13v-2.5"/><rect x="6.5" y="8" width="3" height="2.5"/><path d="M12 8l4 2.5v1.5"/><circle cx="16" cy="13.3" r="1.1"/>'),
  net: ico('<path d="M2 9a15 15 0 0 1 20 0"/><path d="M5.5 12.5a10 10 0 0 1 13 0"/><path d="M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1"/>'),
  battery: ico('<rect x="2" y="7" width="18" height="10" rx="2"/><path d="M22 11v2"/><rect id="itb-battery-fill" x="4" y="9" width="14" height="6" rx="1" class="itb-fill"/>'),
  notifications: ico('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
  mail: ico('<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6.5L20.5 7"/>'),
  chat: ico('<path d="M12 4c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7c-1 0-2-.1-2.9-.4L5 19.5l1.2-3.6C4.5 14.6 3.5 12.9 3.5 11 3.5 7.1 7.3 4 12 4z"/>'),
  volume: ico('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a9 9 0 0 1 0 12"/>'),
  power: ico('<path d="M12 3v9"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>'),
  settings: ico('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>'),
  summon: '<svg class="itb-sum" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.2" fill="none"/><circle cx="12" cy="12" r="6.4" fill="none" opacity=".6"/><circle class="itb-core" cx="12" cy="12" r="2.8"/></svg>',
  logo: '<svg class="itb-logo" viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(-45 50 53) translate(50 53) scale(1.18) translate(-50 -53)"><polygon points="43.7,47 38.5,36.6 50,10 61.5,36.6 56.3,47" fill="var(--accent)"/><rect x="46.4" y="46" width="7.2" height="34" fill="var(--accent-2, var(--accent))"/><circle cx="50" cy="86.5" r="5.9" fill="none" stroke="var(--accent)" stroke-width="3.4"/></g></svg>',
};

// Where it can be, and how thick (the same limits and defaults as the taskbar window: shell.js).
export const EDGES = ['bottom', 'top', 'left', 'right'];
const LIMITS = { 'bar-across': [32, 96], 'bar-side': [44, 140], 'rail-across': [44, 140], 'rail-side': [56, 170] };
const DEFAULT_PX = { 'bar-across': 48, 'bar-side': 60, 'rail-across': 64, 'rail-side': 76 };
const across = (e) => e === 'top' || e === 'bottom';
// The edge: the one chosen, else the rail down the right, or the bar along the bottom.
export const edgeOf = (look) => (EDGES.includes(look?.edge) ? look.edge : look?.layout === 'bar' ? 'bottom' : 'right');
export const sizeKey = (look, edge = edgeOf(look)) => `${look?.layout === 'bar' ? 'bar' : 'rail'}-${across(edge) ? 'across' : 'side'}`;
export const fitSize = (key, px) => { const [lo, hi] = LIMITS[key]; return Math.round(Math.min(hi, Math.max(lo, px))); };
export const thicknessOf = (look, live = null) => {
  const edge = edgeOf(look);
  const key = sizeKey(look, edge);
  const own = live?.key === key ? live.px : look?.sizes?.[key];
  return fitSize(key, Number.isFinite(own) ? own : DEFAULT_PX[key]);
};
// The nearest edge of a rectangle to a point (dropping the bar somewhere moves it there).
export function nearestEdge(rect, x, y) {
  const d = { bottom: rect.bottom - y, top: y - rect.top, left: x - rect.left, right: rect.right - x };
  return EDGES.reduce((best, e) => (d[e] < d[best] ? e : best), 'bottom');
}

// ctx: { api, $, S, isOpen(), go: { home, apps, files, settings }, openWindow(w), onChange(), save(patch): keeps taskbar settings }
export function initInteractTaskbar({ api, $, S, isOpen, go, openWindow, onChange, save }) {
  const root = $('#ix-taskbar');
  const host = $('#interact');
  root.innerHTML = `
    <div class="itb-grip" id="itb-grip" title="Drag to make the taskbar thicker or thinner" aria-hidden="true"></div>
    <div class="itb-start">
      <button class="itb-btn" id="itb-home" title="Scorpion: Home">${ICON.logo}</button>
      <button class="itb-btn" id="itb-summon" title="The intent wheel (Win+Shift+Space)">${ICON.summon}</button>
      <button class="itb-btn" id="itb-apps" title="Apps">${ICON.apps}</button>
      <button class="itb-btn" id="itb-files" title="Files">${ICON.files}</button>
    </div>
    <div class="itb-apps" id="itb-apps-area"><nav class="itb-pinned" id="itb-pinned" aria-label="Pinned apps"></nav><span class="itb-sep" id="itb-sep" hidden></span><nav class="itb-windows" id="itb-windows" aria-label="Open windows"></nav></div>
    <div class="itb-tray">
      <button class="itb-btn itb-item" id="itb-tray" hidden title="Network, notifications, mail, chat and sound" aria-haspopup="menu">${ICON.tray}</button>
      <button class="itb-btn itb-item" id="itb-drives" hidden title="USB and external drives" aria-haspopup="menu">${ICON.drives}</button>
      <span class="itb-item" id="itb-net" title="Network">${ICON.net}</span>
      <span class="itb-item" id="itb-battery" hidden>${ICON.battery}<span id="itb-battery-pct"></span></span>
      <button class="itb-btn itb-item" data-glance="notifications" title="Notifications">${ICON.notifications}</button>
      <button class="itb-btn itb-item" data-glance="mail" title="Mail">${ICON.mail}</button>
      <button class="itb-btn itb-item" data-glance="chat" title="Chat with Scorpion">${ICON.chat}</button>
      <button class="itb-btn itb-item" id="itb-volume" title="Volume: click to mute, scroll to change">${ICON.volume}</button>
      <button class="itb-btn itb-clock" id="itb-clock" title="Calendar"><span id="itb-time"></span><span id="itb-date"></span></button>
      <button class="itb-btn" id="itb-settings" title="Settings (the orb's are under General → Orb)">${ICON.settings}</button>
      <button class="itb-btn" id="itb-power" title="Power">${ICON.power}</button>
    </div>`;
  const snap = document.createElement('div');
  snap.className = 'itb-snap';
  snap.hidden = true;
  host.appendChild(snap);
  const q = (s) => root.querySelector(s);
  let windows = [];
  let pinned = [];
  let look = { labels: true, size: 'normal', style: 'holo', show: {}, groups: [], combine: true };
  let shown = { pins: [], wins: [] };
  let live = null; // a thickness being dragged: { key, px }
  let revealed = false;
  let holdUntil = 0;
  let hideTimer = 0;
  let lastInsets = '';

  const realBar = () => { // Scorpion's own taskbar window takes room at an edge: then this one is not needed
    const cs = getComputedStyle(document.documentElement);
    return ['--tb-t', '--tb-w', '--tb-h', '--tb-l'].some((v) => parseFloat(cs.getPropertyValue(v)) > 0);
  };
  const visible = () => isOpen() && !realBar();
  // The room it takes from the orb's stage (none when it hides by itself).
  const insets = () => {
    const none = { top: 0, right: 0, bottom: 0, left: 0 };
    if (!visible() || look.autoHide === true) return none;
    return { ...none, [edgeOf(look)]: thicknessOf(look, live) };
  };

  function apply(settings) {
    const s = settings || S.settings || {};
    look = { labels: true, size: 'normal', style: 'holo', layout: 'orbit', ...(s.taskbar || {}), show: { network: true, battery: true, volume: true, clock: true, notifications: true, mail: true, chat: true, ...(s.taskbar?.show || {}) } };
    const edge = edgeOf(look);
    for (const c of [...root.classList]) if (/^itb-(at|style|size)-/.test(c)) root.classList.remove(c);
    root.classList.add(`itb-at-${edge}`, `itb-style-${['holo', 'neon', 'glass', 'solid'].includes(look.style) ? look.style : 'holo'}`, `itb-size-${['small', 'normal', 'large'].includes(look.size) ? look.size : 'normal'}`);
    root.classList.toggle('itb-icons-only', !look.labels || !across(edge)); // down a side there is only room for icons
    root.classList.toggle('itb-center', Boolean(look.center) && across(edge));
    root.classList.toggle('itb-grouped', look.groupTray === true);
    root.classList.toggle('itb-autohide', look.autoHide === true);
    if (look.autoHide !== true) { revealed = false; root.classList.remove('itb-hidden'); } else if (!revealed) root.classList.add('itb-hidden');
    q('#itb-tray').hidden = look.groupTray !== true;
    for (const [k, el] of [['network', '#itb-net'], ['volume', '#itb-volume'], ['clock', '#itb-clock'], ['notifications', '[data-glance="notifications"]'], ['mail', '[data-glance="mail"]'], ['chat', '[data-glance="chat"]']]) q(el).hidden = look.show[k] === false;
    q('#itb-battery').dataset.off = look.show.battery === false ? '1' : '';
    place();
  }
  // Its thickness and the room it keeps, as CSS the orb's screen reads (the stage, the typing row, the captions).
  function place() {
    const px = thicknessOf(look, live);
    const ins = insets();
    host.style.setProperty('--itb', `${px}px`);
    for (const [k, v] of [['t', ins.top], ['r', ins.right], ['b', ins.bottom], ['l', ins.left]]) host.style.setProperty(`--itb-${k}`, `${v}px`);
    const key = JSON.stringify(ins) + root.hidden;
    if (key !== lastInsets) { lastInsets = key; onChange?.(); }
  }

  const icon = (src, name) => (src ? `<img src="${esc(src)}" alt="">` : `<span class="itb-initial">${esc(String(name).slice(0, 1).toUpperCase())}</span>`);
  const count = (n) => (n > 1 ? `<span class="itb-count" aria-hidden="true">${n}</span>` : '');
  function render() {
    shown = layoutTaskbar({ pinned, windows, groups: look.groups, combine: look.combine !== false });
    q('#itb-pinned').innerHTML = shown.pins.map((it) => {
      const state = `${it.running ? ' running' : ''}${it.active ? ' active' : ''}`;
      if (it.kind === 'group') return `<button class="itb-btn itb-win itb-pin${state}" data-group="${esc(it.id)}" aria-haspopup="menu" title="${esc(it.name)}: ${esc(it.apps.map((a) => a.name).join(', '))}"><span class="itb-stack">${it.apps.slice(0, 4).map((a) => icon(a.icon, a.name)).join('')}</span><span class="itb-title">${esc(it.name)}</span></button>`;
      const p = it.app;
      return `<button class="itb-btn itb-win itb-pin${state}" data-pin="${esc(p.id)}" title="${esc(p.name)}${it.windows.length > 1 ? ` (${it.windows.length} windows)` : ''}">${icon(p.icon, p.name)}<span class="itb-title">${esc(p.name)}</span>${count(it.windows.length)}</button>`;
    }).join('');
    q('#itb-windows').innerHTML = shown.wins.map((it) => {
      if (it.kind === 'windows') return `<button class="itb-btn itb-win running${it.active ? ' active' : ''}" data-wins="${esc(it.key)}" aria-haspopup="menu" title="${esc(it.name)} (${it.windows.length} windows)">${icon(it.icon, it.name)}<span class="itb-title">${esc(it.name)}</span>${count(it.windows.length)}</button>`;
      const w = it.w;
      return `<button class="itb-btn itb-win running${w.active ? ' active' : ''}" data-hwnd="${esc(w.hwnd)}" title="${esc(w.title)}">${icon(w.icon, w.process || w.title)}<span class="itb-title">${esc(w.title)}</span></button>`;
    }).join('');
    q('#itb-sep').hidden = !shown.pins.length || !shown.wins.length;
  }
  async function refreshWindows() {
    try {
      const next = (await api.shellWindows()).filter((w) => !w.self);
      const key = (l) => l.map((w) => `${w.hwnd}|${w.title}|${w.active}`).join('\n');
      if (key(next) !== key(windows)) { windows = next; render(); }
    } catch { /* locked or busy: keep the last list */ }
  }
  async function refreshTray() {
    const t = await api.shellTray().catch(() => ({}));
    q('#itb-net').title = t.network ? `Connected: ${t.network}` : 'Not connected';
    q('#itb-net').style.opacity = t.network ? 1 : 0.4;
    const has = typeof t.battery === 'number';
    q('#itb-battery').hidden = !has || q('#itb-battery').dataset.off === '1';
    if (has) {
      q('#itb-battery-pct').textContent = `${t.battery}%`;
      q('#itb-battery-fill').setAttribute('width', String(Math.max(1, Math.round(14 * t.battery / 100))));
      q('#itb-battery').title = `Battery ${t.battery}%${t.charging ? ', charging' : ''}`;
      q('#itb-battery').classList.toggle('itb-battery-low', t.battery <= 15 && !t.charging);
    }
  }
  const showDrives = (list) => { const n = Array.isArray(list) ? list.length : 0; q('#itb-drives').hidden = !n; q('#itb-drives').title = n ? `${n} USB or external drive${n === 1 ? '' : 's'}: click to open or eject` : 'USB and external drives'; };
  function clock() {
    const now = new Date();
    q('#itb-time').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s*[AaPp]\.?[Mm]\.?$/, '');
    q('#itb-date').textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // The buttons. A menu from the bar keeps it showing a little while (it hides by itself otherwise).
  const hold = (ms = 5000) => { holdUntil = Date.now() + ms; };
  q('#itb-home').onclick = () => go.home();
  q('#itb-summon').onclick = () => api.shellWheel({ open: true, centre: true });
  q('#itb-apps').onclick = () => go.apps();
  q('#itb-files').onclick = () => go.files();
  q('#itb-settings').onclick = () => go.settings();
  q('#itb-power').onclick = () => { hold(); api.shellMenu({ kind: 'power' }); };
  q('#itb-clock').onclick = () => { hold(); api.shellMenu({ kind: 'clock' }); };
  q('#itb-tray').onclick = () => { hold(); api.shellMenu({ kind: 'tray' }); };
  q('#itb-drives').onclick = () => { hold(); api.shellMenu({ kind: 'drives' }); };
  for (const b of root.querySelectorAll('[data-glance]')) b.onclick = () => api.shellGlance(b.dataset.glance).catch(() => {});
  q('#itb-volume').onclick = () => api.shellVolume('mute');
  q('#itb-volume').addEventListener('wheel', (e) => { e.preventDefault(); api.shellVolume(e.deltaY < 0 ? 'up' : 'down'); }, { passive: false });
  const groupMenu = (id) => { hold(); api.shellMenu({ kind: 'group', id }); };
  const windowsMenu = (list, name) => { hold(); api.shellMenu({ kind: 'windows', name, hwnds: list.map((w) => w.hwnd) }); };
  const toggle = (w) => { openWindow(w); setTimeout(refreshWindows, 400); };
  q('#itb-apps-area').addEventListener('click', (e) => {
    const win = e.target.closest('[data-hwnd]');
    if (win) { const w = windows.find((x) => x.hwnd === win.dataset.hwnd); if (w) toggle(w); return; }
    const group = e.target.closest('[data-group]');
    if (group) { groupMenu(group.dataset.group); return; }
    const wins = e.target.closest('[data-wins]');
    if (wins) { const it = shown.wins.find((x) => x.key === wins.dataset.wins); if (it) windowsMenu(it.windows, it.name); return; }
    const pin = e.target.closest('[data-pin]');
    const it = pin && shown.pins.find((x) => x.app?.id === pin.dataset.pin);
    if (!it) return;
    const open = it.windows;
    // Not running: open it (it opens inside the orb). One window: like a window button. Several: the list of them.
    if (!open.length) { pin.classList.add('launching'); setTimeout(() => pin.classList.remove('launching'), 1200); api.shellLaunch({ id: it.app.id, name: it.app.name }).catch(() => {}); return; }
    if (open.length === 1) { toggle(open[0]); return; }
    if (look.combine !== false) { windowsMenu(open, it.app.name); return; }
    const i = open.findIndex((w) => w.active);
    toggle(open[(i + 1) % open.length]);
  });
  q('#itb-apps-area').addEventListener('auxclick', (e) => {
    const b = e.target.closest('[data-hwnd]');
    if (b && e.button === 1) api.shellWindow({ hwnd: b.dataset.hwnd, action: 'close' }).catch(() => {});
  });
  root.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    hold(60_000);
    const win = e.target.closest('[data-hwnd]');
    if (win) { const w = windows.find((x) => x.hwnd === win.dataset.hwnd); api.shellMenu({ kind: 'window', hwnd: win.dataset.hwnd, title: w?.title, exe: w?.exe }); return; }
    const group = e.target.closest('[data-group]');
    if (group) { groupMenu(group.dataset.group); return; }
    const wins = e.target.closest('[data-wins]');
    if (wins) { const it = shown.wins.find((x) => x.key === wins.dataset.wins); if (it) windowsMenu(it.windows, it.name); return; }
    const pin = e.target.closest('[data-pin]');
    if (pin) { const p = pinned.find((x) => x.id === pin.dataset.pin); if (p) api.shellMenu({ kind: 'pinned', id: p.id, name: p.name }); return; }
    if (!e.target.closest('button')) api.shellMenu({ kind: 'bar' }); // an empty part: customize
  });

  // Hiding by itself: it slides away (a thin line stays) and the pointer at its edge brings it back.
  const showBar = () => { clearTimeout(hideTimer); if (look.autoHide === true && !revealed) { revealed = true; root.classList.remove('itb-hidden'); } };
  const hideSoon = () => {
    if (look.autoHide !== true) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (Date.now() < holdUntil || drag || gripping) { hideSoon(); return; }
      revealed = false;
      root.classList.add('itb-hidden');
    }, 650);
  };
  root.addEventListener('pointerenter', showBar);
  root.addEventListener('pointerleave', hideSoon);
  host.addEventListener('pointermove', (e) => {
    if (look.autoHide !== true || !visible()) return;
    const r = host.getBoundingClientRect();
    const d = { bottom: r.bottom - e.clientY, top: e.clientY - r.top, left: e.clientX - r.left, right: r.right - e.clientX }[edgeOf(look)];
    if (d <= 6) showBar();
  });

  // Moving it: drag an empty part to another edge of the screen.
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, .itb-item, .itb-grip, .itb-win')) return;
    drag = { x: e.clientX, y: e.clientY, moved: false, edge: edgeOf(look) };
    root.setPointerCapture(e.pointerId);
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 14) return;
    drag.moved = true;
    const r = host.getBoundingClientRect();
    drag.edge = nearestEdge(r, e.clientX, e.clientY);
    snap.hidden = false;
    snap.dataset.edge = drag.edge;
    root.classList.add('itb-dragging');
  });
  const endDrag = () => {
    const d = drag;
    drag = null;
    snap.hidden = true;
    root.classList.remove('itb-dragging');
    if (d?.moved && d.edge !== edgeOf(look)) save?.({ edge: d.edge });
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);

  // Its thickness: drag the inner edge.
  let gripping = null;
  const grip = q('#itb-grip');
  const pxAt = (e) => { const r = host.getBoundingClientRect(); return { bottom: r.bottom - e.clientY, top: e.clientY - r.top, left: e.clientX - r.left, right: r.right - e.clientX }[edgeOf(look)]; };
  grip.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; gripping = { key: sizeKey(look) }; grip.setPointerCapture(e.pointerId); root.classList.add('itb-dragging'); e.stopPropagation(); });
  grip.addEventListener('pointermove', (e) => { if (!gripping) return; live = { key: gripping.key, px: fitSize(gripping.key, pxAt(e)) }; place(); });
  const endGrip = () => {
    if (!gripping) return;
    const g = gripping;
    gripping = null;
    root.classList.remove('itb-dragging');
    if (live) save?.({ sizes: { ...(look.sizes || {}), [g.key]: live.px } });
    live = null;
  };
  grip.addEventListener('pointerup', endGrip);
  grip.addEventListener('pointercancel', endGrip);

  // Alive only while the orb is open and this bar is the one showing.
  let timers = [];
  let on = false;
  async function sync() {
    const want = visible();
    root.hidden = !want;
    if (want !== on) {
      on = want;
      for (const t of timers) clearInterval(t);
      timers = [];
      if (on) {
        apply();
        clock(); refreshWindows(); refreshTray(); // what is open and the clock at once; the pinned apps (a scan of the Start menu) when they come
        api.shellPinned().then((p) => { pinned = p; render(); }).catch(() => {});
        api.shellDrives?.().then(showDrives).catch(() => {});
        const poll = { full: 1500, balanced: 2500, light: 4000 }[S.perf] || 1500;
        timers = [setInterval(clock, 1000), setInterval(refreshWindows, poll), setInterval(refreshTray, 30_000), setInterval(() => api.shellDrives?.().then(showDrives).catch(() => {}), 30_000)];
      }
    }
    place();
  }
  api.onDrivesChanged?.(showDrives);
  setInterval(sync, 700);
  return { sync, apply: (s) => { apply(s); render(); }, insets, refresh: () => { sync(); refreshWindows(); } };
}
