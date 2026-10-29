import { app, BrowserWindow, screen, ipcMain, dialog, protocol, net, shell, Notification, Tray, Menu, nativeImage, session, systemPreferences, powerMonitor, safeStorage, desktopCapturer, globalShortcut } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as store from './store.js';
import * as models from './models.js';
import * as engine from './engine-client.js';
import * as rag from './rag.js';
import * as memory from './memory.js';
import * as agents from './agents.js';
import * as scheduler from './scheduler.js';
import * as voice from './voice.js';
import * as faces from './faces.js';
import * as insights from './face-insights.js';
import * as lock from './lock.js';
import * as library from './library.js';
import { initMediaModels, installMediaModels, uninstallMediaModels, mediaModelStatus, setLowCpu } from './media-models.js';
import { Readable } from 'node:stream';
import * as gestures from './gestures.js';
import * as skills from './skills.js';
import * as persona from './persona.js';
import { summarizeIfLong, dream, dreamDue, dreamState } from './consolidate.js';
import * as remote from './remote.js';
import * as secrets from './secrets.js';
import * as mcp from './mcp.js';
import * as workspaces from './workspaces.js';
import { recentActivity } from './activity.js';
import * as desktop from './shell.js';
import { windowChanges, shouldFill } from './window-watch.js';
import { startShellApi, shellEvent } from './shell-api.js';
import winctl from './system.js';
import { createUpdates } from './updates.js';
import * as appFrame from './orb-frame.js';
import * as appIcons from './app-icons.js';
import * as constellations from './constellations.js';
import { startKeyWatch, stopKeyWatch } from './key-watch.js';
import { createAgentBrowser, browserTools } from './agent-browser.js';
import { TelegramBot, pairingCode } from './telegram.js';
import { TOOLS, fileSystemRoots } from './tools.js';
import { applyEvent } from '../shared/events.js';
import { findIntent, MAIN_CONTROLS } from '../shared/intents.js';
import { buildFunctions, buildSystemPrompt, withDocumentContext, withConversationRecall, isFactualQuestion, thinkingFor } from './agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..');
const RENDERER_DIR = path.join(APP_ROOT, 'src', 'renderer');
const SHARED_DIR = path.join(APP_ROOT, 'src', 'shared');
const THREE_BUILD = path.join(APP_ROOT, 'node_modules', 'three', 'build');
// The orb's few Three.js add-ons are vendored (installers drop node_modules
// "examples" folders); test/orb.test.js keeps them in step with three.
const THREE_ADDONS = path.join(APP_ROOT, 'src', 'vendor', 'three-addons');
// Hand tracking for Interact's gestures: MediaPipe's vision bundle and the one
// WebAssembly build Chromium needs (with SIMD; the others aren't packaged).
const MEDIAPIPE = path.join(APP_ROOT, 'node_modules', '@mediapipe', 'tasks-vision');
const MEDIAPIPE_FILES = new Set(['vision_bundle.mjs', 'wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.wasm']);
const VENDOR = {
  'marked.js': path.join(APP_ROOT, 'node_modules', 'marked', 'lib', 'marked.esm.js'),
  'purify.js': path.join(APP_ROOT, 'node_modules', 'dompurify', 'dist', 'purify.es.mjs'),
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'scorpion', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Portable mode: a "scorpion-data" folder holds everything (models, chats,
// memory), so Scorpion can run from a USB stick and leave nothing on the
// computer. SCORPION_DATA_DIR overrides it (used for testing).
// The app used to be called Kenzo; its data folders are picked up and moved
// over once, so chats, memory, settings and models survive the rename.
const exeDir = path.dirname(process.execPath);
const portableDir = portableCandidates().find((d) => fs.existsSync(d));

// Where a portable data folder can be: next to Scorpion.exe or one folder up
// (the USB layout keeps the Windows app in its own folder beside the shared
// data). On a Mac, next to Scorpion.app or one folder up; and when Scorpion
// runs from a disk image opened from a USB stick, at the root of the stick.
function portableCandidates() {
  const dirs = [path.join(exeDir, 'scorpion-data'), path.join(exeDir, 'kenzo-data'), path.join(exeDir, '..', 'scorpion-data')];
  if (process.platform === 'darwin') {
    const bundleParent = path.resolve(exeDir, '../../..');
    dirs.push(path.join(bundleParent, 'scorpion-data'), path.join(bundleParent, '..', 'scorpion-data'));
    // Only when running from a disk image, never from Applications.
    if (exeDir.startsWith('/Volumes/')) {
      let volumes = [];
      try { volumes = fs.readdirSync('/Volumes'); } catch { /* no volumes */ }
      for (const v of volumes) dirs.push(path.join('/Volumes', v, 'scorpion-data'));
    }
  }
  return dirs;
}
if (process.env.SCORPION_DATA_DIR) app.setPath('userData', path.resolve(process.env.SCORPION_DATA_DIR));
else if (app.isPackaged && portableDir) {
  app.setPath('userData', portableDir);
  // Chromium caches also go in the portable folder instead of AppData.
  app.setPath('sessionData', path.join(portableDir, 'session'));
} else {
  store.migrateFromKenzo(app.getPath('userData'), path.join(app.getPath('appData'), 'Kenzo'));
}

// Scorpion OS's session: Scorpion's windows go through XWayland (X11), where
// they can be placed and kept on top (the rail, the dot, the wheel).
if (process.platform === 'linux' && process.env.XDG_SESSION_DESKTOP === 'scorpion') app.commandLine.appendSwitch('ozone-platform', 'x11');
// Without a graphics card (a virtual machine), WebGL falls back to Chromium's
// software renderer, so the orb still draws (slower).
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-unsafe-swiftshader');

// A second start (a shortcut like scorpion --wheel or --osd) only hands its
// arguments to the running Scorpion and quits: it must not start anything
// (on Scorpion OS its shell API would take over the host's connection file).
// The hand-over is done when the lock call returns; on Linux app.quit() at
// this point leaves the process waiting forever, so it simply exits.
const primary = app.requestSingleInstanceLock();
if (!primary) process.exit(0);
// Covered by other windows, Scorpion still counts as on screen, so hand
// tracking (which replaces the mouse) keeps running; only minimized pauses it.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

let win = null;
let tray = null;
let quitting = false;
let leaving = false; // before-quit has begun (the windows hiding then isn't "away")
const startHidden = process.argv.includes('--hidden');
// Started at sign-in to open the orb (Settings → General → When I sign in).
const startOrb = process.argv.includes('--orb');

// What Scorpion does when you sign in: nothing, start in the tray, or open the orb.
const LOGIN_ARGS = { tray: ['--hidden'], orb: ['--orb'] };
function loginStart() {
  for (const [mode, args] of Object.entries(LOGIN_ARGS)) if (app.getLoginItemSettings({ args }).openAtLogin) return mode;
  return 'off';
}
function setLoginStart(mode) {
  const current = loginStart();
  if (current !== 'off' && current !== mode) app.setLoginItemSettings({ openAtLogin: false, args: LOGIN_ARGS[current] });
  if (LOGIN_ARGS[mode]) app.setLoginItemSettings({ openAtLogin: true, args: LOGIN_ARGS[mode] });
  return loginStart();
}
// Started by Windows at sign-in as this account's desktop (Settings → Desktop).
// --shell: Scorpion is the desktop (Windows' Winlogon shell, or Scorpion OS's session).
const shellLaunch = process.argv.includes('--shell') && (process.platform === 'win32' || process.platform === 'linux');
const running = new Map(); // threadId -> AbortController
const approvals = new Map(); // approval id -> resolve(boolean)

// The on-screen display (Scorpion OS's shell host shows it): a level just changed.
async function showOsd(kind = 'volume') {
  if (process.platform !== 'linux' || !winctl.levelOf) return;
  const level = await winctl.levelOf(kind === 'brightness' ? 'brightness' : 'volume').catch(() => null);
  if (level) send('shell:osd', { kind: kind === 'brightness' ? 'brightness' : 'volume', ...level });
}

// Every IPC handler by channel (registered with h): the native shell host
// calls the shell's own ones over shell-api.js.
const handlers = {};

function send(channel, payload) {
  shellEvent(channel, payload); // the native shell host's pages (only the shell's own events)
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  // The taskbar follows the theme too.
  if (channel === 'settings:changed') for (const w of BrowserWindow.getAllWindows()) if (w !== win && !w.isDestroyed()) w.webContents.send(channel, payload);
}

function serveApp() {
  protocol.handle('scorpion', (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    let file;
    if (rel.startsWith('library/thumb/')) {
      const thumb = library.thumbPath(rel.slice('library/thumb/'.length));
      return thumb && fs.existsSync(thumb) ? net.fetch(pathToFileURL(thumb).toString()) : new Response('Not found', { status: 404 });
    }
    if (rel.startsWith('media/')) return serveMedia(request, rel.split('/')[1]);
    if (rel.startsWith('vendor/three/')) {
      // Three.js is a set of ES modules: its build, plus the add-ons the orb uses.
      const sub = rel.slice('vendor/three/'.length);
      const build = /^build\/(three\.(module|core)\.js)$/.exec(sub);
      const addon = /^examples\/jsm\/((controls|postprocessing|shaders)\/\w+\.js)$/.exec(sub);
      file = build ? path.join(THREE_BUILD, build[1]) : addon ? path.join(THREE_ADDONS, addon[1]) : null;
    } else if (rel.startsWith('vendor/mediapipe/')) {
      const sub = rel.slice('vendor/mediapipe/'.length);
      file = MEDIAPIPE_FILES.has(sub) ? path.join(MEDIAPIPE, sub) : null;
    } else if (rel.startsWith('vendor/')) file = VENDOR[rel.slice('vendor/'.length)];
    else if (rel === `gestures/${gestures.MODEL_FILE}`) {
      file = gestures.modelPath();
      if (file && !fs.existsSync(file)) file = null;
    }
    else if (rel.startsWith('shared/')) {
      file = path.join(SHARED_DIR, rel.slice('shared/'.length));
      if (path.relative(SHARED_DIR, file).startsWith('..')) file = null;
    } else {
      file = path.join(RENDERER_DIR, rel);
      if (path.relative(RENDERER_DIR, file).startsWith('..')) file = null;
    }
    if (!file) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

// Glass sidebar: Windows 11 acrylic or macOS vibrancy shows the desktop through
// the window, blurred. Other systems (and "off") get an in-app frosted look.
function nativeGlassSupported() {
  if (process.platform === 'darwin') return true;
  if (process.platform !== 'win32') return false;
  return Number(os.release().split('.')[2] || 0) >= 22000; // Windows 11
}

function glassMode() {
  if (['native', 'css', 'off'].includes(process.env.SCORPION_GLASS)) return process.env.SCORPION_GLASS; // testing
  const pref = store.getSettings().glass;
  if (pref === 'off') return 'off';
  return nativeGlassSupported() ? 'native' : 'css';
}

function applyGlass() {
  if (!win || win.isDestroyed()) return;
  const native = glassMode() === 'native';
  if (process.platform === 'win32') {
    win.setBackgroundMaterial?.(native ? 'acrylic' : 'none');
    win.setBackgroundColor(native ? '#00000000' : themeBg());
  } else if (process.platform === 'darwin') {
    win.setVibrancy(native ? 'sidebar' : null);
    win.setBackgroundColor(native ? '#00000000' : themeBg());
  }
}

// Window background per theme, so nothing flashes before the page paints.
const THEME_BG = { classic: '#0e0d0b', hellfire: '#0f0807', bloodmoon: '#0d0709', smoke: '#101214', molten: '#100c08', bone: '#f3eee3' };
const themeBg = () => THEME_BG[store.getSettings().theme] || THEME_BG.classic;

function createWindow() {
  const native = glassMode() === 'native';
  navReady = false;
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 820,
    minHeight: 560,
    title: 'Scorpion',
    show: false,
    backgroundColor: native ? '#00000000' : themeBg(),
    ...(native && process.platform === 'win32' ? { backgroundMaterial: 'acrylic' } : {}),
    ...(native && process.platform === 'darwin' ? { vibrancy: 'sidebar', visualEffectState: 'active' } : {}),
    autoHideMenuBar: true,
    icon: path.join(APP_ROOT, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Scorpion is offline: never navigate the app window anywhere else; open
  // external links (e.g. in rendered Markdown) in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('scorpion://')) e.preventDefault();
  });
  win.webContents.on('did-start-loading', () => { navReady = false; appFrame.setPanel(null).catch(() => {}); });
  let lastEsc = 0;
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { e.preventDefault(); setFullMode(!fullMode); return; }
    if (input.key !== 'Escape' || !fullMode) return;
    if (input.control) { e.preventDefault(); setFullMode(false); return; }
    const now = Date.now();
    if (now - lastEsc < 450) { lastEsc = 0; setFullMode(false); } else lastEsc = now;
  });
  // The window manager can end full screen itself (Scorpion OS, when another
  // window takes focus): then full mode is over too.
  win.on('leave-full-screen', () => { if (fullMode) setFullMode(false); });
  win.on('focus', () => {
    if (!fullMode) return;
    win.setAlwaysOnTop(true, 'screen-saver');
    if (appFrame.framed()) appFrame.raise().catch(() => {});
    desktop.raiseTaskbar();
  });
  // Another app in use: Scorpion stops pinning itself on top, so that app can
  // come in front (keeping it on top regardless made the two fight: flicker).
  win.on('blur', () => { if (fullMode) win.setAlwaysOnTop(false); });
  // Minimized or in the tray: the summon dot floats on the Windows desktop.
  const away = (on) => desktop.setFloatingDot(on && !leaving && store.getSettings().summonDot !== false);
  win.on('minimize', () => away(true));
  win.on('hide', () => away(true));
  win.on('restore', () => away(false));
  win.on('show', () => away(false));
  win.loadURL('scorpion://app/index.html');
  if (!startHidden || process.env.SCORPION_SCREENSHOT) win.once('ready-to-show', () => win.show());
  else away(true);

  // With scheduled agents on, closing the window keeps Scorpion running in the tray.
  win.on('close', (e) => {
    // As the Windows desktop, closing Scorpion's window only hides it (the
    // taskbar's Scorpion button brings it back).
    if (!quitting && desktop.shellMode() === 'shell') { e.preventDefault(); win.hide(); return; }
    if (quitting || !keepsRunning()) return;
    e.preventDefault();
    win.hide();
    ensureTray();
  });

  // Smoke test: SCORPION_SCREENSHOT=out.png [SCORPION_VIEW=models] npm start
  if (process.env.SCORPION_SCREENSHOT) {
    win.webContents.on('console-message', (e) => console.log(`[renderer] ${e.message}`));
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1500)); // let the app finish opening its first chat
      if (process.env.SCORPION_VIEW) await win.webContents.executeJavaScript(`document.querySelector('[data-view="${process.env.SCORPION_VIEW}"]')?.click()`);
      await new Promise((r) => setTimeout(r, Number(process.env.SCORPION_SCREENSHOT_DELAY) || 2500));
      fs.writeFileSync(process.env.SCORPION_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
      app.quit();
    });
  }
}

// Full mode: Scorpion fills the screen over every other window, with no title
// bar or window buttons. Ctrl+Esc, or Esc twice, leaves it; F11 comes back.
// Apps opened inside the orb stay above it (orb-frame.js); an app brought to
// the front opens the orb so it lands inside it.
let fullMode = false;
let fullWatch = 0;
function setFullMode(on) {
  if (!win || win.isDestroyed()) return false;
  fullMode = Boolean(on);
  if (fullMode) { if (!win.isVisible()) win.show(); if (win.isMinimized()) win.restore(); }
  win.setFullScreen(fullMode);
  win.setAlwaysOnTop(fullMode && win.isFocused(), 'screen-saver');
  if (fullMode) win.focus();
  desktop.raiseTaskbar();
  sendTaskbarInset();
  // The exit keys, wherever the keyboard is (key-watch.js); Ctrl+Esc then
  // doesn't open the Start menu.
  // Windows' keyboard hook; on Scorpion OS the session's own keys do this (labwc rc.xml).
  if (fullMode && process.platform === 'win32') startKeyWatch(() => setFullMode(false)); else stopKeyWatch();
  clearInterval(fullWatch);
  let beat = 0;
  fullWatch = fullMode && process.platform === 'win32' ? setInterval(() => { if (currentPerf() !== 'light' || beat++ % 2) pullAppsIntoOrb(); }, 1000) : 0;
  send('fullmode:changed', fullMode);
  return fullMode;
}
// In full mode Scorpion's screens stop short of its taskbar (which stays on
// top): above the bar, or left of the edge rail.
// On Scorpion OS Scorpion's window always stops at the rail (labwc doesn't shrink it).
const taskbarInset = () => ((fullMode || process.platform === 'linux') && desktop.shellMode() ? desktop.taskbarInsets() : { bottom: 0, right: 0 });
function sendTaskbarInset() { send('layout:taskbar', taskbarInset()); }

