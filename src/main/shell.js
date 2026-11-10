// Scorpion as the Windows desktop ("shell"). When Windows starts Scorpion at
// sign-in (scorpion --shell), Scorpion shows its home screen as the desktop
// and its taskbar: by default a glance rail along the right edge (edge.html)
// with a summon button that opens the intent wheel (summon.html), the classic
// bar along the bottom (taskbar.html; right-click the taskbar → Layout). 'bar' (Settings: the holographic taskbar
// whenever Scorpion runs) takes over from the Windows taskbar on the normal
// Windows desktop: the Windows one is hidden while Scorpion's runs and comes
// back when it stops.
// Safety: starting it three times within three minutes (a crash loop) starts
// the Windows desktop instead; quitting Scorpion while it is the desktop starts
// the Windows desktop so the user is never left with an empty screen; and the
// switch itself (Winlogon Shell for this account) changes only from Settings.
import fs from 'node:fs';
import path from 'node:path';
import win from './system.js';
import { shellEvent } from './shell-api.js';

const WIN = process.platform === 'win32';
const TASKBAR_HEIGHT = 48; // the bar along the top or bottom
const BAR_SIDE = 60; // the bar down a side
const RAIL_WIDTH = 76; // the rail down a side
const RAIL_ACROSS = 64; // the rail along the top or bottom
const EDGES = ['right', 'left', 'top', 'bottom'];
// deps.autoHide: the taskbar hides until the pointer reaches its edge;
// deps.railAway: the rail floats while Scorpion's window is away; deps.wheel: the
// wheel's settings ({ size, recent, frosted }); deps.edge: the screen
// edge the taskbar is on (null: the rail down the right, the bar along the bottom).
let deps = null; // { BrowserWindow, screen, preload, dataDir, getMainWindow, showView, getLayout, perf, snapScreen, autoHide, railAway, edge }
let taskbar = null;
let summon = null; // the intent wheel's window (shown only while the wheel is open)
let wheelOpen = false;
let held = false; // a menu or dialog from the wheel is up: it stays open
let layout = 'orbit'; // 'orbit' (edge rail + wheel) | 'bar'
// On the normal Windows desktop the rail floats while Scorpion's window is
// minimized or hidden, and Win+Shift+Space opens the wheel whenever Scorpion runs.
let away = false;
let railFloats = false; // the rail is up on the Windows desktop (Scorpion minimized)
// Auto-hide: the taskbar slides away and the pointer at its edge brings it back.
let railHidden = false;
let railHeld = 0; // until when it stays (a menu from it is open)
let pointerWatch = 0;
// Scorpion OS's native shell host shows the rail and the wheel as
// layer-shell panels (os/.../scorpion-shell); then Scorpion makes none itself.
let hostMode = false;
let savedWorkArea = null;
let mode = null; // null | 'bar' | 'shell'
let keeper = 0; // 'bar': keeps the Windows taskbar hidden and the screen space reserved

