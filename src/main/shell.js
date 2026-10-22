// Scorpion as the Windows desktop ("shell"). When Windows starts Scorpion at
// sign-in (scorpion --shell), Scorpion shows its home screen as the desktop
// and its taskbar along the bottom. 'bar' (Settings: the holographic taskbar
// whenever Scorpion runs) takes over from the Windows taskbar on the normal
// Windows desktop: the Windows one is hidden while Scorpion's runs and comes
// back when it stops.
// Safety: starting it three times within three minutes (a crash loop) starts
// the Windows desktop instead; quitting Scorpion while it is the desktop starts
// the Windows desktop so the user is never left with an empty screen; and the
// switch itself (Winlogon Shell for this account) changes only from Settings.
import fs from 'node:fs';
import path from 'node:path';
import * as win from './windows-control.js';

const TASKBAR_HEIGHT = 48;
let deps = null; // { BrowserWindow, screen, preload, dataDir, getMainWindow, showView }
let taskbar = null;
let savedWorkArea = null;
let mode = null; // null | 'bar' | 'shell'
let keeper = 0; // 'bar': keeps the Windows taskbar hidden and the screen space reserved

export function initShell(d) { deps = d; }
export const shellMode = () => mode;
// Scorpion's taskbar back on top (Scorpion itself is on top in full mode).
export function raiseTaskbar() { if (taskbar && !taskbar.isDestroyed()) taskbar.moveTop(); }
export const TASKBAR_PX = 48;
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
  if (!taskbar || taskbar.isDestroyed()) return;
  const r = deps.screen.getPrimaryDisplay().bounds;
  taskbar.setBounds({ x: r.x, y: r.y + r.height - TASKBAR_HEIGHT, width: r.width, height: TASKBAR_HEIGHT });
}

// The screen area apps maximize into stops above Scorpion's taskbar. PowerShell
// sees the screen in the same scaled pixels as Electron (it isn't DPI-aware),
// so the numbers go across unconverted.
const wantedArea = () => {
  const b = deps.screen.getPrimaryDisplay().bounds;
  return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height - TASKBAR_HEIGHT };
};
async function reserveWorkArea() {
  savedWorkArea ??= await win.getWorkArea().catch(() => null);
  if (savedWorkArea) fs.writeFileSync(file('shell-workarea.json'), JSON.stringify(savedWorkArea));
  await win.setWorkArea(wantedArea()).catch(() => {});
}
async function restoreWorkArea() {
  let area = savedWorkArea;
  if (!area) { try { area = JSON.parse(fs.readFileSync(file('shell-workarea.json'), 'utf8')); } catch { /* none saved */ } }
  if (area) await win.setWorkArea(area).catch(() => {});
  savedWorkArea = null;
  fs.rmSync(file('shell-workarea.json'), { force: true });
}

export async function startShell(kind) {
  if (process.platform !== 'win32') throw new Error('Scorpion as the desktop works on Windows only.');
  if (mode) return mode;
  mode = kind;
  taskbar = new deps.BrowserWindow({
    frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    // See-through, for the holographic look (taskbar.css).
    skipTaskbar: true, alwaysOnTop: true, show: false, transparent: true, hasShadow: false, backgroundColor: '#00000000', title: 'Scorpion taskbar',
    webPreferences: { preload: deps.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  taskbar.setAlwaysOnTop(true, 'pop-up-menu');
  taskbar.loadURL('scorpion://app/taskbar.html');
  taskbar.once('ready-to-show', () => { placeTaskbar(); taskbar.showInactive(); });
  taskbar.on('closed', () => { taskbar = null; });
  deps.screen.on('display-metrics-changed', placeTaskbar);
  if (kind === 'bar') {
    // The Windows taskbar steps aside (a flag file brings it back after a crash).
    fs.writeFileSync(file('taskbar-hidden'), '1');
    await win.setWindowsTaskbar(false).catch(() => {});
    keeper = setInterval(() => { if (mode === 'bar') win.setWindowsTaskbar(false, wantedArea()).catch(() => {}); }, 3000);
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
  taskbar?.destroy();
  taskbar = null;
  clearInterval(keeper);
  keeper = 0;
  await restoreWorkArea();
  // The Windows taskbar back in its place.
  if (was === 'bar') await showWindowsTaskbar();
  // Leaving the real shell: bring the Windows desktop back.
  if (was === 'shell' && !(await win.explorerRunning().catch(() => true))) await win.startExplorer();
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
export async function trayStatus() {
  const out = await win.runPs(`$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1; $n = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Select-Object -First 1; [pscustomobject]@{ battery = if ($b) { [int]$b.EstimatedChargeRemaining } else { $null }; charging = if ($b) { $b.BatteryStatus -eq 2 } else { $false }; network = if ($n) { $n.Name } else { $null } } | ConvertTo-Json -Compress`).catch(() => '{}');
  try { return JSON.parse(out || '{}'); } catch { return {}; }
}
