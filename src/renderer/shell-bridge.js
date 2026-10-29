// window.scorpion for Scorpion's shell pages when the native shell host shows
// them (Scorpion OS: WebKitGTK in Wayland layer-shell panels) rather than
// Electron: the same methods as preload.cjs (src/shared/shell-channels.js),
// carried over the local shell API (src/main/shell-api.js). The page's URL
// holds the API's key (http://127.0.0.1:PORT/KEY/edge.html). Things only the
// host can do (placing the panel, native menus) go to it through WebKit's
// message handler "scorpionShell". A classic script, so it runs before the
// page's modules.
(() => {
  if (window.scorpion) return; // Electron's preload already gave it
  const base = location.pathname.split('/').slice(0, 2).join('/'); // "/KEY"
  const CALLS = {
    state: 'app:state', shellPinned: 'shell:pinned', shellWindows: 'shell:windows', shellWindow: 'shell:window',
    shellTray: 'shell:tray', shellLaunch: 'shell:launch', shellVolume: 'shell:volume', shellMenu: 'shell:menu',
    shellGlance: 'shell:glance', shellRecent: 'shell:recent', shellIntent: 'shell:intent', shellIntents: 'shell:intents',
    shellWheel: 'shell:wheel', shellPalette: 'shell:palette', shellQuick: 'shell:quick', shellInstall: 'shell:install', constPreview: 'const:preview', notifications: 'shell:notifications', notificationAct: 'shell:notificationAct',
    shellStagePick: 'shell:stagePick', shellDot: 'shell:dot',
  };
  const EVENTS = {
    onSettingsChanged: 'settings:changed', onPerfChanged: 'perf:changed', onWheelOpen: 'wheel:open', onWheelClose: 'wheel:close',
    onNotify: 'shell:notify', onNotificationsChanged: 'shell:notifications', onOsd: 'shell:osd',
    onStageShow: 'stage:show', onStageHide: 'stage:hide', onStageArrive: 'stage:arrive', onRail: 'shell:rail',
  };
  // Where the pointer was last pressed: native menus open there.
  let point = { x: 0, y: 0 };
  for (const ev of ['pointerdown', 'contextmenu']) addEventListener(ev, (e) => { point = { x: Math.round(e.clientX), y: Math.round(e.clientY) }; }, true);
  const host = (msg) => { try { window.webkit?.messageHandlers?.scorpionShell?.postMessage(JSON.stringify(msg)); } catch { /* not in the host */ } };
  async function call(channel, arg) {
    const r = await fetch(`${base}/ipc/${encodeURIComponent(channel)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(arg ?? null) });
    const out = await r.json();
    if (!out.ok) throw new Error(out.error || 'Scorpion did not answer');
    return out.value;
  }
  const listeners = {};
  let source = null;
  const connect = () => {
    source = new EventSource(`${base}/events`);
    for (const ch of Object.values(EVENTS)) source.addEventListener(ch, (e) => { for (const fn of listeners[ch] || []) fn(JSON.parse(e.data)); });
    source.onerror = () => { source.close(); setTimeout(connect, 2000); }; // Scorpion restarting
  };
  connect();
  const api = { host };
  for (const [name, ch] of Object.entries(CALLS)) api[name] = (arg) => call(ch, arg);
  for (const [name, ch] of Object.entries(EVENTS)) api[name] = (fn) => { (listeners[ch] ||= []).push(fn); return () => { listeners[ch] = listeners[ch].filter((f) => f !== fn); }; };
  // Menus: Scorpion describes it, the host shows it natively next to the pointer.
  api.shellMenu = async (arg) => {
    const menu = await call('shell:menu', { ...arg, describe: true });
    if (menu?.items) host({ type: 'menu', ...menu, ...point });
    return true;
  };
  window.scorpion = api;
  window.scorpionHost = true;
})();
