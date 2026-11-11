// The floating orb: a small orb that floats over every window while Scorpion's own
// window is in the background. It listens for "Scorpion" (the main window's page does
// the listening and speaking; this is only what is shown), wakes up when called, shows
// what is said beside it, and goes small again. Drag it anywhere; click it to call
// Scorpion; right-click for the menu.

export const ORB = 72; // the orb's size on the screen
export const BUBBLE = 248; // the room beside it for what is said

// Where the window goes: the orb's top-left corner stays where it is, clamped to the
// screen's work area; with words showing, the window grows toward the middle of the
// screen (the orb is on its right when it sits on the right half).
export function floatBounds(anchor, work, expanded) {
  const x = Math.max(work.x, Math.min(work.x + work.width - ORB, Math.round(anchor.x)));
  const y = Math.max(work.y, Math.min(work.y + work.height - ORB, Math.round(anchor.y)));
  const side = x + ORB / 2 > work.x + work.width / 2 ? 'right' : 'left';
  if (!expanded) return { x, y, width: ORB, height: ORB, side, orbX: x, orbY: y };
  return { x: side === 'right' ? x + ORB - (ORB + BUBBLE) : x, y, width: ORB + BUBBLE, height: ORB, side, orbX: x, orbY: y };
}

// deps: { BrowserWindow, screen, ipcMain, url, preload, theme(), getPos(), setPos(p), onCall(), onMenu() }
export function createFloatOrb({ BrowserWindow, screen, ipcMain, url, preload, theme, getPos, setPos, onCall, onMenu }) {
  let w = null;
  let ready = null;
  let anchor = null;
  let want = false;
  let expanded = false;
  let drag = null;
  const ownEvent = (e) => w && !w.isDestroyed() && e.sender === w.webContents;

  const area = () => screen.getDisplayNearestPoint(anchor ? { x: anchor.x, y: anchor.y } : screen.getCursorScreenPoint()).workArea;
  function place() {
    if (!w || w.isDestroyed()) return null;
    if (!anchor) {
      const pos = getPos?.();
      const work = screen.getPrimaryDisplay().workArea;
      anchor = pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) ? { x: pos.x, y: pos.y } : { x: work.x + work.width - ORB - 24, y: work.y + work.height - ORB - 24 };
    }
    const b = floatBounds(anchor, area(), expanded);
    anchor = { x: b.orbX, y: b.orbY };
    w.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    return b;
  }
  function make() {
    if (w && !w.isDestroyed()) return w;
    w = new BrowserWindow({
      width: ORB, height: ORB, show: false, frame: false, transparent: true, resizable: false, hasShadow: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, minimizable: false, maximizable: false,
      webPreferences: { preload, sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
    ready = w.loadURL(url).catch(() => {});
    w.on('closed', () => { w = null; });
    return w;
  }
  const push = async (payload) => {
    if (!w || w.isDestroyed()) return;
    await ready;
    if (!w || w.isDestroyed()) return;
    w.webContents.executeJavaScript(`window.showFloat?.(${JSON.stringify(payload)})`).catch(() => {});
  };

  // On or off (Scorpion's window came forward, or the setting changed).
  async function show(on) {
    want = Boolean(on);
    if (!want) { if (w && !w.isDestroyed()) w.hide(); return; }
    make();
    const b = place();
    await push({ theme: theme?.(), side: b?.side });
    if (want && w && !w.isDestroyed()) w.showInactive();
  }
  // state: standby | listening | thinking | speaking; text: what to show beside the orb ('' none).
  async function update({ state = 'standby', text = '' } = {}) {
    if (!want || !w || w.isDestroyed()) return;
    const open = Boolean(String(text).trim());
    let b = null;
    if (open !== expanded) { expanded = open; b = place(); }
    await push({ state, text: String(text).slice(0, 220), theme: theme?.(), side: (b || floatBounds(anchor, area(), expanded)).side });
  }

  ipcMain.on('float:click', (e) => { if (ownEvent(e)) onCall?.(); });
  ipcMain.on('float:menu', (e) => { if (ownEvent(e)) onMenu?.(); });
  ipcMain.on('float:drag', (e, d) => {
    if (!ownEvent(e) || !d || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return;
    if (d.phase === 'start') { drag = { x: d.x, y: d.y, from: { ...anchor } }; return; }
    if (!drag) return;
    anchor = { x: drag.from.x + (d.x - drag.x), y: drag.from.y + (d.y - drag.y) };
    place();
    if (d.phase === 'end') { setPos?.({ ...anchor }); drag = null; }
  });

  return { show, update, get visible() { return Boolean(w && !w.isDestroyed() && w.isVisible()); }, destroy: () => { if (w && !w.isDestroyed()) w.destroy(); w = null; } };
}