export function initShell(d) { deps = d; }
export const shellMode = () => mode;
// Scorpion's taskbar back on top (Scorpion itself is on top in full mode).
export function raiseTaskbar() {
  if (taskbar && !taskbar.isDestroyed()) taskbar.moveTop();
  if (wheelOpen && summon && !summon.isDestroyed()) summon.moveTop();
}
// The edge of the screen the taskbar is on (Settings, or a right-click on
// it): by default the rail down the right, the bar along the bottom. The
// native shell host (Scorpion OS) always draws the rail.
export const railEdge = () => {
  const e = deps?.edge?.();
  return EDGES.includes(e) ? e : barLayout() && !hostMode ? 'bottom' : 'right';
};
const across = (e) => e === 'top' || e === 'bottom';
// How thick it is on that edge.
// Dragging its inner edge makes it thicker or thinner (deps.railSize keeps
// the size per kind: the rail or the bar, across or down a side).
const SIZE_LIMITS = { 'bar-across': [32, 96], 'bar-side': [44, 140], 'rail-across': [44, 140], 'rail-side': [56, 170] };
const sizeKey = (e) => `${barLayout() && !hostMode ? 'bar' : 'rail'}-${across(e) ? 'across' : 'side'}`;
const fitSize = (key, px) => { const [lo, hi] = SIZE_LIMITS[key]; return Math.round(Math.min(hi, Math.max(lo, px))); };
let liveSize = null; // while it's being dragged
export const railThickness = (e = railEdge()) => {
  const key = sizeKey(e);
  const own = liveSize?.key === key ? liveSize.px : deps?.railSize?.(key);
  if (Number.isFinite(own)) return fitSize(key, own);
  return barLayout() && !hostMode ? (across(e) ? TASKBAR_HEIGHT : BAR_SIDE) : (across(e) ? RAIL_ACROSS : RAIL_WIDTH);
};
// A rectangle less the taskbar's strip along its edge.
function besideEdge(r, e = railEdge(), t = railThickness(e)) {
  if (e === 'left') return { ...r, x: r.x + t, width: r.width - t };
  if (e === 'top') return { ...r, y: r.y + t, height: r.height - t };
  if (e === 'bottom') return { ...r, height: r.height - t };
  return { ...r, width: r.width - t };
}
// The room Scorpion's taskbar takes, on its edge ({ top, right, bottom, left }).
// The native shell host (Scorpion OS) draws the rail over Scorpion's window
// (XWayland windows aren't shrunk to leave it room). Hiding by itself, it
// keeps no room.
export const taskbarInsets = () => {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  if (deps?.autoHide?.() || (!hostMode && !mode && !railFloats)) return none;
  return { ...none, [railEdge()]: railThickness() };
};
const file = (name) => path.join(deps.dataDir, name);

// Crash-loop guard: true when the last three shell starts were within 3 minutes.
export function recordShellStart(now = Date.now()) {
  let starts = [];
  try { starts = JSON.parse(fs.readFileSync(file('shell-starts.json'), 'utf8')); } catch { /* first */ }
  starts = [...starts.filter((t) => now - t < 3 * 60_000), now];
  fs.writeFileSync(file('shell-starts.json'), JSON.stringify(starts));
  return starts.length >= 3;
}
export function clearShellStarts() { fs.rmSync(file('shell-starts.json'), { force: true }); }

// The bar only as Scorpion's desktop; floating, it's the rail.
const barLayout = () => Boolean(mode) && layout === 'bar';
// What the taskbar runs along: the whole screen as the desktop; floating, the
// area the Windows taskbar leaves (as it was before the rail took its own
// room from it).
function railBase() {
  const d = deps.screen.getPrimaryDisplay();
  if (mode || !WIN) return d.bounds;
  if (appBar) return appBar.base;
  const a = savedWorkArea;
  return a ? { x: a.left, y: a.top, width: a.right - a.left, height: a.bottom - a.top } : d.workArea;
}
// The taskbar's strip along its edge.
export function railRect(base, e = railEdge(), t = railThickness(e)) {
  if (e === 'left') return { x: base.x, y: base.y, width: t, height: base.height };
  if (e === 'top') return { x: base.x, y: base.y, width: base.width, height: t };
  if (e === 'bottom') return { x: base.x, y: base.y + base.height - t, width: base.width, height: t };
  return { x: base.x + base.width - t, y: base.y, width: t, height: base.height };
}
function placeTaskbar() {
  if (taskbar && !taskbar.isDestroyed()) taskbar.setBounds(railRect(railBase()));
  placeSummon();
}
// Where the wheel opens: the screen, less the rail's strip while it's up.
const wheelArea = (r) => (railUp() ? besideEdge(r) : r);
// The wheel's window: the whole screen beside the rail, while it's open.
function placeSummon() {
  if (!wheelOpen || !summon || summon.isDestroyed()) return;
  summon.setBounds(wheelArea(deps.screen.getPrimaryDisplay().bounds));
}
// Scorpion OS: the screen beside the rail (the host's panels sit over it all).
function hostArea() {
  const r = deps.screen.getPrimaryDisplay().bounds;
  const all = { x: 0, y: 0, width: r.width, height: r.height };
  return deps.autoHide?.() ? all : besideEdge(all);
}
// On Linux the window manager places a new window itself (labwc centres it);
// a move asked for once it's on screen is honoured, so the rail asks again.
function placeAgain() {
  if (WIN) return;
  for (const ms of [150, 600, 1500]) setTimeout(placeTaskbar, ms);
}

