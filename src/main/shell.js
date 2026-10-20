// Scorpion as the Windows desktop ("shell"). When Windows starts Scorpion at
// sign-in (scorpion --shell), Scorpion shows its home screen as the desktop
// and a taskbar along the bottom; Preview shows the same over the normal
// Windows desktop without changing anything.
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
let mode = null; // null | 'preview' | 'shell'

export function initShell(d) { deps = d; }
export const shellMode = () => mode;
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
  const d = deps.screen.getPrimaryDisplay();
  taskbar.setBounds({ x: d.bounds.x, y: d.bounds.y + d.bounds.height - TASKBAR_HEIGHT, width: d.bounds.width, height: TASKBAR_HEIGHT });
}

// The screen area apps maximize into stops above the taskbar (physical pixels).
async function reserveWorkArea() {
  const d = deps.screen.getPrimaryDisplay();
  const s = d.scaleFactor;
  savedWorkArea ??= await win.getWorkArea().catch(() => null);
  if (savedWorkArea) fs.writeFileSync(file('shell-workarea.json'), JSON.stringify(savedWorkArea));
  await win.setWorkArea({ left: d.bounds.x * s, top: d.bounds.y * s, right: (d.bounds.x + d.bounds.width) * s, bottom: (d.bounds.y + d.bounds.height - TASKBAR_HEIGHT) * s }).catch(() => {});
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
    skipTaskbar: true, alwaysOnTop: true, show: false, backgroundColor: '#0c0c0e', title: 'Scorpion taskbar',
    webPreferences: { preload: deps.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  taskbar.setAlwaysOnTop(true, 'pop-up-menu');
  taskbar.loadURL('scorpion://app/taskbar.html');
  taskbar.once('ready-to-show', () => { placeTaskbar(); taskbar.showInactive(); });
  taskbar.on('closed', () => { taskbar = null; });
  deps.screen.on('display-metrics-changed', placeTaskbar);
  await reserveWorkArea();
  win.setShellActive(kind === 'shell');
  if (kind === 'shell') {
    // The desktop: Scorpion's home screen, filling the screen above the taskbar.
    const main = deps.getMainWindow();
    main?.maximize();
    deps.showView('home');
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
  taskbar?.destroy();
  taskbar = null;
  await restoreWorkArea();
  // Leaving the real shell: bring the Windows desktop back.
  if (was === 'shell' && !(await win.explorerRunning().catch(() => true))) await win.startExplorer();
}

// Leftovers from a session that ended without stopShell (power loss): put the
// work area back.
export async function recoverWorkArea() {
  if (fs.existsSync(file('shell-workarea.json')) && !mode) await restoreWorkArea();
}

// What the taskbar shows besides the windows: battery and network.
export async function trayStatus() {
  const out = await win.runPs(`$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1; $n = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Select-Object -First 1; [pscustomobject]@{ battery = if ($b) { [int]$b.EstimatedChargeRemaining } else { $null }; charging = if ($b) { $b.BatteryStatus -eq 2 } else { $false }; network = if ($n) { $n.Name } else { $null } } | ConvertTo-Json -Compress`).catch(() => '{}');
  try { return JSON.parse(out || '{}'); } catch { return {}; }
}
