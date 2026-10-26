// Scorpion as the Windows desktop ("shell"). When Windows starts Scorpion at
// sign-in (scorpion --shell), Scorpion shows its home screen as the desktop
// and its taskbar: by default a glance rail along the right edge (edge.html)
// with a summon dot that opens the intent wheel (summon.html), or the classic
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
const TASKBAR_HEIGHT = 48;
const RAIL_WIDTH = 76;
const DOT = 88; // the summon dot's window, bottom left
let deps = null; // { BrowserWindow, screen, preload, dataDir, getMainWindow, showView, getLayout, perf }
let taskbar = null;
let summon = null; // the summon dot, which opens into the intent wheel
let wheelOpen = false;
let held = false; // a menu or dialog from the wheel is up: it stays open
let layout = 'orbit'; // 'orbit' (edge rail + wheel) | 'bar'
// Scorpion OS's native shell host shows the rail, the dot and the wheel as
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
  if (summon && !summon.isDestroyed()) summon.moveTop();
}
// The room Scorpion's taskbar takes: along the bottom, or down the right edge.
// The native shell host (Scorpion OS) always draws the edge rail, over
// Scorpion's window (XWayland windows aren't shrunk to leave it room).
export const taskbarInsets = () => (hostMode ? { bottom: 0, right: RAIL_WIDTH } : !mode ? { bottom: 0, right: 0 } : layout === 'bar' ? { bottom: TASKBAR_HEIGHT, right: 0 } : { bottom: 0, right: RAIL_WIDTH });
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

function placeTaskbar() {
  const r = deps.screen.getPrimaryDisplay().bounds;
  if (taskbar && !taskbar.isDestroyed()) {
    taskbar.setBounds(layout === 'bar'
      ? { x: r.x, y: r.y + r.height - TASKBAR_HEIGHT, width: r.width, height: TASKBAR_HEIGHT }
      : { x: r.x + r.width - RAIL_WIDTH, y: r.y, width: RAIL_WIDTH, height: r.height });
  }
  placeSummon();
}
// The dot in the bottom-left corner, or (open) the whole screen left of the rail.
function placeSummon() {
  if (!summon || summon.isDestroyed()) return;
  const r = deps.screen.getPrimaryDisplay().bounds;
  summon.setBounds(wheelOpen
    ? { x: r.x, y: r.y, width: r.width - RAIL_WIDTH, height: r.height }
    : { x: r.x + 8, y: r.y + r.height - DOT - 8, width: DOT, height: DOT });
}

// On Linux the window manager places a new window itself (labwc centres it);
// a move asked for once it's on screen is honoured, so the rail and the dot
// ask again.
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
  taskbar = new deps.BrowserWindow(windowOptions('Scorpion taskbar'));
  taskbar.setAlwaysOnTop(true, 'pop-up-menu');
  taskbar.loadURL(`scorpion://app/${layout === 'bar' ? 'taskbar' : 'edge'}.html`);
  taskbar.once('ready-to-show', () => { placeTaskbar(); taskbar.showInactive(); placeAgain(); });
  taskbar.on('closed', () => { taskbar = null; });
  if (layout === 'orbit') {
    summon = new deps.BrowserWindow(windowOptions('Scorpion summon'));
    summon.setAlwaysOnTop(true, 'pop-up-menu');
    summon.loadURL('scorpion://app/summon.html');
    summon.once('ready-to-show', () => { placeSummon(); summon.showInactive(); placeAgain(); });
    summon.on('blur', () => { if (wheelOpen && !held) summon.webContents.send('wheel:close'); });
    summon.on('closed', () => { summon = null; wheelOpen = false; });
  }
}
function destroyWindows() {
  taskbar?.destroy();
  taskbar = null;
  summon?.destroy();
  summon = null;
  wheelOpen = false;
}

// The intent wheel: open (centred on a point of the screen, or its middle) or
// back to the dot.
export function openWheel(at) {
  const r = deps.screen.getPrimaryDisplay().bounds;
  if (hostMode) { shellEvent('wheel:open', at ? { x: at.x - r.x, y: at.y - r.y } : null); return true; }
  if (!summon || summon.isDestroyed()) return false;
  wheelOpen = true;
  summon.setAlwaysOnTop(true, 'screen-saver');
  placeSummon();
  const centre = at ? { x: at.x - r.x, y: at.y - r.y } : { x: (r.width - RAIL_WIDTH) / 2, y: r.height / 2 };
  summon.webContents.send('wheel:open', centre);
  summon.show();
  summon.focus();
  return true;
}
export function closeWheel() {
  if (hostMode) { shellEvent('wheel:close'); return true; }
  if (!summon || summon.isDestroyed() || !wheelOpen) return false;
  wheelOpen = false;
  summon.setAlwaysOnTop(true, 'pop-up-menu');
  placeSummon();
  summon.blur();
  return true;
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
const wantedArea = () => {
  const b = deps.screen.getPrimaryDisplay().bounds;
  const { bottom, right } = taskbarInsets();
  return { left: b.x, top: b.y, right: b.x + b.width - right, bottom: b.y + b.height - bottom };
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