const windowOptions = (title) => ({
  frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
  // See-through, for the glass look (edge.css, summon.css, taskbar.css).
  skipTaskbar: true, alwaysOnTop: true, show: false, transparent: true, hasShadow: false, backgroundColor: '#00000000', title,
  webPreferences: { preload: deps.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
});
function createWindows() {
  layout = deps.getLayout?.() === 'bar' ? 'bar' : 'orbit';
  if (hostMode) return;
  taskbar?.destroy(); // a floating rail makes way for the desktop's own
  railFloats = false;
  makeTaskbar();
  if (!summon || summon.isDestroyed()) makeSummon(); // ready (hidden) for the wheel
}
function makeTaskbar() {
  railHidden = false;
  taskbar = new deps.BrowserWindow(windowOptions('Scorpion taskbar'));
  taskbar.setAlwaysOnTop(true, 'pop-up-menu');
  taskbar.loadURL(`scorpion://app/${barLayout() ? 'taskbar' : 'edge'}.html`);
  taskbar.once('ready-to-show', () => { placeTaskbar(); taskbar.showInactive(); placeAgain(); watchPointer(); });
  taskbar.on('closed', () => { taskbar = null; });
}
// The intent wheel's window: made when the wheel first opens, shown only while it's open.
function makeSummon() {
  summon = new deps.BrowserWindow(windowOptions('Scorpion summon'));
  summon.setAlwaysOnTop(true, 'pop-up-menu');
  summon.loadURL('scorpion://app/summon.html');
  summon.loaded = new Promise((resolve) => summon.webContents.once('did-finish-load', resolve));
  summon.on('blur', () => { if (wheelOpen && !held) summon.webContents.send('wheel:close'); });
  summon.on('closed', () => { summon = null; wheelOpen = false; });
}
// The rail is up (Scorpion as the desktop, orbit layout, or floating).
const railUp = () => (Boolean(mode) && layout === 'orbit') || railFloats;
function destroyWindows() {
  taskbar?.destroy();
  taskbar = null;
  railFloats = false;
  railHidden = false;
  summon?.destroy();
  summon = null;
  wheelOpen = false;
}

// The intent wheel: open (centred on a point of the screen, or its middle) or
// closed. Its window is made when first needed.
// Frosted glass: a small picture of the screen, taken before the wheel shows,
// which the page blurs behind it (not in Light, nor if it's slow).
async function snapBackdrop(r, wait) {
  if (!deps.snapScreen || deps.perf?.() === 'light' || deps.wheel?.().frosted === false) return null;
  const src = await Promise.race([deps.snapScreen().catch(() => null), new Promise((resolve) => setTimeout(() => resolve(null), wait))]);
  return src ? { src, w: r.width, h: r.height } : null;
}
export async function openWheel(at) {
  const r = deps.screen.getPrimaryDisplay().bounds;
  // Scorpion OS: the host's summon surface covers the whole screen (rail
  // included) once the page asks, so the page hears the centre beside the
  // rail, in screen terms.
  if (hostMode) {
    const backdrop = await snapBackdrop(r, 400);
    const area = hostArea();
    const centre = at ? { x: at.x - r.x, y: at.y - r.y } : { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    shellEvent('wheel:open', { ...centre, backdrop });
    return true;
  }
  if (!summon || summon.isDestroyed()) {
    if (!WIN && !mode) return false;
    makeSummon();
  }
  await summon.loaded;
  if (!summon || summon.isDestroyed()) return false;
  const shot = WIN ? await snapBackdrop(r, 250) : null;
  wheelOpen = true;
  summon.setAlwaysOnTop(true, 'screen-saver');
  placeSummon();
  // In the open window's terms (it starts beside a rail on the left or top);
  // the screen's picture is shifted to match.
  const w = wheelArea(r);
  const centre = at ? { x: at.x - w.x, y: at.y - w.y } : { x: w.width / 2, y: w.height / 2 };
  const backdrop = shot && { ...shot, x: r.x - w.x, y: r.y - w.y };
  summon.webContents.send('wheel:open', { ...centre, backdrop });
  summon.show();
  summon.focus();
  return true;
}
export function closeWheel() {
  if (hostMode) { shellEvent('wheel:close'); return true; }
  if (!summon || summon.isDestroyed() || !wheelOpen) return false;
  wheelOpen = false;
  summon.setAlwaysOnTop(true, 'pop-up-menu');
  summon.blur();
  summon.hide();
  return true;
}
// Scorpion's window went away (minimized, or to the tray) or came back: on
// the normal Windows desktop the rail (open windows, clock, notifications)
// floats down its edge while it's away.
export function setAway(on) {
  away = WIN && Boolean(on);
  if (hostMode || mode) return; // as the desktop, the taskbar is always there
  setFloatingRail(away && Boolean(deps.railAway?.()));
}
function setFloatingRail(on) {
  if (on === railFloats) return;
  railFloats = on;
  if (on) {
    makeTaskbar();
    if (!deps.autoHide?.()) keepFloatingRoom().catch(() => {}); // hiding, it keeps no room
  } else {
    const hwnd = hwndOf(taskbar);
    taskbar?.destroy();
    taskbar = null;
    giveBackFloatingRoom(hwnd).catch(() => {});
  }
  watchPointer();
}
// Floating (the Windows taskbar still there), the rail keeps its
// room as an app bar: Windows' own way (windows-control.js setAppBar), so apps
// maximize beside it, and if Scorpion ever stops Windows gives the room back by
// itself. Where that can't be done, the work area is set as before (and put
// back from shell-workarea.json after a crash).
let appBar = null; // { hwnd, base: the area the rail runs along, from before it took its room }
const hwndOf = (w) => {
  if (!w || w.isDestroyed() || !w.getNativeWindowHandle) return null;
  const b = w.getNativeWindowHandle();
  return String(b.length >= 8 ? b.readBigUInt64LE(0) : b.readUInt32LE(0));
};
async function keepFloatingRoom() {
  if (!WIN) return;
  const hwnd = hwndOf(taskbar);
  if (hwnd && win.setAppBar) {
    const base = appBar?.hwnd === hwnd ? appBar.base : deps.screen.getPrimaryDisplay().workArea;
    const r = railRect(base);
    const px = deps.screen.dipToScreenRect ? deps.screen.dipToScreenRect(null, r) : r;
    if (await win.setAppBar(hwnd, railEdge(), { left: px.x, top: px.y, right: px.x + px.width, bottom: px.y + px.height })) {
      appBar = { hwnd, base };
      placeTaskbar();
      return;
    }
  }
  await reserveWorkArea();
}
async function giveBackFloatingRoom(hwnd = hwndOf(taskbar)) {
  if (appBar) {
    const was = appBar;
    appBar = null;
    await win.removeAppBar?.(hwnd || was.hwnd);
    if (taskbar && !taskbar.isDestroyed()) placeTaskbar();
    return;
  }
  if (savedWorkArea) await restoreWorkArea();
}
// Settings changed (auto-hide, the floating rail, its edge): the rail and
// the room it keeps follow.
export function refreshRail() {
  if (away && !mode && !hostMode) setFloatingRail(Boolean(deps.railAway?.()));
  if (!hostMode) placeTaskbar();
  if (mode && !hostMode) win.setWorkArea(wantedArea()).catch(() => {});
  else if (railFloats && !hostMode) (deps.autoHide?.() ? giveBackFloatingRoom() : keepFloatingRoom()).catch(() => {});
  if (!deps.autoHide?.() && railHidden) showRail();
  watchPointer();
}

// ---------- the pointer: the taskbar's auto-hide ----------
const hidesNow = () => Boolean(deps.autoHide?.()) && taskbar && !taskbar.isDestroyed() && !hostMode;
function watchPointer() {
  const want = hidesNow();
  if (!want) { clearInterval(pointerWatch); pointerWatch = 0; return; }
  if (pointerWatch) return;
  pointerWatch = setInterval(lookAtPointer, deps.perf?.() === 'light' ? 250 : 120);
}
function lookAtPointer() {
  if (!hidesNow()) { watchPointer(); return; }
  if (wheelOpen) return;
  const p = deps.screen.getCursorScreenPoint();
  // How far in from the taskbar's outer edge the pointer is (beyond it,
  // over the Windows taskbar for one floating along the bottom: below 0).
  const e = railEdge();
  const s = railRect(railBase(), e);
  const depth = { left: p.x - s.x, right: s.x + s.width - 1 - p.x, top: p.y - s.y, bottom: s.y + s.height - 1 - p.y }[e];
  const atEdge = depth >= 0 && depth <= 2;
  const gone = depth > railThickness(e) + 30 || depth < -2;
  if (railHidden && atEdge) showRail();
  else if (!railHidden && gone && Date.now() > railHeld) hideRail();
}
// Hidden, the taskbar's page slides away and its window lets clicks through
// to the apps under it.
function hideRail() {
  if (!taskbar || taskbar.isDestroyed()) return;
  railHidden = true;
  taskbar.webContents.send('shell:rail', { hidden: true });
  setTimeout(() => { if (railHidden && taskbar && !taskbar.isDestroyed()) taskbar.setIgnoreMouseEvents(true); }, 200);
}
function showRail() {
  railHidden = false;
  if (!taskbar || taskbar.isDestroyed()) return;
  taskbar.setIgnoreMouseEvents(false);
  taskbar.webContents.send('shell:rail', { hidden: false });
}
// A menu from the taskbar is open: it stays while it is (at most a minute).
export function holdRail(on) { railHeld = on ? Date.now() + 60_000 : Date.now() + 800; }
// The taskbar resized by dragging its inner edge: as the pointer moves its
// window follows; let go, its size is given back to be kept (and the room it
// keeps for apps follows). Scorpion OS's page says the size itself (size).
export function resizeRail({ phase, x, y, size } = {}) {
  const e = railEdge();
  const key = sizeKey(e);
  let px = Number(size);
  if (!Number.isFinite(px) || px <= 0) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const s = railRect(railBase(), e, 0);
    px = { right: s.x - x, left: x - s.x, top: y - s.y, bottom: s.y - y }[e];
  }
  px = fitSize(key, px);
  railHeld = Date.now() + 1500; // a hiding taskbar stays while it's dragged
  if (phase === 'end') {
    liveSize = null;
    return { key, size: px };
  }
  liveSize = { key, px };
  if (!hostMode) placeTaskbar();
  return { key, size: px };
}
export function holdWheel(on) { held = Boolean(on); }
// The native shell host came up (or went away): its panels, or Scorpion's own windows.
export function useHost(on) {
  if (hostMode === Boolean(on)) return;
  hostMode = Boolean(on);
  if (hostMode) destroyWindows();
  else if (mode) createWindows();
}
export const hostActive = () => hostMode;
// A different layout: the windows are made again, and the reserved room follows.
export async function relayout() {
  if (!mode || (deps.getLayout?.() === 'bar' ? 'bar' : 'orbit') === layout) return false;
  destroyWindows();
  createWindows();
  await win.setWorkArea(wantedArea()).catch(() => {});
  return true;
}

// The screen area apps maximize into stops above Scorpion's taskbar. PowerShell
// sees the screen in the same scaled pixels as Electron (it isn't DPI-aware),
// so the numbers go across unconverted.
// The rail floating (the Windows taskbar still there) takes its
// room from the area as it was, not from the whole screen.
const wantedArea = () => {
  const inset = taskbarInsets();
  const b = deps.screen.getPrimaryDisplay().bounds;
  const from = !mode && savedWorkArea ? savedWorkArea : { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
  return { left: from.left + inset.left, top: from.top + inset.top, right: from.right - inset.right, bottom: from.bottom - inset.bottom };
};
// On Linux the session's window manager (labwc) keeps the room instead (its rc.xml margins).
async function reserveWorkArea() {
  if (!WIN) return;
  savedWorkArea ??= await win.getWorkArea().catch(() => null);
  if (savedWorkArea) fs.writeFileSync(file('shell-workarea.json'), JSON.stringify(savedWorkArea));
  await win.setWorkArea(wantedArea()).catch(() => {});
}
async function restoreWorkArea() {
  if (!WIN) return;
  let area = savedWorkArea;
  if (!area) { try { area = JSON.parse(fs.readFileSync(file('shell-workarea.json'), 'utf8')); } catch { /* none saved */ } }
  if (area) await win.setWorkArea(area).catch(() => {});
  savedWorkArea = null;
  fs.rmSync(file('shell-workarea.json'), { force: true });
}

export async function startShell(kind) {
  if (!WIN && process.platform !== 'linux') throw new Error('Scorpion as the desktop works on Windows and Linux.');
  if (!WIN && kind === 'bar') throw new Error("On Linux, Scorpion's taskbar comes with the Scorpion session.");
  if (mode) return mode;
  mode = kind;
  createWindows();
  deps.screen.on('display-metrics-changed', placeTaskbar);
  if (kind === 'bar') {
    // The Windows taskbar steps aside (a flag file brings it back after a crash).
    fs.writeFileSync(file('taskbar-hidden'), '1');
    await win.setWindowsTaskbar(false).catch(() => {});
    let beat = 0;
    keeper = setInterval(() => {
      if (mode !== 'bar' || (deps.perf?.() === 'light' && beat++ % 2)) return; // every 6 s in Light
      win.setWindowsTaskbar(false, wantedArea()).catch(() => {});
    }, 3000);
  }
  await reserveWorkArea();
  win.setShellActive(kind === 'shell');
  if (kind === 'shell') {
    // The desktop: Scorpion's home screen, filling the screen above the taskbar.
    const main = deps.getMainWindow();
    main?.maximize();
    // The desktop keeps listening for gestures and the wake word while apps
    // are in front of it.
    main?.webContents.setBackgroundThrottling(false);
    deps.showView('desktop', { signin: true });
    win.runStartupApps().catch(() => {});
    // Running steadily for two minutes: not a crash loop.
    setTimeout(clearShellStarts, 2 * 60_000);
  }
  return mode;
}

export async function stopShell() {
  if (!mode) return;
  const was = mode;
  mode = null;
  win.setShellActive(false);
  deps.screen.removeListener('display-metrics-changed', placeTaskbar);
  destroyWindows();
  clearInterval(keeper);
  keeper = 0;
  await restoreWorkArea();
  setAway(away); // the desktop's rail goes; a floating one stays
  // The Windows taskbar back in its place.
  if (was === 'bar') await showWindowsTaskbar();
  // Leaving the real shell: bring the Windows desktop back.
  if (WIN && was === 'shell' && !(await win.explorerRunning().catch(() => true))) await win.startExplorer();
}

async function showWindowsTaskbar() {
  await win.setWindowsTaskbar(true).catch(() => {});
  fs.rmSync(file('taskbar-hidden'), { force: true });
}

// Leftovers from a session that ended without stopShell (power loss, a crash):
// the work area and the Windows taskbar back.
export async function recoverWorkArea() {
  if (mode) return;
  if (fs.existsSync(file('shell-workarea.json'))) await restoreWorkArea();
  if (fs.existsSync(file('taskbar-hidden'))) await showWindowsTaskbar();
}

// What the taskbar shows besides the windows: battery and network.
export const trayStatus = () => win.trayStatus().catch(() => ({}));