// Full mode covers everything, so an app the user brings to the front (from
// Apps, Files, a voice request…) opens the orb and is framed inside it.
let pulling = false;
let pendingFrame = null; // the app to put inside the orb once its panel exists
async function pullAppsIntoOrb() {
  if (pulling || !fullMode || appFrame.hasPanel()) return;
  pulling = true;
  try {
    const fg = await appFrame.foregroundApp();
    // Open the orb behind the app (no focus taken), then frame that app
    // as soon as the orb's panel is there.
    if (fg && navReady) { pendingFrame = fg.hwnd; send('nav:view', { view: 'orb' }); }
  } catch { /* next time */ } finally { pulling = false; }
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Brings Scorpion forward on one of its screens (the taskbar's buttons, folders
// opened while Scorpion is the desktop).
// Until the page says it is ready (after the lock screen), the request waits.
let navReady = false;
let pendingNav = null;
function showView(view, detail) {
  showWindow();
  const msg = { view, ...detail };
  if (navReady) send('nav:view', msg); else pendingNav = msg;
}

// ---- PC events for the orb: battery, downloads, schedules, check-ins ----
// Only while the orb is open (it asks with pc:events).
let pcWatch = null;
function pcEvent(kind, text, level = 'info') {
  if (pcWatch) send('pc:event', { kind, text, level, at: Date.now() });
}
function startPcEvents() {
  if (pcWatch) return;
  pcWatch = { seen: new Map(), lastBattery: null };
  const onAc = () => pcEvent('power', 'Plugged in: charging.', 'ok');
  const onBattery = () => { pcEvent('power', 'Running on battery.'); checkBattery(); };
  powerMonitor.on('on-ac', onAc);
  powerMonitor.on('on-battery', onBattery);
  pcWatch.off = () => { powerMonitor.off('on-ac', onAc); powerMonitor.off('on-battery', onBattery); };
  // On battery: say so when it runs low (20% and 10%).
  const checkBattery = async () => {
    if (!pcWatch || !powerMonitor.isOnBatteryPower()) return;
    const t = await desktop.trayStatus().catch(() => ({}));
    if (!pcWatch || typeof t.battery !== 'number') return;
    const before = pcWatch.lastBattery;
    pcWatch.lastBattery = t.battery;
    for (const mark of [20, 10]) if (before != null && before > mark && t.battery <= mark && !t.charging) pcEvent('battery', `Battery at ${t.battery}%. Plug in soon.`, 'alert');
  };
  pcWatch.timer = setInterval(checkBattery, 120_000);
  checkBattery();
  // Downloads: a new finished file in the Downloads folder (browsers rename
  // their partial file to the real name when the download completes).
  try {
    const dir = app.getPath('downloads');
    pcWatch.dl = fs.watch(dir, (type, name) => {
      if (!name || /\.(crdownload|part|partial|tmp|download|opdownload)$/i.test(name) || /^(~\$|\.)/.test(name)) return;
      const last = pcWatch?.seen.get(name) || 0;
      if (Date.now() - last < 60_000) return;
      setTimeout(() => {
        try {
          const st = fs.statSync(path.join(dir, name));
          if (!st.isFile() || !st.size || Date.now() - st.mtimeMs > 120_000 || !pcWatch) return;
          pcWatch.seen.set(name, Date.now());
          pcEvent('download', `Download finished: ${name}`, 'ok');
        } catch { /* gone again (a temporary file) */ }
      }, 1500);
    });
  } catch { /* no Downloads folder */ }
}
function stopPcEvents() {
  if (!pcWatch) return;
  pcWatch.off?.();
  clearInterval(pcWatch.timer);
  pcWatch.dl?.close();
  pcWatch = null;
}

function ensureTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(APP_ROOT, 'resources', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Scorpion — scheduled agents are running');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Scorpion', click: showWindow },
    { type: 'separator' },
    { label: 'Quit Scorpion', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

function modelEnv() {
  return { resourcesPath: process.resourcesPath, appRoot: APP_ROOT };
}

function scheduleView() {
  return scheduler.listSchedules().map((s) => ({ ...s, nextRunAt: scheduler.nextRunAt(s) }));
}

const parseSize = (s) => {
  const m = /([\d.]+)\s*(GB|MB)/i.exec(s || '');
  return m ? Number(m[1]) * 1024 ** (m[2].toUpperCase() === 'GB' ? 3 : 2) : 0;
};

async function state() {
  const hw = await engine.hardwareInfo().catch(() => null);
  const fit = (kind, bytes) => (kind === 'chat' ? engine.modelFit(bytes, hw) : null);
  return {
    settings: store.getSettings(),
    hardware: hw,
    models: models.listLocalModels(modelEnv()).map((m) => ({ ...m, fit: fit(m.kind, m.bytes), skill: models.CATALOG.find((c) => models.findInstalled(c, [m]))?.skill })),
    catalog: models.CATALOG.map((c) => ({ ...c, fit: fit(c.kind, parseSize(c.size)) })),
    threads: store.listThreads(),
    documents: rag.listDocuments(),
    memories: memory.listMemories(),
    agents: agents.listAgents(),
    tools: Object.entries(TOOLS).map(([name, t]) => ({ name, access: t.access, description: t.description.split('. ')[0] })).concat([{ name: 'ask_agent', access: 'agent', description: 'Hand subtasks to other agents' }]),
    schedules: scheduleView(),
    loginStart: loginStart(),
    fullMode,
    live: process.platform === 'linux' && winctl.isLiveSession(), // Scorpion OS from the ISO or a USB stick
    taskbarInset: taskbarInset(),
    perf: currentPerf(),
    supportedDocs: rag.SUPPORTED_EXTENSIONS,
    voice: voice.voiceStatus(),
    faces: faces.faceStatus(),
    insights: insights.insightsStatus(),
    library: library.libraryStatus(),
    lock: lock.lockStatus(),
    gestures: gestures.gesturesStatus(),
    skills: skills.listSkills(),
    sources: sourcesView(),
    engine: await engine.engineInfo().catch((e) => ({ error: e.message })),
    platform: process.platform,
    glass: glassMode(),
    nativeGlass: nativeGlassSupported(),
  };
}

// Pick sensible defaults the first time: a bundled/downloaded model is used
// automatically so a preloaded offline install works with zero clicks.
async function autoSelectModels() {
  const s = store.getSettings();
  const local = models.listLocalModels(modelEnv());
  // A model only counts if it's in Scorpion's own library (or bundled). That
  // also drops paths that pointed into other apps' folders in older versions.
  const known = (p) => p && fs.existsSync(p) && local.some((m) => m.path === p);
  // On a USB stick the saved path goes stale when the drive letter changes or
  // the stick moves between Windows and a Mac; the same file is still there.
  const sameFile = (p) => p && local.find((m) => path.basename(m.path) === p.split(/[\\/]/).pop())?.path;
  const patch = {};
  if (!known(s.chatModel) && sameFile(s.chatModel)) patch.chatModel = sameFile(s.chatModel);
  else if (!known(s.chatModel)) {
    // Pick what runs well on this machine, not just the first file found.
    const hw = await engine.hardwareInfo().catch(() => null);
    patch.chatModel = models.pickDefaultChatModel(local, (bytes) => engine.modelFit(bytes, hw))?.path ?? null;
  }
  if (!known(s.embedModel)) patch.embedModel = sameFile(s.embedModel) ?? local.find((m) => m.kind === 'embedding')?.path ?? null;
  // A workspace folder from another computer doesn't exist here.
  if (s.workspace && !fs.existsSync(s.workspace)) patch.workspace = null;
  if (Object.keys(patch).length) store.updateSettings(patch);
}

// Uninstall a library model. If it was in use, switch to the next best model
// that's installed (or none) so the app never points at a missing file.
async function uninstall(file, { pickNext = true } = {}) {
  const s = store.getSettings();
  if (s.chatModel === file) { await engine.unloadChatModel(); store.updateSettings({ chatModel: null }); }
  if (s.embedModel === file) store.updateSettings({ embedModel: null });
  models.uninstallModel(file);
  if (pickNext) {
    models.cleanPartialDownloads();
  await autoSelectModels();
    if (store.getSettings().chatModel && !engine.isChatReady()) loadChat().catch(() => {});
  }
  send('model:status', { loading: false, info: await engine.engineInfo() });
  return true;
}

// ---- Performance (Settings → General → Performance) ----
// 'full' is everything as designed; 'balanced' calms the orb and the checks
// that run in the background; 'light' goes further and chats with a smaller
// model that runs fast here (no model is removed). "Light on battery" makes
// it light while unplugged.
const PERF_LEVELS = ['full', 'balanced', 'light'];
function perfLevel() {
  const s = store.getSettings();
  const chosen = PERF_LEVELS.includes(s.performance) ? s.performance : 'full';
  return chosen !== 'light' && s.performanceOnBattery && powerMonitor.isOnBatteryPower() ? 'light' : chosen;
}
let perfNow = null;
const currentPerf = () => perfNow || perfLevel();
function applyPerf() {
  const level = perfLevel();
  if (level === perfNow) return level;
  perfNow = level;
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('perf:changed', level);
  applyLowCpu();
  switchModelForPerf().catch((err) => console.error(err));
  watchWindows(); // looks at the windows less often in Light
  return level;
}
// Background media work (the Library, faces) on fewer cores: the Library's
// own Low CPU switch, or Light.
let libraryLowCpu = false;
function applyLowCpu() {
  const on = libraryLowCpu || currentPerf() === 'light';
  setLowCpu(on);
  faces.setFaceThreads(on ? 1 : 0);
}

// The best installed model that runs fast on this computer, when the given
// one doesn't (null: it is fast already, or nothing faster is installed).
async function fastModelFor(file) {
  const local = models.listLocalModels(modelEnv()).filter((m) => m.kind === 'chat');
  const hw = await engine.hardwareInfo().catch(() => null);
  const main = local.find((m) => m.path === file);
  if (!main || engine.modelFit(main.bytes, hw) === 'fast') return null;
  const fast = local.filter((m) => m.path !== file && engine.modelFit(m.bytes, hw) === 'fast')
    .sort((a, b) => models.catalogRank(a) - models.catalogRank(b));
  return fast[0]?.path ?? null;
}
// The model chats use: the chosen one, or in Light the fast one.
async function effectiveChatModel() {
  const s = store.getSettings();
  if (!s.chatModel || currentPerf() !== 'light') return s.chatModel;
  return (await fastModelFor(s.chatModel)) || s.chatModel;
}
// A new level: the loaded model follows (not while Scorpion is answering;
// the next message switches it then).
async function switchModelForPerf() {
  if (activeSource().remote || running.size || !engine.isChatReady()) return;
  if ((await engine.engineInfo()).chatModel !== (await effectiveChatModel())) await loadChat();
}

async function loadChat() {
  const s = store.getSettings();
  if (!s.chatModel) return engine.engineInfo();
  const file = await effectiveChatModel();
  const entry = models.listLocalModels(modelEnv()).find((m) => m.path === file);
  const display = entry?.name || path.basename(file);
  const bytes = entry?.bytes ?? 0;
  // The UI shows a "Please wait" window from these events until loading ends.
  send('model:status', { loading: true, name: display, bytes });
  try {
    const info = await engine.loadChatModel(file, {
      contextSize: s.contextSize,
      gpuLayers: s.gpuLayers,
      name: entry?.name,
      onProgress: (p) => send('model:status', { loading: true, progress: p, name: display, bytes }),
    });
    send('model:status', { loading: false, info });
    // Performance changed while it loaded: the right model next.
    if (file !== (await effectiveChatModel())) { setTimeout(() => switchModelForPerf().catch(() => {}), 0); return info; }
    setTimeout(() => warmUp().catch(() => {}), 300); // read a new chat's prompt ahead of time
    return info;
  } catch (err) {
    send('model:status', { loading: false, error: err.message });
    throw err;
  }
}

// ---- phone (Telegram) ----
let tg = null;
let tgStatus = { state: 'off' };
const tgSettings = () => ({ enabled: false, allowed: [], pending: [], ...(store.getSettings().telegram || {}) });
function updateTelegram(patch) {
  const next = store.updateSettings({ telegram: { ...tgSettings(), ...patch } });
  send('settings:changed', next);
  return next.telegram;
}
const telegramView = () => ({ ...tgStatus, ...tgSettings(), hasToken: secrets.hasSecret('telegram:token') });
function setTgStatus(st) {
  tgStatus = st;
  send('telegram:status', telegramView());
}

function approvalQuestion(info) {
  if (info.name === 'run_command') return ['Run this command on your computer?', info.args.command];
  if (info.name === 'write_file') return [`Save ${info.args.path}?`, String(info.args.content || '').slice(0, 1500)];
  if (info.name === 'run_code') return ['Run this program on your computer?', String(info.args.code || '').slice(0, 1500)];
  return [`Allow ${info.name.replace(/_/g, ' ')}?`, info.summary];
}

// One message from the phone: answered in that person's own Scorpion chat,
// which also shows on the computer.
async function phoneTurn(chatId, text, { heard = null } = {}) {
  const t = tgSettings();
  const who = t.allowed.find((a) => a.chatId === chatId);
  if (!who) return 'You are not approved yet.';
  let thread = who.threadId && store.getThread(who.threadId);
  if (!thread) {
    thread = store.createThread();
    thread.title = `Phone: ${who.name}`;
    store.saveThread(thread);
    updateTelegram({ allowed: t.allowed.map((a) => (a.chatId === chatId ? { ...a, threadId: thread.id } : a)) });
    send('threads:changed');
  }
  if (running.has(thread.id)) return 'I am still working on your last message. Send /stop to cancel it.';
  const result = await runAgentTurn({
    thread,
    text,
    displayText: heard ? `(voice) ${heard}` : text,
    approve: (info, signal) => { const [q, d] = approvalQuestion(info); return tg ? tg.askApproval(chatId, q, d, signal) : Promise.resolve(false); },
    intents: true,
  });
  send('threads:changed');
  const prefix = heard ? `You said: "${heard}"\n\n` : '';
  return result.error ? `${prefix}Something went wrong: ${result.error}` : `${prefix}${result.text || '(done)'}`;
}

async function phoneVoice(chatId, file) {
  if (!voice.voiceStatus().installed) return 'Voice messages need Scorpion\'s voice feature: on the computer, open Settings → General → Voice and install it.';
  const dir = path.join(app.getPath('userData'), 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `voice-${Date.now()}${path.extname(file.name) || '.oga'}`);
  fs.writeFileSync(tmp, file.bytes);
  try {
    const { pcm } = await decodeInWindow('speech', tmp);
    const heard = (await voice.transcribe(pcm, store.getSettings().voiceLanguage)).trim();
    if (!heard) return 'I could not hear any words in that voice message.';
    return phoneTurn(chatId, heard, { heard });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function startTelegram() {
  tg?.stop();
  tg = null;
  const token = secrets.getSecret('telegram:token');
  if (!tgSettings().enabled || !token) { setTgStatus({ state: 'off' }); return telegramView(); }
  setTgStatus({ state: 'connecting' });
  const bot = new TelegramBot(token, {
    isAllowed: (chatId) => tgSettings().allowed.some((a) => a.chatId === chatId),
    onPairRequest: ({ chatId, name, username }) => {
      const t = tgSettings();
      const known = t.pending.find((p) => p.chatId === chatId);
      if (known) return known.code;
      const code = pairingCode();
      updateTelegram({ pending: [...t.pending.slice(-9), { chatId, name, username: username || null, code, at: Date.now() }] });
      send('telegram:status', telegramView());
      if (Notification.isSupported()) {
        const n = new Notification({ title: 'Someone wants to talk to Scorpion', body: `${name} messaged your Telegram bot. Approve or ignore in Settings → Connections (code ${code}).` });
        n.on('click', () => { showWindow(); send('open-view', 'connections'); });
        n.show();
      }
      return code;
    },
    onMessage: ({ chatId, text }) => phoneTurn(chatId, text),
    onVoice: ({ chatId, file }) => phoneVoice(chatId, file),
    onCommand: async ({ chatId, command }) => {
      const who = tgSettings().allowed.find((a) => a.chatId === chatId);
      if (command === 'new') {
        updateTelegram({ allowed: tgSettings().allowed.map((a) => (a.chatId === chatId ? { ...a, threadId: null } : a)) });
        return 'Started a new chat.';
      }
      if (command === 'stop') {
        const c = who?.threadId && running.get(who.threadId);
        c?.abort();
        return c ? 'Stopped.' : 'Nothing is running.';
      }
      return 'Talk to me like in Scorpion on your computer. Voice messages work too.\n/new starts a fresh chat\n/stop cancels what I am doing';
    },
    onStatus: (st) => setTgStatus(st.ok ? { state: 'on', bot: st.bot?.username, error: st.error || null } : { state: 'error', bot: st.bot?.username, error: st.error }),
  });
  try {
    await bot.start();
    tg = bot;
  } catch (err) {
    setTgStatus({ state: 'error', error: err.message });
  }
  return telegramView();
}

// ---- MCP tool servers ----
function connectMcp(server) {
  return mcp.connect(server, {
    env: mcp.parseLines(secrets.getSecret(`mcp:${server.id}:env`), '='),
    headers: mcp.parseLines(secrets.getSecret(`mcp:${server.id}:headers`), ':'),
    version: app.getVersion(),
  });
}
function mcpView() {
  return (store.getSettings().mcpServers || []).map((s) => ({ ...s, ...mcp.status(s.id), id: s.id, hasEnv: secrets.hasSecret(`mcp:${s.id}:env`), hasHeaders: secrets.hasSecret(`mcp:${s.id}:headers`) }));
}
// The agent's own browser window (separate profile), made on first use.
let agentBrowser = null;
const browser = () => (agentBrowser ??= createAgentBrowser({ BrowserWindow, session }));

// Tools from outside Scorpion's own table: MCP servers and the agent browser.
const extraTools = () => ({ ...mcp.mcpTools(), ...(store.getSettings().browserEnabled ? browserTools(browser()) : {}) });

// ---- model sources: the local model, or a server (Ollama, LM Studio, cloud) ----
// What the UI may know: never the keys, only whether one is set.
function sourcesView() {
  return (store.getSettings().providers || []).map((p) => ({ ...p, hasKey: secrets.hasSecret(`provider:${p.id}`), local: remote.isLocalUrl(p.baseUrl) }));
}
function sourceById(id) {
  if (!id) return null;
  if (id === 'local') return store.getSettings().chatModel ? { id: 'local', remote: false } : null;
  const p = (store.getSettings().providers || []).find((x) => x.id === id);
  return p ? { ...p, remote: true } : null;
}
function activeSource() {
  return sourceById(store.getSettings().chatSource) || { id: 'local', remote: false };
}
const sameSource = (a, b) => (a.remote ? a.id : 'local') === (b.remote ? b.id : 'local');
const sourceLabel = (src) => (src.remote ? `${src.model || '?'} · ${src.name}` : engine.chatModelName() || modelNameOf(store.getSettings().chatModel));
const modelNameOf = (p) => (p ? path.basename(p, '.gguf') : 'local model');
const providerKey = (p) => secrets.getSecret(`provider:${p.id}`);

async function runTurnWith(src, turn) {
  if (!src.remote) {
    if (turn.slot !== 'voice' && !engine.isChatReady()) await loadChat();
    return engine.runTurn(turn);
  }
  if (!src.model) throw new Error(`Choose a model for ${src.name} in Settings → Connections.`);
  try {
    return await remote.runRemoteTurn({ ...turn, provider: src, apiKey: providerKey(src) });
  } finally {
    engine.forgetLoadedThread(); // the local context no longer matches this chat
  }
}

function completeWith(src, req) {
  return src.remote ? remote.remoteComplete({ ...req, provider: src, apiKey: providerKey(src) }) : engine.complete(req);
}


// The settings a turn runs with, and the inputs its prompt and tool list depend
// on. Shared by real turns and the warm-up, so both read exactly the same text.
function turnSettings(base, { workspace, mode, thread } = {}) {
  const full = base.fileAccess === 'full';
  // A chat works in the workspace it started in (if that folder still exists).
  const own = thread?.workspace && fs.existsSync(thread.workspace) ? thread.workspace : null;
  return { ...base, workspace: workspace ?? own ?? base.workspace ?? (full ? os.homedir() : null), mode: mode || thread?.mode || 'build' };
}
function promptFor(settings, agent, { canAskForFolders, spoken = false, speaker = null, mood = null }) {
  return buildSystemPrompt(settings, {
    docNames: rag.listDocuments().map((d) => d.name),
    memoryBlock: settings.memoryEnabled ? memory.memoryPromptBlock() : '',
    agent,
    canAskForFolders,
    spoken,
    speaker: speaker ? String(speaker).slice(0, 60) : null,
    mood: insights.EMOTIONS.includes(mood) && mood !== 'neutral' ? mood : null,
  });
}
const toolFlags = () => ({
  facesReady: faces.faceStatus().installed,
  libraryReady: library.libraryStatus().counts.total > 0,
  mediaReady: Object.values(mediaModelStatus()).some((m) => m.installed),
  windowsReady: process.platform === 'win32' || process.platform === 'linux', // the agent can run the computer (apps, windows, files, settings)
  extraTools: extraTools(),
});

// A fast model for spoken turns. "auto": when the chat model is slow on this
// computer (a big one on the processor), talk with the best installed model
// that runs fast here; null means "use the chat model".
async function voiceModelPath() {
  const s = store.getSettings();
  if (s.voiceModel === 'same') return null;
  const local = models.listLocalModels(modelEnv()).filter((m) => m.kind === 'chat');
  const chatFile = await effectiveChatModel();
  if (s.voiceModel && s.voiceModel !== 'auto') return s.voiceModel !== chatFile && local.some((m) => m.path === s.voiceModel) ? s.voiceModel : null;
  return fastModelFor(chatFile);
}

async function loadVoiceModel(file) {
  if (engine.isChatReady('voice') && (await engine.engineInfo()).voiceModel === file) return;
  const entry = models.listLocalModels(modelEnv()).find((m) => m.path === file);
  await engine.loadChatModel(file, { contextSize: store.getSettings().contextSize, name: entry?.name, slot: 'voice' });
}

// Warm-up: read a new chat's instructions and tool list in the background
// right after a model loads, so the first message is answered quickly.
async function warmUp({ spoken = false } = {}) {
  if (activeSource().remote || running.size) return false;
  const base = store.getSettings();
  const settings = turnSettings(base, { mode: spoken ? undefined : base.lastChatMode });
  const agent = agents.getAgent('scorpion');
  const voicePath = spoken ? await voiceModelPath() : null;
  const slot = voicePath ? 'voice' : 'main';
  if (voicePath) await loadVoiceModel(voicePath);
  if (!engine.isChatReady(slot)) return false;
  const functions = buildFunctions({
    settings, agent, rag: rag.createSearcher(settings), memory, threadId: null, emit() {}, requestApproval: async () => false,
    requestFolderAccess: async () => null, allowedFolders: [], streamedText: () => '', runHelper: async () => '', ...toolFlags(),
  });
  return engine.warmUp({
    systemPrompt: promptFor(settings, agent, { canAskForFolders: true, spoken }),
    functions,
    effort: engine.usesReasoningEffort(slot) ? thinkingFor(base.thinking, { mode: settings.mode, spoken }) : null,
    slot,
  });
}

/**
 * One agent turn on a thread, used by chats and scheduled agents alike.
 * `approve` decides write/exec actions; chats ask the user in the UI, schedules
 * use their "allow changes" setting. `workspace` overrides the folder.
 */
async function runAgentTurn({ thread, text, displayText = text, approve, workspace, mode, interactive = false, spoken = false, speaker = null, mood = null, intents = interactive }) {
  const threadId = thread.id;
  if (running.has(threadId)) throw new Error('Scorpion is still answering in this chat');
  const base = store.getSettings();
  const full = base.fileAccess === 'full';
  // Full access: every drive is allowed, and relative paths start at home.
  const settings = turnSettings(base, { workspace, mode, thread });
  const agent = agents.getAgent(thread.agentId || 'scorpion');
  let source = activeSource();
  // Spoken turns use the fast voice model when the chat model is slow here.
  const voicePath = spoken && !source.remote ? await voiceModelPath() : null;
  const slot = voicePath ? 'voice' : 'main';
  if (voicePath) await loadVoiceModel(voicePath);
  else if (!source.remote && (!engine.isChatReady() || (!running.size && (await engine.engineInfo()).chatModel !== (await effectiveChatModel())))) await loadChat();

  const assistant = { role: 'assistant', blocks: [], model: voicePath ? engine.chatModelName('voice') : sourceLabel(source), agentId: agent.id, mode: settings.mode, createdAt: Date.now() };
  thread.messages.push({ role: 'user', text: displayText, createdAt: Date.now() }, assistant);
  if (thread.title === 'New chat') thread.title = displayText.replace(/\s+/g, ' ').slice(0, 60);
  store.saveThread(thread);
  send('chat:event', { threadId, type: 'start', agentId: agent.id });

  const controller = new AbortController();
  running.set(threadId, controller);
  const emit = (ev) => {
    applyEvent(assistant.blocks, ev);
    send('chat:event', { threadId, ...ev });
  };
  const requestApproval = (info) => approve(info, controller.signal, threadId);
  // Only a chat someone is watching can ask for folders; scheduled runs keep
  // to their workspace and the folders already allowed for good.
  const requestFolderAccess = interactive ? (req) => askFolderAccess(req, controller.signal) : null;
  const allowedFolders = full ? fileSystemRoots() : [...(base.allowedFolders || []), ...sessionFolders];

  const searcher = rag.createSearcher(settings);
  let streamed = '';
  const info = source.remote ? { contextSize: source.contextSize || 32768, maxToolChars: 16000 } : await engine.engineInfo();
  const effort = !source.remote && engine.usesReasoningEffort(slot) ? thinkingFor(settings.thinking, { mode: settings.mode, spoken }) : null;
  // Questions of fact: the model's most likely answer, not a creative one.
  const baseTemperature = agent.temperature ?? settings.temperature;
  const temperature = settings.preciseAnswers !== false && isFactualQuestion(text) ? Math.min(baseTemperature, 0.2) : baseTemperature;
  try {
    const recall = settings.memoryEnabled && settings.recallEnabled ? withConversationRecall(text, memory, threadId) : text;
    // Standing intents: "when X comes up, do Y" (only for messages from a person).
    const due = intents && settings.memoryEnabled ? memory.fireIntents(text) : [];
    if (due.length) send('memory:changed');
    // A long chat: summarize its older turns instead of letting them fall off.
    try {
      thread.history = await summarizeIfLong(thread.history, info.contextSize, (req) => completeWith(source, { ...req, slot }));
    } catch { /* keep the full history; the engine trims it as before */ }
    const turn = {
      threadId,
      slot,
      effort,
      history: thread.history,
      systemPrompt: promptFor(settings, agent, { canAskForFolders: Boolean(requestFolderAccess), spoken, speaker, mood }),
      text: [await withDocumentContext(recall, searcher), memory.intentsNote(due)].filter(Boolean).join('\n\n'),
      temperature,
      // Building writes whole files and iterates on errors, so it gets more room.
      // A single reply also has to fit in the context, so cap it at half of it.
      // A spoken conversation wants short, quick turns, like talking to a person.
      maxTokens: spoken ? 400 : Math.min(settings.mode === 'build' ? 6144 : 3072, Math.floor((info.contextSize || 8192) / 2)),
      signal: controller.signal,
      functions: buildFunctions({
        settings, agent, rag: searcher, memory, threadId, emit, requestApproval, requestFolderAccess, allowedFolders, ...toolFlags(),
        signal: controller.signal, streamedText: () => streamed,
        runHelper: (opts) => (source.remote ? remote.runRemoteHelper({ ...opts, provider: source, apiKey: providerKey(source) }) : engine.runHelperTurn({ ...opts, slot })),
        maxToolChars: info.maxToolChars ?? undefined,
        onAllowCommand: (command) => {
          const list = store.getSettings().commandAllowlist || [];
          if (!list.includes(command)) send('settings:changed', store.updateSettings({ commandAllowlist: [...list, command] }));
        },
      }),
      continuation: () => continuationPrompt(assistant.blocks),
      onText: (delta) => { streamed += delta; emit({ type: 'text', delta }); },
      onThought: (delta) => emit({ type: 'thought', delta }),
    };
    try {
      thread.history = await runTurnWith(source, turn);
    } catch (err) {
      // Fallback: the chosen source failed before saying anything.
      const fallback = sourceById(settings.fallbackSource);
      if (!fallback || streamed || controller.signal.aborted || sameSource(fallback, source)) throw err;
      emit({ type: 'text', delta: `*${sourceLabel(source)} failed (${String(err?.message || err).slice(0, 160)}). Answering with ${sourceLabel(fallback)} instead.*\n\n` });
      source = fallback;
      assistant.model = sourceLabel(source);
      thread.history = await runTurnWith(source, turn);
    }
    if (controller.signal.aborted) assistant.stopped = true;
  } catch (err) {
    assistant.error = err?.message || String(err);
  } finally {
    running.delete(threadId);
    store.saveThread(thread);
    memory.invalidateRecall();
    send('chat:event', { threadId, type: 'done', error: assistant.error, stopped: assistant.stopped, title: thread.title });
  }
  return { threadId, error: assistant.error, text: streamed };
}

// When a long turn pauses for room, the follow-up carries the live plan so the
// model knows exactly where it is even after older context is dropped.
function continuationPrompt(blocks) {
  const plan = blocks.find((b) => b.type === 'plan');
  const mark = (s) => (s.status === 'done' ? '[done]' : s.status === 'in_progress' ? '[in progress]' : '[todo]');
  const status = plan?.steps?.length
    ? `\nPlan status:\n${plan.steps.map((s) => `${mark(s)} ${s.title}`).join('\n')}`
    : '';
  return `(Scorpion: continuing the same task.)${status}\nCarry on with the next unfinished step. When every step is done and tested, give the final summary.`;
}

// Interactive approval: show Allow/Deny in the chat and wait for the click.
function askUser(info, signal, threadId) {
  return new Promise((resolve) => {
    approvals.set(info.id, resolve);
    signal.addEventListener('abort', () => resolve(false), { once: true });
    send('chat:event', { threadId, type: 'approval', ...info });
  });
}

// ---- media for the Library: short-lived links to files in the library ----
const mediaTokens = new Map(); // token -> { file, expires }
function mediaUrl(file) {
  const token = crypto.randomBytes(12).toString('hex');
  mediaTokens.set(token, { file, expires: Date.now() + 30 * 60 * 1000 });
  return `scorpion://app/media/${token}/${encodeURIComponent(path.basename(file))}`;
}
const MEDIA_TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/opus', '.flac': 'audio/flac', '.wav': 'audio/wav' };
// Serves a library file with Range support, so videos can seek.
function serveMedia(request, token) {
  const t = mediaTokens.get(token);
  if (!t || t.expires < Date.now()) return new Response('Gone', { status: 410 });
  const size = fs.statSync(t.file).size;
  const type = MEDIA_TYPES[path.extname(t.file).toLowerCase()] || 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
  if (!m) return new Response(Readable.toWeb(fs.createReadStream(t.file)), { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } });
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(Readable.toWeb(fs.createReadStream(t.file, { start, end })), {
    status: 206, headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' },
  });
}

// Videos and music are decoded by the window (Chromium plays them); the
// library asks for a few frames or 16 kHz sample windows and waits.
const decodeWaiters = new Map();
function decodeInWindow(kind, file) {
  if (!win || win.isDestroyed()) return Promise.reject(new Error('Videos and music need the Scorpion window open'));
  const id = crypto.randomBytes(8).toString('hex');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { decodeWaiters.delete(id); reject(new Error('Decoding took too long')); }, 120000);
    decodeWaiters.set(id, (res) => { clearTimeout(timer); res.error ? reject(new Error(res.error)) : resolve(res); });
    send('library:decode', { id, kind, url: mediaUrl(file) });
  });
}

// What the lock screen may call while Scorpion is locked.
const LOCK_SCREEN_CHANNELS = new Set(['lock:status', 'lock:face', 'lock:pin', 'camera:use', 'window:fullscreen']);
let lockStreak = 0; // consecutive frames that showed the owner
const LIVE_TO_UNLOCK = 0.7; // stricter than DeepFace's plain yes/no, for unlocking

// A camera frame from the page (RGBA) as an image for the face code.
const frameImage = ({ data, width, height }) => ({ data: data instanceof Uint8Array || data instanceof Uint8ClampedArray ? data : new Uint8Array(data), width, height, channels: 4 });

// Live analysis like DeepFace's stream: expression and liveness on every frame
// (small models), age and gender (two 500 MB models) at most every 3 seconds
// for the largest face, reused for the frames in between.
let liveDemo = { at: 0, box: null, age: null, gender: null };
async function describeLive(img, seen) {
  if (!seen.length) return seen;
  const st = insights.insightsStatus();
  const main = seen.reduce((a, b) => (b.box[2] * b.box[3] > a.box[2] * a.box[3] ? b : a));
  const out = await insights.describeFaces(img, seen, { demography: false });
  if (st.demography.installed) {
    if (Date.now() - liveDemo.at > 3000 || !liveDemo.box || faces.boxOverlap(liveDemo.box, main.box) < 0.3) {
      const [d] = await insights.describeFaces(img, [main], { live: false });
      // Same face as before: average with earlier samples, so one odd frame
      // (light, angle, blur) doesn't flip the answer.
      const same = liveDemo.box && faces.boxOverlap(liveDemo.box, main.box) >= 0.3 && liveDemo.gender && d.gender;
      const scores = same ? Object.fromEntries(Object.entries(d.gender.scores).map(([k, v]) => [k, liveDemo.gender.scores[k] * 0.6 + v * 0.4])) : d.gender?.scores;
      const gender = scores ? (([label, score]) => ({ label, score, scores }))(Object.entries(scores).reduce((x, y) => (y[1] > x[1] ? y : x))) : null;
      liveDemo = { at: Date.now(), box: main.box, age: same && d.age != null ? Math.round(liveDemo.age * 0.6 + d.age * 0.4) : d.age, gender };
    }
    for (const f of out) if (faces.boxOverlap(f.box, liveDemo.box) >= 0.3) Object.assign(f, { age: liveDemo.age, gender: liveDemo.gender });
  }
  return out;
}

// Folders allowed until Scorpion quits ("Allow" without "Always allow").
const sessionFolders = new Set();

// The agent needs a folder the user hasn't allowed: ask with a native dialog.
// folder null means there's no workspace yet, so let the user choose one.
async function askFolderAccess({ folder, name, summary }, signal) {
  if (signal.aborted || !win || win.isDestroyed()) return null;
  showWindow();
  if (!folder) {
    const r = await dialog.showMessageBox(win, {
      type: 'question', title: 'Scorpion', noLink: true, buttons: ['Choose folder…', 'Not now'], defaultId: 0, cancelId: 1,
      message: 'Scorpion needs a folder to work in',
      detail: `The agent wants to work with files (${summary}).\n\nChoose the folder it may read and work in. You can change it any time with the folder button in the top bar.`,
    });
    if (r.response !== 0 || signal.aborted) return null;
    const pick = await dialog.showOpenDialog(win, { title: 'Choose the folder Scorpion may work in', properties: ['openDirectory', 'createDirectory'] });
    if (pick.canceled || !pick.filePaths[0]) return null;
    send('settings:changed', store.updateSettings({ workspace: pick.filePaths[0] }));
    return { workspace: pick.filePaths[0] };
  }
  const access = TOOLS[name]?.access;
  const verb = access === 'exec' ? 'run commands in' : access === 'write' ? 'change files in' : 'read files in';
  const broad = folder === path.parse(folder).root || folder === os.homedir();
  const later = access === 'read' || store.getSettings().autoApprove ? '' : '\n\nYou will still be asked before each change or command.';
  const r = await dialog.showMessageBox(win, {
    type: broad ? 'warning' : 'question', title: 'Scorpion', noLink: true, buttons: ['Allow', 'Don\'t allow'], defaultId: 0, cancelId: 1,
    message: `Allow Scorpion to ${verb} this folder?`,
    detail: `${folder}\n\nThe agent wants to: ${summary}\nThis folder is outside your workspace.${broad ? '\n\nThis gives access to everything in it, including all subfolders.' : ''}${later}`,
    checkboxLabel: 'Always allow this folder',
  });
  if (r.response !== 0 || signal.aborted) return null;
  if (r.checkboxChecked) {
    const list = store.getSettings().allowedFolders || [];
    if (!list.includes(folder)) send('settings:changed', store.updateSettings({ allowedFolders: [...list, folder] }));
  } else {
    sessionFolders.add(folder);
  }
  return { folder };
}

async function chatSend({ threadId, text, spoken = false, speaker = null, mood = null }) {
  const thread = store.getThread(threadId);
  if (!thread) throw new Error('Chat not found');
  const result = await runAgentTurn({ thread, text, approve: askUser, interactive: true, spoken, speaker, mood });
  return { ok: !result.error };
}

// A scheduled run posts into the schedule's own chat and notifies when done.
async function runScheduled(schedule, reason) {
  let thread = schedule.threadId && store.getThread(schedule.threadId);
  if (!thread) {
    thread = store.createThread();
    thread.title = `Scheduled: ${schedule.name}`;
    thread.agentId = schedule.agentId;
    store.saveThread(thread);
    send('threads:changed');
  }
  thread.agentId = schedule.agentId;
  const workspace = schedule.trigger.type === 'folder' ? schedule.trigger.folder : schedule.workspace || undefined;
  const when = new Date().toLocaleString();
  const result = await runAgentTurn({
    thread,
    text: `[Scheduled task "${schedule.name}" · ${when} · trigger: ${reason}]\n${schedule.prompt}\n\nThis runs unattended: do the task, then reply with a short report.${schedule.allowChanges ? '' : ' You may not change files or run commands in this run.'}`,
    displayText: `Scheduled (${reason})\n${schedule.prompt}`,
    approve: async () => schedule.allowChanges,
    workspace,
    mode: 'build',
  });
  if (Notification.isSupported()) {
    const n = new Notification({
      title: `${result.error ? 'Failed: ' : ''}${schedule.name}`,
      body: (result.error || result.text || 'Done').replace(/[#*`>_]/g, '').trim().slice(0, 180),
      silent: true,
    });
    n.on('click', () => { showWindow(); send('open-thread', thread.id); });
    n.show();
  }
  send('schedules:changed');
  pcEvent('schedule', result.error ? `${schedule.name} failed.` : `${schedule.name} is done.`, result.error ? 'alert' : 'ok');
  return result;
}

// Scorpion stays in the tray when closed while it has background work:
// scheduled agents, check-ins or the phone (Telegram) connection.
function keepsRunning() {
  const s = store.getSettings();
  return scheduler.hasEnabledSchedules() || Boolean(s.heartbeatEnabled) || Boolean(s.telegram?.enabled);
}

// Dreaming: once a day, while the computer sits idle and a model is already
// loaded, turn what the user said recently into lasting memories.
let dreaming = false;
async function runDream({ force = false } = {}) {
  const s = store.getSettings();
  if (dreaming || lock.isLocked()) return null;
  // Dreams read your chats unattended, so they only use a model on this
  // computer (or a server on your own network), never a cloud service.
  const chosen = activeSource();
  const src = chosen.remote && remote.isLocalUrl(chosen.baseUrl) ? chosen : { id: 'local', remote: false };
  const ready = src.remote || engine.isChatReady();
  if (!force && (!ready || !dreamDue(s, { last: dreamState().last, idleSeconds: powerMonitor.getSystemIdleTime(), busy: running.size > 0 }))) return null;
  if (!s.memoryEnabled) throw new Error('Turn on memory first (Settings → General → Memory).');
  if (!src.remote && !s.chatModel) throw new Error('Dreaming needs a model on this computer (Models) or a server on your own network.');
  dreaming = true;
  try {
    if (!src.remote && !engine.isChatReady()) await loadChat();
    const entry = await dream({ memory, complete: (req) => completeWith(src, req), skipThreads: [s.heartbeatThreadId].filter(Boolean) });
    if (entry.added.length) send('memory:changed');
    return entry;
  } finally {
    dreaming = false;
  }
}

// Check-ins (heartbeat): review HEARTBEAT.md, notify only when something
// needs the user. An all-clear (HEARTBEAT_OK) is removed from the chat again.
let heartbeatBusy = false;
async function runHeartbeat({ force = false } = {}) {
  const s = store.getSettings();
  const checklist = persona.getChecklist();
  if (heartbeatBusy || !checklist.trim() || lock.isLocked()) return null;
  if (!force && (running.size || !persona.heartbeatDue(s, { lastRun: persona.heartbeatState().lastRun, checklist }))) return null;
  heartbeatBusy = true;
  try {
    let thread = s.heartbeatThreadId && store.getThread(s.heartbeatThreadId);
    if (!thread) {
      thread = store.createThread();
      thread.title = 'Check-ins';
      store.saveThread(thread);
      store.updateSettings({ heartbeatThreadId: thread.id });
      send('threads:changed');
    }
    const before = { messages: thread.messages.length, history: thread.history };
    const result = await runAgentTurn({ thread, text: persona.heartbeatPrompt(checklist), displayText: 'Check-in', approve: async () => false, mode: 'build' });
    const ok = !result.error && persona.isHeartbeatOk(result.text);
    persona.recordHeartbeat(result.error ? 'error' : ok ? 'ok' : 'alert');
    if (ok) {
      thread.messages.length = before.messages;
      thread.history = before.history;
      store.saveThread(thread);
    } else {
      pcEvent('checkin', (result.error || result.text).replace(/[#*`>_]/g, '').trim().slice(0, 160), 'alert');
    }
    if (!ok && Notification.isSupported()) {
      const n = new Notification({ title: result.error ? 'Check-in failed' : 'Scorpion check-in', body: (result.error || result.text).replace(/[#*`>_]/g, '').trim().slice(0, 180), silent: false });
      n.on('click', () => { showWindow(); send('open-thread', thread.id); });
      n.show();
    }
    send('threads:changed');
    return { ok, text: result.text, error: result.error };
  } finally {
    heartbeatBusy = false;
  }
}

// ---------- Scorpion as the Windows desktop ----------
// What Windows runs at sign-in when Scorpion is this account's desktop.
function shellCommand() {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  return app.isPackaged ? `"${exe}" --shell` : `"${exe}" "${APP_ROOT}" --shell`;
}
async function desktopStatus() {
  if (process.platform !== 'win32') return { supported: false };
  const userShell = await winctl.getUserShell().catch(() => null);
  const exe = (process.env.PORTABLE_EXECUTABLE_FILE || process.execPath).toLowerCase();
  return { supported: true, mode: desktop.shellMode(), userShell, isScorpion: Boolean(userShell && userShell.toLowerCase().includes(exe)), packaged: app.isPackaged, command: shellCommand() };
}

// Program icons for the taskbar, once per program.
const icons = new Map();
async function fileIcon(exe) {
  if (!exe) return null;
  if (!icons.has(exe)) icons.set(exe, await app.getFileIcon(exe, { size: 'normal' }).then((i) => i.toDataURL()).catch(() => null));
  return icons.get(exe);
}

// A folder for the Files screen; no folder means "This PC" (the drives).
function listFolder(dir) {
  if (!dir) {
    const drives = [];
    for (let c = 67; c <= 90; c++) { const d = `${String.fromCharCode(c)}:\\`; if (fs.existsSync(d)) drives.push({ name: d, path: d, dir: true }); }
    const home = os.homedir();
    const places = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos'].map((n) => ({ name: n, path: path.join(home, n), dir: true })).filter((p) => fs.existsSync(p.path));
    return { dir: null, parent: null, items: [...places, ...drives] };
  }
  const items = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    let st = null;
    try { st = fs.statSync(p); } catch { /* no access */ }
    if (!st) continue;
    items.push({ name: e.name, path: p, dir: st.isDirectory(), size: st.isDirectory() ? null : st.size, modified: st.mtimeMs, hidden: e.name.startsWith('.') || /^(desktop\.ini|thumbs\.db|\$recycle\.bin|system volume information)$/i.test(e.name) });
  }
  items.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const parent = path.dirname(dir);
  return { dir, parent: parent === dir ? '' : parent, items };
}

// Folders open in Scorpion's Files screen while it is the desktop, otherwise in
// File Explorer.
function openFolder(p) {
  if (desktop.shellMode() === 'shell') showView('files', { dir: p });
  else shell.openPath(p);
}

// The taskbar's power menu: what the user picked, done right away (as in the
// Windows Start menu; programs can still stop a restart to save work).
async function powerAction(action) {
  if (action === 'lock' || action === 'sleep') return winctl.systemControl(action);
  if (action === 'signout') return winctl.signOut();
  if (action === 'restart' || action === 'shutdown') return winctl.powerNow(action);
  if (action === 'explorer') { await desktop.stopShell(); return winctl.explorerRunning().then((on) => on || winctl.startExplorer()); }
  throw new Error('Unknown power action');
}

// The constellation launcher's summon shortcut (Settings → General →
// Constellation): brings Scorpion forward with the map and its search ready.
// Windows keeps some combinations for itself (Win+Space switches keyboard
// layouts); if the chosen one can't be had, Win+Alt+Space (or Ctrl+Shift+Space) is used.
let summonKey = null;
function registerSummon(accel) {
  if (accel !== undefined) store.updateSettings({ constellationShortcut: String(accel || '') });
  if (summonKey) { globalShortcut.unregister(summonKey); summonKey = null; }
  const wanted = store.getSettings().constellationShortcut ?? 'Super+Space';
  const summon = () => { showWindow(); if (navReady) send('nav:view', { view: 'orb', search: true }); else pendingNav = { view: 'orb', search: true }; };
  for (const key of [wanted, 'Super+Alt+Space', 'Control+Shift+Space'].filter(Boolean)) {
    try { if (globalShortcut.register(key, summon)) { summonKey = key; break; } } catch { /* not a valid combination */ }
  }
  return summonKey;
}

// The taskbar's own settings, with defaults for anything missing. layout:
// 'orbit' (the edge rail with the summon dot and intent wheel) or 'bar'.
function taskbarSettings() {
  const t = store.getSettings().taskbar || {};
  return { pinned: [], labels: true, center: false, size: 'normal', style: 'holo', layout: 'orbit', autoHide: false, intents: {}, ...t, show: { network: true, battery: true, volume: true, clock: true, notifications: true, mail: true, chat: true, ...(t.show || {}) } };
}
function setTaskbarLook(t) {
  const s = store.updateSettings({ taskbar: t });
  send('settings:changed', s);
  desktop.relayout().then((changed) => { if (changed) { desktop.raiseTaskbar(); sendTaskbarInset(); } }).catch((err) => console.error(err));
  desktop.refreshRail(); // auto-hide on or off
  sendTaskbarInset();
  return s;
}

// The intent wheel (summon.html): what each intent opens. Each can be changed
// to another app (right-click it on the wheel).
const INTENT_APPS = process.platform === 'linux' ? {
  // Scorpion OS's own apps (os/config/packages.list).
  write: { id: 'org.gnome.TextEditor.desktop', name: 'Text Editor', fallback: 'gnome-text-editor' },
  create: { id: 'com.github.maoschanz.drawing.desktop', name: 'Drawing', fallback: 'drawing' },
  focus: { id: 'org.gnome.clocks.desktop', name: 'Clocks (timers)', fallback: 'gnome-clocks' },
} : {
  write: { id: 'Microsoft.WindowsNotepad_8wekyb3d8bbwe!App', name: 'Notepad', fallback: 'notepad.exe' },
  create: { id: 'Microsoft.Paint_8wekyb3d8bbwe!App', name: 'Paint', fallback: 'mspaint.exe' },
  focus: { id: 'Microsoft.WindowsAlarms_8wekyb3d8bbwe!App', name: 'Clock (focus sessions)' },
};
const INTENT_LABEL = { write: 'Write', browse: 'Browse', talk: 'Talk', create: 'Create', files: 'Files', focus: 'Focus' };
const INTENT_BUILTIN = { browse: 'Your default browser', talk: 'Talk to Scorpion', files: "Scorpion's Files" };
// The program the system opens for a kind of link (http: your browser, mailto: your mail).
async function openDefault(proto, fallback) {
  const app = await winctl.defaultApp(proto).catch(() => null);
  if (app) return winctl.launchApp(app);
  return shell.openExternal(fallback);
}
async function runIntent(id) {
  desktop.closeWheel();
  const launch = (a) => winctl.launchApp(a, { viaExplorer: desktop.shellMode() !== 'shell' });
  const chosen = taskbarSettings().intents[id];
  if (chosen?.id) return launch(chosen);
  // The wheel's centre: the desktop, or (Scorpion only minimized) back to the orb.
  if (id === 'home') return showView(desktop.shellMode() === 'shell' || process.platform !== 'win32' ? 'desktop' : 'orb');
  if (id === 'talk') return showView('orb', { talk: true });
  if (id === 'files') return showView('files');
  if (id === 'browse') return openDefault('http', process.platform === 'linux' ? 'https://duckduckgo.com' : 'https://www.bing.com');
  const a = INTENT_APPS[id];
  if (!a) throw new Error(`Unknown intent "${id}"`);
  try { return await launch(a); } catch (err) {
    if (!a.fallback) throw err;
    if (process.platform === 'win32') return winctl.runPs(`Start-Process ${winctl.psQuote(a.fallback)}`);
    return winctl.launchApp({ id: a.fallback, name: a.name });
  }
}
// An entry of the shared list (src/shared/intents.js) that the main process
// runs: a system settings page, a safe system control, or a wheel intent.
async function runNamedIntent(id) {
  const it = findIntent(id, process.platform, { live: process.platform === 'linux' && winctl.isLiveSession() });
  const kind = it?.run?.main;
  // Scorpion OS's updates are Scorpion's own (Settings → This computer).
  if (kind === 'settings' && it.run.arg === 'update' && process.platform === 'linux') return showView('settings', { section: 'system' });
  if (kind === 'settings') return winctl.openSettings(it.run.arg);
  if (kind === 'stage') return setStage(!store.getSettings().stage);
  if (kind === 'control' && MAIN_CONTROLS.includes(it.run.arg)) return winctl.systemControl(it.run.arg);
  if (kind === 'wheel') return runIntent(it.run.arg);
  if (kind === 'install') return winctl.startInstaller();
  throw new Error(`"${id}" isn't something Scorpion can do here.`);
}
// When each open window was last in front (the taskbar asks every 1.5 s), for
// the wheel's recent windows.
const lastUsed = new Map();
let updates = null; // Scorpion OS's updates (updates.js)
const ACCESS_FEATURES = ['bigText', 'screenReader', 'keyboard'];
const accessSettings = () => ({ bigText: false, screenReader: false, keyboard: false, ...(store.getSettings().access || {}) });
// Bigger text is Scorpion's zoom plus (Scorpion OS) the system's text size;
// the screen reader and keyboard are the system's own.
async function applyAccess(a = accessSettings(), only = ACCESS_FEATURES) {
  if (only.includes('bigText')) {
    for (const w of BrowserWindow.getAllWindows()) if (w === win) w.webContents.setZoomFactor(a.bigText ? 1.25 : 1);
    await winctl.textScale(a.bigText ? 1.25 : 1);
  }
  if (only.includes('screenReader')) {
    if (a.screenReader) app.setAccessibilitySupportEnabled(true);
    await winctl.screenReader(a.screenReader);
  }
  if (only.includes('keyboard')) {
    await winctl.onScreenKeyboard(a.keyboard);
    // Full screen would cover the keyboard (Scorpion OS draws it at the bottom).
    if (a.keyboard && fullMode) setFullMode(false);
  }
}
// A window's native handle as text: 8 bytes on Windows (HWND), 4 on Linux (an X11 id).
const nativeId = (bw) => { const b = bw.getNativeWindowHandle(); return b.length >= 8 ? b.readBigInt64LE().toString() : String(b.readUInt32LE()); };
// Notifications the session received (shell:notifyIn), newest first.
let notifications = [];
const notificationSummary = () => ({ unread: notifications.filter((n) => !n.read).length, total: notifications.length });
function noteWindows(list) {
  const now = Date.now();
  for (const w of list) if (w.active) lastUsed.set(w.hwnd, now);
  for (const h of lastUsed.keys()) if (!list.some((w) => w.hwnd === h)) lastUsed.delete(h);
  // Scorpion OS: full mode is a full-screen window, which hides every other
  // (Windows pulls a focused app into the orb instead). When another app's
  // window takes focus (one opened from the wheel, the installer, a
  // terminal), Scorpion leaves full mode so it can be seen.
  if (process.platform === 'linux' && fullMode && list.some((w) => w.active && !w.self)) setFullMode(false);
}
// The wheel's summon shortcut (Win+Shift+Space, or Alt+Shift+Space): the wheel
// opens where the pointer is.
let wheelKey = null;
function registerWheelKey() {
  if (wheelKey) { globalShortcut.unregister(wheelKey); wheelKey = null; }
  const open = () => desktop.openWheel(screen.getCursorScreenPoint());
  for (const key of ['Super+Shift+Space', 'Alt+Shift+Space']) {
    try { if (globalShortcut.register(key, open)) { wheelKey = key; break; } } catch { /* taken */ }
  }
  return wheelKey;
}
// The look at the open windows (filling the screen, flying into Stage); set
// up with the IPC handlers, which have the window list.
let watchWindows = () => {};
// Stage (Windows, and Scorpion OS's shell host): kept in the settings, and the pages told.
function setStage(on) {
  if (process.platform !== 'win32' && !desktop.hostActive()) throw new Error('Stage needs Windows or Scorpion OS.');
  const s = store.updateSettings({ stage: Boolean(on) });
  desktop.setStage(s.stage);
  send('settings:changed', s);
  watchWindows();
  return s.stage;
}
// A small picture of the main screen (a quarter size: it is only shown blurred,
// behind the intent wheel). It stays on this computer. Scorpion OS takes it
// with grim (labwc lets it read the screen without asking).
async function snapScreen() {
  if (process.platform === 'linux') {
    const { execFile } = await import('node:child_process');
    // PNG, quickly packed (Ubuntu's grim has no JPEG).
    const png = await new Promise((resolve, reject) => execFile('grim', ['-s', '0.25', '-l', '1', '-'], { encoding: 'buffer', maxBuffer: 8 << 20, timeout: 2000 }, (err, out) => (err ? reject(err) : resolve(out))));
    return png.length ? `data:image/png;base64,${png.toString('base64')}` : null;
  }
  const d = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.size.width / 4), height: Math.round(d.size.height / 4) } });
  const s = sources.find((x) => String(x.display_id) === String(d.id)) || sources[0];
  return s && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null;
}
// Pin an app (a Start menu app id, or a program's path) to the taskbar, or unpin it.
function setPinned({ id, name, on }) {
  const t = taskbarSettings();
  const rest = t.pinned.filter((p) => p.id.toLowerCase() !== String(id).toLowerCase());
  return setTaskbarLook({ ...t, pinned: on ? [...rest, { id: String(id), name: String(name || id) }] : rest });
}
// A program's own name ("Google Chrome" for chrome.exe).
const programName = (exe) => winctl.programName(exe);

// The holographic taskbar whenever Scorpion runs (Settings → General → Windows
// desktop), in place of the Windows taskbar. Scorpion as the desktop has its own.
async function setTaskbarAlwaysOn(on) {
  send('settings:changed', store.updateSettings({ taskbarAlwaysOn: Boolean(on) }));
  const m = desktop.shellMode();
  if (on && !m) await desktop.startShell('bar');
  else if (!on && m === 'bar') await desktop.stopShell();
  desktop.raiseTaskbar();
  sendTaskbarInset();
  return desktopStatus();
}

function registerIpc() {
  const h = (channel, fn) => {
    const guarded = (arg) => {
      if (lock.isLocked() && !LOCK_SCREEN_CHANNELS.has(channel)) throw new Error('Scorpion is locked');
      return fn(arg);
    };
    handlers[channel] = guarded;
    ipcMain.handle(channel, (_e, arg) => guarded(arg));
  };

  h('app:state', state);
  // ---- skills ----
  h('skills:list', () => skills.listSkills());
  h('skills:get', (name) => skills.getSkill(name));
  h('skills:save', (input) => { skills.saveSkill(input || {}); return skills.listSkills(); });
  h('skills:delete', (name) => { skills.deleteSkill(name); return skills.listSkills(); });
  h('skills:undo', (name) => { skills.undoSkill(name); return skills.listSkills(); });
  h('skills:enable', ({ name, on }) => { skills.setSkillEnabled(name, on); return skills.listSkills(); });
  h('skills:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a skill folder (with a SKILL.md) or a folder of skills', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { imported: [], skills: skills.listSkills() };
    return { imported: skills.importSkills(r.filePaths[0]), skills: skills.listSkills() };
  });
  h('skills:openFolder', () => shell.openPath(skills.skillsFolder()));
  // ---- personality and check-ins ----
  h('persona:get', () => ({ soul: persona.getSoul(), checklist: persona.getChecklist(), heartbeat: persona.heartbeatState() }));
  h('persona:saveSoul', (text) => persona.saveSoul(text));
  h('persona:saveChecklist', (text) => persona.saveChecklist(text));
  h('persona:checkNow', () => runHeartbeat({ force: true }));
  // ---- dreaming and standing intents ----
  h('memory:dreams', () => dreamState());
  h('memory:dreamNow', () => runDream({ force: true }));
  h('intents:list', () => memory.listIntents());
  h('intents:delete', (id) => { memory.cancelIntent(id); return memory.listIntents(); });
  // ---- model sources ----
  h('sources:presets', () => remote.PRESETS);
  h('sources:save', ({ provider, key }) => {
    const s = store.getSettings();
    const list = s.providers || [];
    const preset = remote.PRESETS[provider.kind] || remote.PRESETS.custom;
    const clean = {
      id: provider.id || store.newId(),
      kind: remote.PRESETS[provider.kind] ? provider.kind : 'custom',
      name: String(provider.name || preset.name).slice(0, 60),
      baseUrl: String(provider.baseUrl || preset.baseUrl).trim(),
      model: String(provider.model || '').trim(),
      contextSize: Math.max(2048, Number(provider.contextSize) || 32768),
    };
    if (!/^https?:\/\//.test(clean.baseUrl)) throw new Error('The server address must start with http:// or https://');
    if (key !== undefined && key !== null) secrets.setSecret(`provider:${clean.id}`, key); // '' removes it
    const next = list.some((p) => p.id === clean.id) ? list.map((p) => (p.id === clean.id ? clean : p)) : [...list, clean];
    send('settings:changed', store.updateSettings({ providers: next }));
    return sourcesView();
  });
  h('sources:delete', (id) => {
    const s = store.getSettings();
    secrets.setSecret(`provider:${id}`, null);
    send('settings:changed', store.updateSettings({
      providers: (s.providers || []).filter((p) => p.id !== id),
      chatSource: s.chatSource === id ? 'local' : s.chatSource,
      fallbackSource: s.fallbackSource === id ? null : s.fallbackSource,
    }));
    return sourcesView();
  });
  h('sources:models', async ({ id, provider, key }) => {
    const p = id ? sourceById(id) : provider;
    if (!p) throw new Error('Unknown source');
    return remote.listRemoteModels(p, key || (id ? providerKey(p) : null));
  });
  // ---- phone (Telegram) ----
  h('telegram:status', () => telegramView());
  h('telegram:save', async ({ token, enabled }) => {
    if (token !== undefined && token !== null) {
      const t = String(token).trim();
      if (t && !/^\d+:[\w-]{30,}$/.test(t)) throw new Error('That doesn\'t look like a bot token. It looks like 123456789:ABCdef… (from @BotFather).');
      secrets.setSecret('telegram:token', t);
    }
    if (enabled !== undefined) updateTelegram({ enabled: Boolean(enabled) });
    ensureTrayHint();
    return startTelegram();
  });
  h('telegram:approve', (chatId) => {
    const t = tgSettings();
    const p = t.pending.find((x) => x.chatId === chatId);
    if (!p) throw new Error('That request is gone');
    updateTelegram({ pending: t.pending.filter((x) => x !== p), allowed: [...t.allowed.filter((a) => a.chatId !== chatId), { chatId, name: p.name, username: p.username, threadId: null }] });
    tg?.send(chatId, 'You are approved. Ask me anything.').catch(() => {});
    return telegramView();
  });
  h('telegram:deny', (chatId) => { updateTelegram({ pending: tgSettings().pending.filter((x) => x.chatId !== chatId) }); return telegramView(); });
  h('telegram:remove', (chatId) => { updateTelegram({ allowed: tgSettings().allowed.filter((a) => a.chatId !== chatId) }); return telegramView(); });
  // ---- the agent's browser ----
  h('browser:show', () => { browser().show(); return true; });
  h('browser:close', () => { agentBrowser?.close(); return true; });
  h('browser:clear', async () => { await browser().clearData(); return true; });
  // ---- MCP tool servers ----
  h('mcp:list', () => mcpView());
  h('mcp:save', async ({ server, env, headers }) => {
    const list = store.getSettings().mcpServers || [];
    const clean = {
      id: server.id || store.newId(),
      name: String(server.name || '').trim().slice(0, 40),
      transport: ['stdio', 'http', 'sse'].includes(server.transport) ? server.transport : 'stdio',
      command: String(server.command || '').trim(),
      args: String(server.args || '').trim(),
      url: String(server.url || '').trim(),
      enabled: server.enabled !== false,
      trusted: Boolean(server.trusted),
    };
    if (!clean.name) throw new Error('Give the server a name');
    if (clean.transport === 'stdio' && !clean.command) throw new Error('Enter the command that starts the server (for example npx)');
    if (clean.transport !== 'stdio' && !/^https?:\/\//.test(clean.url)) throw new Error('Enter the server URL (http:// or https://)');
    if (list.some((s) => s.id !== clean.id && mcp.serverKey(s.name) === mcp.serverKey(clean.name))) throw new Error('Another server already has that name');
    if (env !== undefined && env !== null) secrets.setSecret(`mcp:${clean.id}:env`, env);
    if (headers !== undefined && headers !== null) secrets.setSecret(`mcp:${clean.id}:headers`, headers);
    const next = list.some((s) => s.id === clean.id) ? list.map((s) => (s.id === clean.id ? clean : s)) : [...list, clean];
    send('settings:changed', store.updateSettings({ mcpServers: next }));
    if (clean.enabled) await connectMcp(clean); else await mcp.disconnect(clean.id);
    return mcpView();
  });
  h('mcp:delete', async (id) => {
    await mcp.disconnect(id);
    secrets.setSecret(`mcp:${id}:env`, null);
    secrets.setSecret(`mcp:${id}:headers`, null);
    send('settings:changed', store.updateSettings({ mcpServers: (store.getSettings().mcpServers || []).filter((s) => s.id !== id) }));
    return mcpView();
  });
  h('mcp:reconnect', async (id) => {
    const s = (store.getSettings().mcpServers || []).find((x) => x.id === id);
    if (s) await connectMcp(s);
    return mcpView();
  });
  h('sources:test', async (id) => {
    const p = sourceById(id);
    if (!p?.remote) throw new Error('Unknown source');
    const started = Date.now();
    const text = await remote.remoteComplete({ provider: p, apiKey: providerKey(p), systemPrompt: 'Reply with one short sentence.', text: 'Say hello.', maxTokens: 30, signal: AbortSignal.timeout(60000) });
    return { text: text.trim().slice(0, 200), ms: Date.now() - started };
  });
  // ---- media library ----
  h('library:status', () => library.libraryStatus());
  h('library:addFolder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a folder of photos, videos or music', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return library.libraryStatus();
    library.addFolder(r.filePaths[0]);
    library.scan().catch(() => {});
    return library.libraryStatus();
  });
  h('library:removeFolder', (folder) => { library.removeFolder(folder); return library.libraryStatus(); });
  h('library:setFeatures', (patch) => { library.setFeatures(patch); library.scan().catch(() => {}); return library.libraryStatus(); });
  // Downloads what the enabled features need (CLIP, the audio model, faces).
  h('library:install', async () => {
    const f = library.libraryStatus().features;
    const keys = [];
    if (f.objects || f.landmarks || f.video) keys.push('clip');
    if (f.music) keys.push('audio');
    const facesNeeded = f.faces && !faces.faceStatus().installed;
    const total = keys.reduce((n, k) => n + (mediaModelStatus()[k].installed ? 0 : mediaModelStatus()[k].bytes), 0) + (facesNeeded ? faces.FACE_DOWNLOAD_BYTES : 0);
    let base = 0;
    await installMediaModels(keys, (p) => { if (!p.done) send('library:download', { loaded: base + p.loaded, total }); });
    base = total - (facesNeeded ? faces.FACE_DOWNLOAD_BYTES : 0);
    if (facesNeeded) await faces.installFaces((p) => { if (!p.done) send('library:download', { loaded: base + p.loaded, total }); });
    send('library:download', { done: true });
    library.scan().catch(() => {});
    return library.libraryStatus();
  });
  h('library:uninstallModels', async () => { library.stopScan(); await uninstallMediaModels(); return library.libraryStatus(); });
  h('library:scan', () => { library.scan().catch(() => {}); return library.libraryStatus(); });
  h('library:pause', (on) => { library.pauseScan(on); return library.libraryStatus(); });
  h('library:clear', () => { library.stopScan(); library.clearLibrary(); return library.libraryStatus(); });
  h('library:search', (q) => library.searchLibrary(q || {}));
  h('library:tags', () => library.tagCloud());
  h('library:clusters', async () => Promise.all(library.faceClusters().slice(0, 40).map(async (c) => ({
    id: c.id, count: c.count, photos: c.photos,
    faces: await Promise.all(c.sample.slice(0, 3).map((s) => library.faceCrop(s.path, s.box).catch(() => null))),
  }))));
  h('library:nameCluster', ({ id, name }) => library.nameCluster(id, name));
  h('library:mediaUrl', (file) => (library.itemInfo(file) ? mediaUrl(file) : null));
  h('library:open', (file) => (library.itemInfo(file) ? shell.openPath(file) : 'Not in the library'));
  h('library:reveal', (file) => { if (library.itemInfo(file)) shell.showItemInFolder(file); return true; });
  h('library:setLimits', (patch) => { library.setLimits(patch || {}); return library.libraryStatus(); });
  h('library:resetFeature', (key) => { const s = library.resetFeature(key); library.scan().catch(() => {}); return s; });
  h('library:share', (mode) => library.setShareMode(mode));
  h('library:shareAll', () => library.shareAll());
  h('library:unshareAll', () => library.unshareAll());
  // Face corrections (crops are made here; the page only shows them).
  const withCrops = (list) => Promise.all(list.map(async (f) => ({ ...f, crop: await library.faceCrop(f.path, f.box).catch(() => null) })));
  h('library:personFaces', (id) => withCrops(library.personFaces(id).slice(0, 80)));
  h('library:unassigned', () => withCrops(library.unassignedFaces(60)));
  h('library:setFace', (req) => library.setFace(req));
  h('library:mergePeople', ({ from, into }) => library.mergePeople(from, into));
  h('library:decoded', (res) => { decodeWaiters.get(res?.id)?.(res); decodeWaiters.delete(res?.id); return true; });
  h('faces:install', async () => {
    await faces.installFaces((p) => send('faces:download', p));
    return faces.faceStatus();
  });
  h('faces:uninstall', async () => { await faces.uninstallFaces(); return faces.faceStatus(); });
  h('faces:pickPhotos', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose clear photos of this person', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }] });
    return r.canceled ? [] : r.filePaths;
  });
  h('faces:enroll', (req) => faces.enroll(req));
  h('faces:remove', (id) => { faces.removePerson(id); return faces.faceStatus(); });
  h('faces:rename', ({ id, name }) => { faces.renamePerson(id, name); return faces.faceStatus(); });
  h('faces:setOwner', ({ id, owner }) => { faces.setOwner(id, owner); return faces.faceStatus(); });
  h('faces:frame', async (frame) => {
    const img = frameImage(frame);
    const seen = (await faces.analyzeImage(img)).map(({ print, ...f }) => f);
    return store.getSettings().faceInsightsLive === false ? seen : describeLive(img, seen);
  });
  h('insights:install', async (pack) => {
    await insights.installInsights(pack, (p) => send('insights:download', { ...p, pack }));
    return insights.insightsStatus();
  });
  h('insights:uninstall', (pack) => insights.uninstallInsights(pack));
  // Face lock. While locked only these work (see LOCK_SCREEN_CHANNELS).
  h('lock:status', () => lock.lockStatus());
  h('lock:face', async (frame) => {
    const img = frameImage(frame);
    const seen = await faces.analyzeImage(img);
    let owner = seen.find((f) => f.person?.owner && f.person.similarity >= faces.UNLOCK);
    // Liveness (from DeepFace): a printed photo or a screen of the owner doesn't unlock.
    let fake = false;
    if (owner && store.getSettings().lockLiveness !== false && insights.insightsStatus().insights.installed) {
      const live = await insights.liveness(img, owner.box);
      if (!live || !live.real || live.score < LIVE_TO_UNLOCK) { fake = true; owner = null; }
    }
    lockStreak = owner ? lockStreak + 1 : 0;
    if (lockStreak >= 2) { lock.unlock(); lockStreak = 0; }
    return { unlocked: !lock.isLocked(), fake, faces: seen.map((f) => ({ box: f.box, known: Boolean(f.person?.owner) })) };
  });
  h('lock:pin', (pin) => { if (lock.checkPin(pin)) lock.unlock(); return { unlocked: !lock.isLocked() }; });
  h('lock:setPin', (pin) => { lock.setPin(pin); return lock.lockStatus(); });
  h('lock:enable', (on) => {
    if (on && !faces.listPeople().some((p) => p.owner)) throw new Error('Add yourself in People and mark yourself as the owner first.');
    lock.setEnabled(on);
    return lock.lockStatus();
  });
  h('lock:now', () => lock.lockNow());
  h('voice:install', async () => {
    await voice.installVoice((p) => send('voice:download', p));
    return voice.voiceStatus();
  });
  h('voice:warm', () => { voice.warmUp(store.getSettings().voiceLanguage); warmUp({ spoken: true }).catch(() => {}); return true; });
  h('voice:installLanguage', async (lang) => {
    await voice.installLanguageVoice(lang, (p) => send('voice:download', { ...p, lang }));
    return voice.voiceStatus();
  });
  h('voice:uninstall', async () => { await voice.uninstallVoice(); return voice.voiceStatus(); });
  h('voice:transcribe', async (pcm) => voice.transcribe(pcm, store.getSettings().voiceLanguage));
  h('voice:speak', async (text) => {
    const s = store.getSettings();
    return voice.speak(text, { voice: s.voiceName, speed: s.voiceSpeed, language: s.voiceLanguage });
  });
  // macOS asks the user once; Windows uses its own privacy setting.
  // Interact takes over the whole screen (no title bar or taskbar).
  h('window:fullscreen', (on) => {
    if (win && !win.isDestroyed() && !fullMode) win.setFullScreen(Boolean(on));
    return Boolean(win?.isFullScreen());
  });
  h('window:fullMode', (on) => setFullMode(on));
  h('window:isFullMode', () => fullMode && Boolean(win?.isFullScreen()));
  // The orb's Minimize on Windows: the window goes and the summon dot takes over.
  h('window:minimize', () => {
    if (!win || win.isDestroyed()) return false;
    if (fullMode) setFullMode(false);
    win.minimize();
    return true;
  });
  h('voice:micAccess', async () => {
    if (process.platform !== 'darwin') return true;
    if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true;
    return systemPreferences.askForMediaAccess('microphone');
  });
  h('gestures:install', async () => {
    await gestures.installGestures((p) => send('gestures:download', p));
    return gestures.gesturesStatus();
  });
  h('gestures:loaded', () => gestures.markLoaded());
  h('gestures:uninstall', () => gestures.uninstallGestures());
  // The camera is allowed only while gestures are on. macOS asks the user
  // once; Windows uses its own privacy setting.
  h('gestures:camera', (on) => useCamera('gestures', on));
  h('camera:use', ({ reason, on }) => useCamera(String(reason), on));
  async function useCamera(reason, on) {
    if (on) cameraUsers.add(reason); else cameraUsers.delete(reason);
    cameraAllowed = cameraUsers.size > 0;
    if (!on || process.platform !== 'darwin') return true;
    if (systemPreferences.getMediaAccessStatus('camera') === 'granted') return true;
    return systemPreferences.askForMediaAccess('camera');
  }
  h('settings:update', async (patch) => {
    const before = store.getSettings();
    const next = store.updateSettings(patch);
    if ((patch.glass !== undefined && patch.glass !== before.glass) || (patch.theme && patch.theme !== before.theme)) applyGlass();
    if (patch.chatModel && patch.chatModel !== before.chatModel) loadChat().catch(() => {});
    else if (((patch.contextSize && patch.contextSize !== before.contextSize) || (patch.gpuLayers !== undefined && patch.gpuLayers !== before.gpuLayers)) && engine.isChatReady()) {
      await engine.unloadChatModel();
      loadChat().catch(() => {});
    }
    ensureTrayHint(); // check-ins turned on: keep running in the tray when closed
    if ('performance' in patch || 'performanceOnBattery' in patch) applyPerf();
    if ('railAway' in patch) desktop.refreshRail();
    // The taskbar customized in Settings: the rail, its room and its pages follow.
    if ('taskbar' in patch) {
      desktop.relayout().then((changed) => { if (changed) desktop.raiseTaskbar(); }).catch((err) => console.error(err));
      desktop.refreshRail();
      sendTaskbarInset();
    }
    if (['taskbar', 'dotAt', 'stage', 'minimizeToStage', 'railAway', 'appsFull'].some((k) => k in patch)) send('settings:changed', next);
    if ('dotAt' in patch) desktop.placeDot();
    if ('appsFull' in patch || 'minimizeToStage' in patch) watchWindows();
    return next;
  });

  h('model:load', () => loadChat());
  h('model:download', async (id) => {
    const file = await models.downloadModel(id, (p) => send('model:download', p));
    const item = models.CATALOG.find((m) => m.id === id);
    const s = store.getSettings();
    if (item.kind === 'embedding' && !s.embedModel) store.updateSettings({ embedModel: file });
    if (item.kind === 'chat' && !s.chatModel) { store.updateSettings({ chatModel: file }); loadChat().catch(() => {}); }
    return file;
  });
  h('model:cancelDownload', (id) => models.cancelDownload(id));
  h('model:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Import a GGUF model', filters: [{ name: 'GGUF model', extensions: ['gguf'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return models.importModel(r.filePaths[0]);
  });
  h('model:delete', (file) => uninstall(file));
  h('model:uninstallCatalog', (id) => {
    const item = models.CATALOG.find((c) => c.id === id);
    const local = item && models.findInstalled(item, models.listLocalModels(modelEnv()));
    if (!local) throw new Error('That model is not installed');
    return uninstall(local.path);
  });
  // Reinstall = fresh copy: remove the file, then download it again.
  h('model:reinstall', async (id) => {
    const item = models.CATALOG.find((c) => c.id === id);
    const local = item && models.findInstalled(item, models.listLocalModels(modelEnv()));
    const wasChat = local && store.getSettings().chatModel === local.path;
    if (local) await uninstall(local.path, { pickNext: false });
    const file = await models.downloadModel(id, (p) => send('model:download', p));
    if (wasChat || !store.getSettings().chatModel) { store.updateSettings({ [item.kind === 'embedding' ? 'embedModel' : 'chatModel']: file }); if (item.kind === 'chat') loadChat().catch(() => {}); }
    return file;
  });

  h('workspace:choose', async (threadId) => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose the folder Scorpion may work in', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return store.getSettings();
    const w = workspaces.addWorkspace(r.filePaths[0]);
    const next = workspaces.useWorkspace(w.id);
    const t = typeof threadId === 'string' && store.getThread(threadId);
    if (t) { t.workspace = w.path; store.saveThread(t); }
    return next;
  });
  // ---- workspaces and the home screen ----
  h('workspaces:list', () => workspaces.listWorkspaces());
  h('workspaces:add', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Add a workspace folder', properties: ['openDirectory', 'createDirectory'] });
    if (!r.canceled && r.filePaths[0]) workspaces.addWorkspace(r.filePaths[0]);
    return workspaces.listWorkspaces();
  });
  h('workspaces:use', (id) => { send('settings:changed', workspaces.useWorkspace(id)); return workspaces.listWorkspaces(); });
  h('workspaces:rename', ({ id, name }) => { workspaces.renameWorkspace(id, name); return workspaces.listWorkspaces(); });
  h('workspaces:remove', (id) => { workspaces.removeWorkspace(id); send('settings:changed', store.getSettings()); return workspaces.listWorkspaces(); });
  h('workspaces:open', (id) => { const w = workspaces.findWorkspace(id); if (w) openFolder(w.path); return true; });
  h('home:get', () => ({
    workspaces: workspaces.listWorkspaces(),
    activity: recentActivity({ threads: store.listThreads(), getThread: store.getThread, schedules: scheduler.listSchedules(), dreams: dreamState(), heartbeat: persona.heartbeatState(), library: library.libraryStatus() }),
  }));
  h('workspace:open', (threadId) => { const t = typeof threadId === 'string' && store.getThread(threadId); const w = (t && t.workspace) || store.getSettings().workspace; if (w) openFolder(w); });

  // ---- Scorpion as the Windows desktop: taskbar, Apps, Files ----
  h('shell:status', desktopStatus);
  h('nav:ready', () => { navReady = true; const p = pendingNav; pendingNav = null; return p; });
  h('pc:events', (on) => { if (on) startPcEvents(); else stopPcEvents(); return true; });
  // Hand gestures inside the framed app: the real pointer, clicks, drags, the wheel (only within its panel).
  h('orb:mouse', (cmd) => (process.platform === 'win32' ? appFrame.mouse(cmd) : false));
  // Hands replacing the mouse: the real pointer over the whole (main) screen.
  h('hand:mouse', (cmd) => {
    if (process.platform !== 'win32') return false;
    const p = screen.dipToScreenRect(null, screen.getPrimaryDisplay().bounds);
    return appFrame.mouse(cmd, { area: { x: p.x, y: p.y, w: p.width, h: p.height } });
  });
  // The orb's app panel: where it is (or null), a place covering the orb, an app to show, or a strip button.
  h('orb:frame', async ({ panel, away, frame, action } = {}) => {
    if (process.platform !== 'win32') return null;
    if (panel !== undefined) await appFrame.setPanel(panel);
    if (panel && pendingFrame) { const h = pendingFrame; pendingFrame = null; await appFrame.frameWindow(h); }
    if (away !== undefined) await appFrame.setAway(Boolean(away));
    if (frame) return appFrame.frameWindow(frame);
    if (action === 'popout' && fullMode) setFullMode(false);
    if (action) {
      const self = nativeId(win);
      const windows = action === 'prev' || action === 'next' ? (await winctl.listWindows({ kept: true })).filter((w) => w.hwnd !== self && !/^Scorpion/.test(w.title)) : [];
      return appFrame.action(action, { windows });
    }
    return appFrame.framed();
  });
  h('shell:taskbar', (on) => (process.platform === 'win32' ? setTaskbarAlwaysOn(on) : desktopStatus()));
  // Only ever from the user's own button in Settings → Desktop.
  h('shell:setDesktop', async (on) => { await winctl.setUserShell(on ? shellCommand() : null); return desktopStatus(); });
  // The open windows, without Scorpion's own (its main window marked self).
  const openWindows = async () => {
    const others = BrowserWindow.getAllWindows().filter((w) => w !== win && !w.isDestroyed());
    const alive = win && !win.isDestroyed();
    // Windows lists HWNDs; Linux's list (lswt) has no X11 ids, so there
    // Scorpion's own windows are known by app id and title.
    const isOurs = (w) => /scorpion/i.test(w.appId || '');
    const titles = new Set(others.map((w) => w.getTitle()));
    const own = process.platform === 'linux' ? (w) => isOurs(w) && titles.has(w.title) : ((ids) => (w) => ids.has(w.hwnd))(new Set(others.map(nativeId)));
    const self = alive ? (process.platform === 'linux' ? win.getTitle() : nativeId(win)) : null;
    const list = (await winctl.listWindows({ kept: true })).filter((w) => !own(w));
    for (const w of list) w.self = process.platform === 'linux' ? isOurs(w) && w.title === self : w.hwnd === self;
    return list;
  };
  const shellWindows = async () => {
    const list = await openWindows();
    for (const w of list) w.icon = process.platform === 'linux' ? await winctl.iconForApp(w.appId || w.exe) : await fileIcon(w.exe);
    noteWindows(list);
    return list;
  };
  h('shell:windows', shellWindows);
  // The intent wheel: recent windows (last in front first; never-seen ones
  // after, in screen order), its intents, opening and closing it.
  h('shell:recent', async () => {
    const list = (await shellWindows()).filter((w) => !w.self);
    for (const w of list) w.at = lastUsed.get(w.hwnd) || null;
    return list.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 6);
  });
  h('shell:intent', (id) => runIntent(String(id)));
  // The command palette (Ctrl+K in Scorpion's window; typing on the wheel
  // opens it there) and the entries of src/shared/intents.js it runs here.
  h('shell:palette', (query) => { desktop.closeWheel(); showView('palette', { query: String(query || '').slice(0, 100) }); });
  h('intent:run', (id) => runNamedIntent(String(id)));
  h('shell:intents', () => {
    const t = taskbarSettings();
    return Object.fromEntries(Object.keys(INTENT_LABEL).map((k) => [k, t.intents[k]?.name || INTENT_APPS[k]?.name || INTENT_BUILTIN[k]]));
  });
  h('shell:wheel', ({ open, centre } = {}) => (open ? desktop.openWheel(centre ? screen.getCursorScreenPoint() : null) : desktop.closeWheel()));
  // The edge rail's glance items: notifications, Wi-Fi, battery, mail.
  const RAIL_LINKS = { notifications: 'ms-actioncenter:', network: 'ms-availablenetworks:', battery: 'ms-settings:batterysaver' };
  h('shell:glance', (what) => {
    if (what === 'mail') return openDefault('mailto', process.platform === 'linux' ? 'mailto:' : 'outlookmail:');
    if (what === 'chat') return showView('chat');
    // Scorpion OS: the session's notification history (mako) and settings tools.
    if (process.platform === 'linux') {
      if (what === 'notifications') return winctl.showNotifications();
      return winctl.openSettings(what === 'battery' ? 'power' : 'network');
    }
    if (!RAIL_LINKS[what]) throw new Error('Unknown item');
    return shell.openExternal(RAIL_LINKS[what]);
  });
  h('shell:window', ({ hwnd, action }) => winctl.windowByHandle(String(hwnd), action));
  // Stage: on or off (the wheel, Settings, the palette), and a window picked
  // from its strip comes forward while the one in front steps aside.
  h('shell:stage', (on) => setStage(on));
  // The summon dot dragged (each move, then where it's dropped, which is
  // kept), asked where it is, or put back in its corner.
  h('shell:dot', (arg = {}) => {
    if (arg.phase === 'reset') { store.updateSettings({ dotAt: null }); desktop.placeDot(); send('settings:changed', store.getSettings()); return desktop.dragDot({ phase: 'get' }); }
    const r = desktop.dragDot(arg);
    if (arg.phase === 'end' && r?.at) send('settings:changed', store.updateSettings({ dotAt: r.at }));
    return r;
  });
  // Apps fill the screen when they open, and a minimized one flies into
  // Stage (Settings → Windows and taskbar): a look at the windows every
  // moment while either is on.
  let lastLook = null;
  let looking = false;
  let lookTimer = 0;
  const lookAtWindows = async () => {
    if (looking) return;
    looking = true;
    try {
      const s = store.getSettings();
      const list = await openWindows();
      const { opened, minimized } = windowChanges(lastLook, list);
      lastLook = list;
      if (s.appsFull !== false) for (const w of opened) if (shouldFill(w, list)) winctl.windowByHandle(w.hwnd, 'maximize').catch(() => {});
      if (minimized.length) console.log('windows minimized:', minimized.map((w) => w.title).join(', '), 'stage', s.stage, s.minimizeToStage);
      if (s.minimizeToStage !== false && s.stage) { const w = minimized.find((x) => !x.self); if (w) desktop.stageArrive(w.hwnd); }
    } catch (err) { console.error('window look:', err.message); } finally { looking = false; }
  };
  watchWindows = () => {
    const s = store.getSettings();
    const on = (s.appsFull !== false || (s.minimizeToStage !== false && s.stage)) && (process.platform === 'win32' || desktop.hostActive());
    clearInterval(lookTimer);
    lookTimer = 0;
    lastLook = null;
    if (on) lookTimer = setInterval(lookAtWindows, { light: 2000, balanced: 1200 }[currentPerf()] || 800);
  };
  h('shell:stagePick', async (hwnd) => {
    desktop.hideStage();
    const front = (await shellWindows()).find((w) => w.active && !w.self && w.hwnd !== String(hwnd));
    await winctl.windowByHandle(String(hwnd), 'focus');
    if (front) await winctl.windowByHandle(front.hwnd, 'minimize').catch(() => {});
    return true;
  });
  // live: running from the ISO or a USB stick (the rail then offers Install).
  h('shell:tray', async () => ({ ...(await desktop.trayStatus()), live: process.platform === 'linux' && winctl.isLiveSession() }));
  h('shell:install', () => winctl.startInstaller());
  // Scorpion OS's quick settings (quick.html, from the rail's network,
  // battery and volume): one change, then everything as it is now.
  h('shell:quick', async ({ action, value, wifiScan, btScan } = {}) => {
    if (process.platform !== 'linux') return { supported: false };
    let result = null, error = null;
    if (action) { try { result = await winctl.quickAction(String(action), value || {}); } catch (err) { error = err.message; } }
    return { ...(await winctl.quickState({ wifiScan: Boolean(wifiScan), btScan: Boolean(btScan) })), result, error };
  });
  h('shell:show', (view) => { showView(view || 'home'); return true; });
  // The keyboard's volume keys (each step is 2%).
  h('shell:volume', async (action) => { const r = await winctl.volumeStep(action); showOsd('volume'); return r; });
  // The welcome's internet step (Scorpion OS): online or not, the Wi-Fi
  // networks in range, joining one. Windows and macOS handle their own.
  // Scorpion OS: its updates and snapshots (Settings → This computer).
  h('sys:updates', ({ action } = {}) => {
    if (!updates) return { supported: false };
    if (action === 'check') return updates.check();
    if (action === 'install') { updates.install(); return updates.view(); } // progress comes as sys:updates events
    return updates.view();
  });
  // Scorpion OS: Apps → Get more apps (Flathub).
  h('sys:apps', async ({ action, query, id } = {}) => {
    if (process.platform !== 'linux') return { supported: false, results: [] };
    const live = winctl.isLiveSession();
    if (action === 'install') {
      // The live system keeps everything in memory: an app (and its runtime)
      // would crowd out the AI model, and be gone at the next restart.
      if (live) throw new Error('Apps added now would live in memory and be gone at the next restart. Install Scorpion OS first (the Install button on the right), then add apps.');
      await winctl.installApp({ source: 'flathub', id: String(id) });
      return { supported: true, installed: id };
    }
    // Opening Apps fetches Flathub's catalog in the background, so the first search is quick.
    if (action === 'prepare') { winctl.prepareCatalog().catch(() => {}); return { supported: true, live }; }
    if (action === 'remove') { await winctl.removeApp({ source: 'flathub', id: String(id) }); return { supported: true, removed: id }; }
    return { supported: true, live, results: await winctl.flathubSearch(query) };
  });
  // Accessibility (the welcome, Settings → General): bigger text, a screen
  // reader, an on-screen keyboard. Remembered in settings.access.
  h('sys:access', async ({ feature, on } = {}) => {
    if (!ACCESS_FEATURES.includes(feature)) throw new Error('Unknown accessibility feature');
    const access = { ...accessSettings(), [feature]: Boolean(on) };
    store.updateSettings({ access });
    await applyAccess(access, [feature]);
    send('settings:changed', store.getSettings());
    return access;
  });
  h('sys:snapshots', async ({ action, id } = {}) => {
    if (process.platform !== 'linux' || !winctl.snapshotsAvailable()) return { supported: false, list: [] };
    if (action === 'undo') {
      const message = await winctl.undoSnapshot(String(id));
      return { supported: true, list: await winctl.snapshotList().catch(() => []), message };
    }
    if (action === 'restart') return winctl.powerNow('restart');
    return { supported: true, list: await winctl.snapshotList() };
  });
  h('sys:wifi', async ({ action, ssid, password } = {}) => {
    if (process.platform !== 'linux') return action === 'status' ? { supported: false } : [];
    if (action === 'status') return { supported: true, online: Boolean((await winctl.trayStatus().catch(() => ({}))).network) };
    if (action === 'list') return winctl.wifiList();
    if (action === 'connect') return winctl.wifiConnect(ssid, password);
    throw new Error('Unknown Wi-Fi action');
  });
  h('shell:power', powerAction);
  // Menus open as native menus so they can reach above the thin taskbar.
  async function shellMenuTemplate({ kind, hwnd, title, id, name, exe } = {}, owner = null) {
    const item = (label, click) => ({ label, click: () => Promise.resolve(click()).catch((err) => console.error(err)) });
    let template;
    if (kind === 'window') {
      const pinnedAlready = exe && taskbarSettings().pinned.some((p) => p.id.toLowerCase() === String(exe).toLowerCase());
      template = [{ label: title || 'Window', enabled: false }, { type: 'separator' },
        item('Switch to', () => winctl.windowByHandle(String(hwnd), 'focus')),
        item('Minimize', () => winctl.windowByHandle(String(hwnd), 'minimize')),
        item('Close window', () => winctl.windowByHandle(String(hwnd), 'close')),
        ...(exe ? [item(pinnedAlready ? 'Unpin from taskbar' : 'Pin to taskbar', async () => setPinned({ id: exe, name: await programName(exe), on: !pinnedAlready }))] : []),
        { type: 'separator' },
        // Force-quit, for an app that no longer responds (unsaved work is lost).
        item('End task', () => winctl.endTask(String(hwnd), { ownPids: app.getAppMetrics().map((m) => m.pid) })
          .catch((err) => dialog.showMessageBox(owner, { type: 'info', message: 'End task', detail: err.message })))];
    } else if (kind === 'pinned') {
      template = [{ label: name || 'App', enabled: false }, { type: 'separator' },
        item('Open', () => winctl.launchApp({ id, name }, { viaExplorer: desktop.shellMode() !== 'shell' })),
        item('Unpin from taskbar', () => setPinned({ id, name, on: false }))];
    } else if (kind === 'intent') {
      // An intent on the wheel: what it opens.
      const t = taskbarSettings();
      const setIntent = (a) => setTaskbarLook({ ...t, intents: { ...t.intents, [id]: a || undefined } });
      const current = t.intents[id];
      template = [{ label: `${INTENT_LABEL[id] || 'Intent'} opens`, enabled: false }, { type: 'separator' },
        { label: INTENT_APPS[id]?.name || INTENT_BUILTIN[id] || 'Default', type: 'radio', checked: !current, click: () => setIntent(null) },
        ...t.pinned.map((p) => ({ label: p.name, type: 'radio', checked: current?.id === p.id, click: () => setIntent({ id: p.id, name: p.name }) })),
        ...(current && !t.pinned.some((p) => p.id === current.id) ? [{ label: current.name, type: 'radio', checked: true }] : []),
        { type: 'separator' },
        item('Choose a program…', async () => {
          desktop.holdWheel(true);
          const r = await dialog.showOpenDialog(owner, { title: `What ${INTENT_LABEL[id] || 'this'} opens`, properties: ['openFile'], filters: [{ name: 'Programs', extensions: ['exe', 'lnk'] }] }).finally(() => desktop.holdWheel(false));
          if (!r.canceled && r.filePaths[0]) setIntent({ id: r.filePaths[0], name: r.filePaths[0].toLowerCase().endsWith('.exe') ? await programName(r.filePaths[0]) : path.basename(r.filePaths[0], '.lnk') });
        })];
    } else if (kind === 'bar') {
      // Customizing the taskbar (right-click on an empty part of it).
      const t = taskbarSettings();
      const set = (patch) => setTaskbarLook({ ...t, ...patch });
      const show = (k) => ({ label: { network: 'Network', battery: 'Battery', volume: 'Volume', clock: 'Clock', notifications: 'Notifications', mail: 'Mail', chat: 'Chat with Scorpion' }[k], type: 'checkbox', checked: t.show[k] !== false, click: () => set({ show: { ...t.show, [k]: t.show[k] === false } }) });
      const autoHide = { label: 'Hide automatically', type: 'checkbox', checked: t.autoHide === true, click: () => set({ autoHide: t.autoHide !== true }) };
      const layoutMenu = { label: 'Layout', submenu: [['orbit', 'Edge rail with the intent wheel'], ['bar', 'Bar along the bottom']].map(([v, l]) => ({ label: l, type: 'radio', checked: t.layout === v, click: () => set({ layout: v }) })) };
      if (t.layout !== 'bar') {
        template = [{ label: 'Taskbar', enabled: false }, { type: 'separator' }, layoutMenu, autoHide,
          { label: 'Show', submenu: ['clock', 'network', 'battery', 'notifications', 'mail', 'chat', 'volume'].map(show) },
          { type: 'separator' },
          item('Add or remove apps…', () => showView('apps')),
          item('Customize…', () => showView('settings', { section: 'layout' })),
          ...(t.pinned.length ? [item('Unpin all apps', () => setTaskbarLook({ ...t, pinned: [] }))] : [])];
      } else template = [{ label: 'Taskbar', enabled: false }, { type: 'separator' }, layoutMenu, autoHide,
        { label: 'Show app names', type: 'checkbox', checked: t.labels, click: () => set({ labels: !t.labels }) },
        { label: 'Center the apps', type: 'checkbox', checked: t.center, click: () => set({ center: !t.center }) },
        { label: 'Size', submenu: ['small', 'normal', 'large'].map((v) => ({ label: v[0].toUpperCase() + v.slice(1), type: 'radio', checked: t.size === v, click: () => set({ size: v }) })) },
        { label: 'Look', submenu: [['holo', 'Holographic'], ['neon', 'Neon'], ['glass', 'Glass'], ['solid', 'Solid']].map(([v, l]) => ({ label: l, type: 'radio', checked: t.style === v, click: () => set({ style: v }) })) },
        { label: 'Show', submenu: ['network', 'battery', 'volume', 'clock'].map(show) },
        { type: 'separator' },
        item('Add or remove apps…', () => showView('apps')),
        item('Customize…', () => showView('settings', { section: 'layout' })),
        ...(t.pinned.length ? [item('Unpin all apps', () => setTaskbarLook({ ...t, pinned: [] }))] : [])];
    } else if (kind === 'clock') {
      template = [{ label: new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), enabled: false }, { type: 'separator' },
        item('Date and time settings', () => winctl.openSettings('time'))];
    } else {
      const m = desktop.shellMode();
      template = [item('Lock', () => powerAction('lock')), item('Sleep', () => powerAction('sleep')),
        item('Sign out', () => powerAction('signout')), item('Restart', () => powerAction('restart')), item('Shut down', () => powerAction('shutdown')),
        { type: 'separator' },
        m === 'bar' ? item('Back to the Windows taskbar', () => setTaskbarAlwaysOn(false))
          : item('Switch to the Windows desktop', () => powerAction('explorer'))];
    }
    return template;
  }
  ipcMain.handle('shell:menu', async (e, arg) => {
    const owner = BrowserWindow.fromWebContents(e.sender);
    const template = await shellMenuTemplate(arg, owner);
    // The wheel stays open while its menu is up.
    desktop.holdWheel(true);
    desktop.holdRail(true); // a hiding taskbar stays while its menu is up
    Menu.buildFromTemplate(template).popup({ window: owner, callback: () => { desktop.holdWheel(false); desktop.holdRail(false); } });
    return true;
  });
  // The native shell host shows menus itself: the menu as data, and what
  // each choice does kept here until it is picked (or for two minutes).
  const hostMenus = new Map();
  handlers['shell:menu'] = async (arg) => {
    const clicks = new Map();
    const describe = (items) => items.map((it, i) => {
      if (it.type === 'separator') return { type: 'separator' };
      const id = `${clicks.size}-${i}`;
      if (it.click) clicks.set(id, it.click);
      return { id, label: it.label, type: it.type || 'normal', enabled: it.enabled !== false, checked: Boolean(it.checked), ...(it.submenu ? { submenu: describe(it.submenu) } : {}) };
    });
    const items = describe(await shellMenuTemplate(arg));
    const token = crypto.randomBytes(8).toString('hex');
    hostMenus.set(token, clicks);
    setTimeout(() => hostMenus.delete(token), 120_000);
    return { token, items };
  };
  h('shell:menuPick', ({ token, id } = {}) => {
    const fn = hostMenus.get(token)?.get(id);
    hostMenus.delete(token);
    return fn ? Promise.resolve(fn()).then(() => true) : false;
  });

  // Notifications (the native shell host is the session's notification
  // server): the last 50, for the rail's bell and its list.
  h('shell:notifyIn', (n = {}) => {
    const note = { id: Number(n.id) || Date.now(), app: String(n.app || ''), summary: String(n.summary || '').slice(0, 300), body: String(n.body || '').slice(0, 2000), icon: n.icon || null, urgency: Number(n.urgency ?? 1), actions: Array.isArray(n.actions) ? n.actions.slice(0, 6) : [], at: Date.now(), read: false };
    notifications = [note, ...notifications.filter((x) => x.id !== note.id)].slice(0, 50);
    send('shell:notify', note);
    send('shell:notifications', notificationSummary());
    return true;
  });
  h('shell:notifyClosed', ({ id } = {}) => { notifications = notifications.filter((x) => x.id !== Number(id)); send('shell:notifications', notificationSummary()); return true; });
  h('shell:notifications', () => ({ ...notificationSummary(), list: notifications }));
  h('shell:notificationAct', ({ action, id } = {}) => {
    if (action === 'clear') notifications = [];
    else if (action === 'dismiss') notifications = notifications.filter((x) => x.id !== Number(id));
    else if (action === 'read') notifications = notifications.map((x) => ({ ...x, read: true }));
    send('shell:notifications', notificationSummary());
    return true;
  });
  // The native shell host is up: its panels replace Scorpion's own rail and dot.
  h('shell:hostReady', () => { desktop.useHost(true); sendTaskbarInset(); watchWindows(); return true; });
  h('shell:appIcons', (fresh) => (process.platform === 'linux' ? winctl.appIcons() : appIcons.appIcons({ fresh: Boolean(fresh) })));
  // The constellation launcher (constellations.js).
  h('const:get', () => constellations.load(taskbarSettings().pinned));
  h('const:save', (data) => constellations.save(data));
  h('const:open', (node) => constellations.open(node));
  h('const:export', (data) => constellations.exportTo(data));
  h('const:import', (data) => constellations.importFrom(data));
  h('const:pick', (kind) => constellations.pick(kind));
  h('const:recent', () => constellations.recent());
  h('const:pathInfo', (p) => constellations.pathInfo(String(p)));
  h('const:icon', (p) => constellations.iconFor(String(p)));
  h('const:preview', (what) => constellations.preview(what || {}));
  h('const:shortcut', (accel) => registerSummon(accel));
  h('shell:pin', ({ id, name, on }) => setPinned({ id, name, on }));
  // The pinned apps with their icons, for the taskbar.
  h('shell:pinned', async () => {
    const known = process.platform === 'linux' ? await winctl.appIcons() : await appIcons.appIcons();
    return Promise.all(taskbarSettings().pinned.map(async (p) => ({ ...p, icon: known[p.id] || (/^[a-z]:\\/i.test(p.id) ? await fileIcon(p.id) : null) })));
  });
  h('shell:apps', async (fresh) => (await winctl.listApps({ fresh: Boolean(fresh) })).map((a) => ({ id: a.id, name: a.name })));
  h('shell:launch', async ({ id, name }) => winctl.launchApp({ id, name }, { viaExplorer: desktop.shellMode() !== 'shell' }));
  h('files:list', (dir) => listFolder(dir));
  h('files:open', (p) => winctl.openPath(p));
  h('files:newFolder', ({ dir, name }) => { const p = path.join(dir, String(name || 'New folder').replace(/[\\/:*?"<>|]/g, '').trim() || 'New folder'); if (fs.existsSync(p)) throw new Error(`${path.basename(p)} already exists`); fs.mkdirSync(p); return p; });
  h('files:rename', ({ from, name }) => {
    const clean = String(name || '').replace(/[\\/:*?"<>|]/g, '').trim();
    if (!clean) throw new Error('Type a name');
    const to = path.join(path.dirname(from), clean);
    if (fs.existsSync(to)) throw new Error(`${clean} already exists`);
    fs.renameSync(from, to);
    return to;
  });
  h('files:paste', ({ items, dir, move }) => {
    const done = [];
    for (const from of items || []) {
      if (move) {
        const to = path.join(dir, path.basename(from));
        if (fs.existsSync(to)) throw new Error(`${path.basename(from)} already exists here`);
        try { fs.renameSync(from, to); } catch { winctl.copyPath(from, to); fs.rmSync(from, { recursive: true }); }
        done.push(to);
      } else done.push(winctl.copyPath(from, dir));
    }
    return done;
  });
  h('files:recycle', async (items) => { for (const p of items || []) await winctl.recyclePath(p); return true; });

  h('thread:create', (opts) => {
    const { agentId, mode } = typeof opts === 'string' ? { agentId: opts } : opts || {};
    const t = store.createThread();
    if (agentId) t.agentId = agents.getAgent(agentId).id;
    if (['chat', 'plan', 'build'].includes(mode)) { t.mode = mode; if (mode !== store.getSettings().lastChatMode) store.updateSettings({ lastChatMode: mode }); }
    // The chat starts in the given workspace (which becomes the active one), or the active one.
    const wsId = typeof opts === 'object' && opts ? opts.workspaceId : null;
    if (wsId) send('settings:changed', workspaces.useWorkspace(wsId));
    t.workspace = store.getSettings().workspace || null;
    store.saveThread(t);
    return t;
  });
  h('thread:setAgent', ({ id, agentId }) => {
    const t = store.getThread(id);
    if (!t) throw new Error('Chat not found');
    t.agentId = agents.getAgent(agentId).id;
    store.saveThread(t);
    return t;
  });

  h('thread:setMode', ({ id, mode }) => {
    const t = store.getThread(id);
    if (!t) throw new Error('Chat not found');
    if (!['chat', 'plan', 'build'].includes(mode)) throw new Error('Unknown mode');
    t.mode = mode;
    store.saveThread(t);
    return t;
  });

  h('agents:save', (input) => agents.saveAgent(input));
  h('agents:delete', (id) => agents.deleteAgent(id));

  h('schedules:list', () => scheduleView());
  h('schedules:save', (input) => { const s = scheduler.saveSchedule(input); if (s.enabled) ensureTrayHint(); return s; });
  h('schedules:delete', (id) => scheduler.deleteSchedule(id));
  h('schedules:run', (id) => { scheduler.runNow(id).catch(() => {}); });
  h('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  h('app:setLoginStart', (mode) => setLoginStart(['tray', 'orb'].includes(mode) ? mode : 'off'));
  h('thread:get', (id) => store.getThread(id));
  h('thread:delete', (id) => { running.get(id)?.abort(); store.deleteThread(id); memory.invalidateRecall(); });
  h('thread:rename', ({ id, title }) => { const t = store.getThread(id); if (t) { t.title = String(title).slice(0, 80); store.saveThread(t); } });

  h('chat:send', chatSend);
  h('chat:stop', (threadId) => running.get(threadId)?.abort());
  h('chat:approve', ({ id, approved }) => { approvals.get(id)?.(approved === 'always' ? 'always' : Boolean(approved)); approvals.delete(id); });

  h('docs:add', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Add documents',
      filters: [{ name: 'Documents', extensions: rag.SUPPORTED_EXTENSIONS }],
      properties: ['openFile', 'multiSelections'],
    });
    if (r.canceled) return { added: [], errors: [] };
    const settings = store.getSettings();
    const added = [];
    const errors = [];
    for (const file of r.filePaths) {
      try { added.push(await rag.addDocument(file, settings, (p) => send('docs:progress', p))); } catch (err) { errors.push(`${path.basename(file)}: ${err.message}`); }
    }
    send('docs:progress', null);
    return { added, errors };
  });
  h('docs:remove', (id) => rag.removeDocument(id));

  h('memory:list', () => memory.listMemories());
  h('memory:add', (text) => memory.addMemory(text, 'user').memory);
  h('memory:update', ({ id, text }) => memory.updateMemory(id, text));
  h('memory:delete', (id) => memory.deleteMemory(id));
  h('memory:clear', () => memory.clearMemories());
}

// The UI may use the microphone (for voice chat), and the camera only while
// a feature you turned on needs it (hand gestures, faces, face lock). Nothing else: no screen, location or
// notifications from the page.
let cameraAllowed = false;
const cameraUsers = new Set(); // gestures, faces, enroll, lock
function allowMicAndGestureCamera() {
  const isOwnPage = (url) => String(url || '').startsWith('scorpion://');
  const allowedType = (t) => t === 'audio' || (t === 'video' && cameraAllowed);
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(isOwnPage(details?.requestingUrl ?? wc.getURL()) && permission === 'media'
      && (details?.mediaTypes ?? ['audio']).every(allowedType));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin, details) => {
    return isOwnPage(origin) && permission === 'media' && allowedType(details?.mediaType ?? 'audio');
  });
}

// Starting minimized at login only makes sense if something is scheduled.
function ensureTrayHint() {
  if (keepsRunning()) ensureTray();
}

app.whenReady().then(async () => {
  if (!primary) return;
  store.initStore(app.getPath('userData'));
  desktop.initShell({ BrowserWindow, screen, preload: path.join(__dirname, '..', 'preload.cjs'), dataDir: app.getPath('userData'), getMainWindow: () => win, showView, getLayout: () => taskbarSettings().layout, perf: currentPerf, snapScreen,
    dotAt: () => store.getSettings().dotAt || null, autoHide: () => taskbarSettings().autoHide === true, railAway: () => store.getSettings().railAway !== false });
  // Performance follows the power cable when "Light on battery" is on.
  applyPerf();
  powerMonitor.on('on-battery', applyPerf);
  powerMonitor.on('on-ac', applyPerf);
  winctl.setFolderOpener((dir, select) => { showView('files', { dir, select }); return dir; });
  // Apps inside the orb (orb-frame.js): the panel is given in CSS pixels of
  // Scorpion's window; Windows wants physical screen pixels.
  appIcons.initAppIcons({ app, nativeImage, dataDir: app.getPath('userData') });
  constellations.initConstellations({
    app, shell, nativeImage, desktopCapturer, dialog, dataDir: app.getPath('userData'), getWindow: () => win,
    launchApp: (a) => winctl.launchApp(a, { viaExplorer: desktop.shellMode() !== 'shell' }),
  });
  registerSummon();
  registerWheelKey();
  if (process.platform === 'win32' && store.getSettings().stage) desktop.setStage(true);
  watchWindows();
  appFrame.initFrame({
    dataDir: app.getPath('userData'),
    panelToScreen: (r) => {
      const b = win.getContentBounds();
      const p = screen.dipToScreenRect(win, { x: Math.round(b.x + r.x), y: Math.round(b.y + r.y), width: Math.round(r.width), height: Math.round(r.height) });
      return { x: p.x, y: p.y, w: p.width, h: p.height };
    },
    notify: (v) => send('frame:changed', v),
  });
  if (process.platform === 'win32') appFrame.recover().catch(() => {});
  // Three starts as the desktop within three minutes means Scorpion keeps
  // failing: bring up the Windows desktop instead, so the PC stays usable.
  const asDesktop = shellLaunch && !desktop.recordShellStart();
  if (shellLaunch && !asDesktop) winctl.startExplorer().catch(() => {});
  if (asDesktop) process.on('uncaughtException', (err) => { console.error(err); winctl.explorerRunning().then((on) => on || winctl.startExplorer()).catch(() => {}); });
  if (!asDesktop) await desktop.recoverWorkArea().catch(() => {});
  secrets.initSecrets(safeStorage);
  voice.initVoice(store.paths.models);
  faces.initFaces(store.paths.models, app.getPath('userData'));
  insights.initFaceInsights(store.paths.models);
  initMediaModels(store.paths.models);
  library.initLibrary(app.getPath('userData'), {
    decode: decodeInWindow,
    busy: () => running.size > 0, // the scan waits while Scorpion is answering
    onStatus: (s) => send('library:status', s),
    onLowCpu: (on) => { libraryLowCpu = on; applyLowCpu(); },
  });
  library.watchFolders(true); // new, changed and deleted files are picked up live
  lock.initLock(app.getPath('userData'));
  skills.initSkills(path.join(APP_ROOT, 'src', 'skills'), app.getPath('userData'));
  persona.initPersona(app.getPath('userData'));
  setInterval(() => runHeartbeat().catch(() => {}), 60_000); // check-ins, when due
  setInterval(() => runDream().catch(() => {}), 10 * 60_000); // dreaming, once a day when idle
  gestures.initGestures(store.paths.models);
  allowMicAndGestureCamera();
  await autoSelectModels();
  serveApp();
  registerIpc();
  // Scorpion OS's session: the local connection for the native shell host,
  // once every handler it may call is registered.
  if (process.platform === 'linux' && process.env.XDG_SESSION_DESKTOP === 'scorpion') {
    startShellApi({ handlers, roots: [path.join(__dirname, '..', 'renderer'), path.join(__dirname, '..', 'shared')], gone: () => { desktop.useHost(false); sendTaskbarInset(); } }).catch((err) => console.error('shell API:', err));
  }
  createWindow();
  if (asDesktop) await desktop.startShell('shell').catch((err) => { console.error(err); return winctl.startExplorer(); });
  else if (process.platform === 'win32' && store.getSettings().taskbarAlwaysOn !== false) desktop.startShell('bar').then(() => { desktop.raiseTaskbar(); sendTaskbarInset(); }).catch((err) => console.error(err));
  scheduler.startScheduler(runScheduled);
  // Accessibility from last time: Scorpion's zoom everywhere; on Scorpion OS
  // also the screen reader and keyboard (Windows starts its own).
  win.webContents.once('did-finish-load', () => applyAccess(accessSettings(), process.platform === 'linux' ? ACCESS_FEATURES : ['bigText']).catch((err) => console.error('accessibility:', err.message)));
  if (process.platform === 'linux') {
    updates = createUpdates({ sys: winctl, send, getSettings: store.getSettings, updateSettings: store.updateSettings, onInstallAsked: () => showView('settings', { section: 'system' }) });
    updates.start();
  }
  for (const server of store.getSettings().mcpServers || []) if (server.enabled) connectMcp(server).catch(() => {});
  startTelegram().catch(() => {});
  // Pick up new and changed files a little after start-up.
  setTimeout(() => { if (library.libraryStatus().folders.length) library.scan().catch(() => {}); }, 20000);
  ensureTrayHint();
  if (startHidden && !keepsRunning()) showWindow();
  // Full mode from the start (once the window is on screen, so nothing flashes).
  if (!startHidden && store.getSettings().fullModeAtStart !== false && !accessSettings().keyboard) { if (win.isVisible()) setFullMode(true); else win.once('show', () => setFullMode(true)); }
  // Signed in with "Open the orb": Scorpion fills the screen with the orb.
  if (startOrb && !asDesktop) { win.maximize(); showView('orb', { signin: true }); }
  app.on('activate', showWindow);
});

// Starting Scorpion again brings it forward; a few words in the command line
// are commands from the system (Scorpion OS's session keys, labwc rc.xml):
// --wheel opens the intent wheel where the pointer is, --orb the orb with
// search ready, --exit-full leaves full mode.
app.on('second-instance', (e, argv) => {
  if (argv.includes('--wheel')) { desktop.openWheel(screen.getCursorScreenPoint()); return; }
  if (argv.includes('--exit-full')) { setFullMode(false); return; }
  // --osd volume|brightness: the session's keys changed a level; show it.
  if (argv.includes('--osd')) { showOsd(argv[argv.indexOf('--osd') + 1] || 'volume'); return; }
  showWindow();
  if (argv.includes('--orb')) { if (navReady) send('nav:view', { view: 'orb', search: true }); else pendingNav = { view: 'orb', search: true }; }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !keepsRunning() && !desktop.shellMode()) app.quit(); });
app.on('will-quit', () => { stopKeyWatch(); globalShortcut.unregisterAll(); });
app.on('before-quit', (e) => {
  // Leaving the desktop: put the screen area back (and the Windows desktop,
  // when Scorpion was it) before quitting.
  if (appFrame.framed()) { e.preventDefault(); appFrame.setPanel(null).finally(() => app.quit()); return; }
  leaving = true;
  desktop.setFloatingDot(false);
  desktop.setStage(false);
  if (desktop.shellMode()) { e.preventDefault(); for (const w of BrowserWindow.getAllWindows()) w.hide(); desktop.stopShell().finally(() => app.quit()); return; }
  winctl.stopPsKept();
  quitting = true; scheduler.stopScheduler(); for (const m of mcp.allStatus()) mcp.disconnect(m.id); tg?.stop(); for (const c of running.values()) c.abort(); engine.shutdown(); });
