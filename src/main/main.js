import { app, BrowserWindow, screen, ipcMain, dialog, protocol, net, shell, Notification, Tray, Menu, nativeImage, session, systemPreferences, powerMonitor, safeStorage } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as store from './store.js';
import * as models from './models.js';
import * as engine from './engine.js';
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
import * as winctl from './windows-control.js';
import { createAgentBrowser, browserTools } from './agent-browser.js';
import { TelegramBot, pairingCode } from './telegram.js';
import { TOOLS, fileSystemRoots } from './tools.js';
import { applyEvent } from '../shared/events.js';
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

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let tray = null;
let quitting = false;
const startHidden = process.argv.includes('--hidden');
// Started by Windows at sign-in as this account's desktop (Settings → Desktop).
const shellLaunch = process.argv.includes('--shell') && process.platform === 'win32';
const running = new Map(); // threadId -> AbortController
const approvals = new Map(); // approval id -> resolve(boolean)

function send(channel, payload) {
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
  win.loadURL('scorpion://app/index.html');
  if (!startHidden || process.env.SCORPION_SCREENSHOT) win.once('ready-to-show', () => win.show());

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

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Brings Scorpion forward on one of its screens (the taskbar's buttons, folders
// opened while Scorpion is the desktop).
function showView(view, detail) {
  showWindow();
  const go = () => send('nav:view', { view, ...detail });
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(go, 300)); else go();
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
    openAtLogin: app.getLoginItemSettings().openAtLogin,
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

async function loadChat() {
  const s = store.getSettings();
  if (!s.chatModel) return engine.engineInfo();
  const entry = models.listLocalModels(modelEnv()).find((m) => m.path === s.chatModel);
  const display = entry?.name || path.basename(s.chatModel);
  const bytes = entry?.bytes ?? 0;
  // The UI shows a "Please wait" window from these events until loading ends.
  send('model:status', { loading: true, name: display, bytes });
  try {
    const info = await engine.loadChatModel(s.chatModel, {
      contextSize: s.contextSize,
      gpuLayers: s.gpuLayers,
      name: entry?.name,
      onProgress: (p) => send('model:status', { loading: true, progress: p, name: display, bytes }),
    });
    send('model:status', { loading: false, info });
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
  windowsReady: process.platform === 'win32', // the agent can run Windows (apps, windows, files, Settings)
  extraTools: extraTools(),
});

// A fast model for spoken turns. "auto": when the chat model is slow on this
// computer (a big one on the processor), talk with the best installed model
// that runs fast here; null means "use the chat model".
async function voiceModelPath() {
  const s = store.getSettings();
  if (s.voiceModel === 'same') return null;
  const local = models.listLocalModels(modelEnv()).filter((m) => m.kind === 'chat');
  if (s.voiceModel && s.voiceModel !== 'auto') return s.voiceModel !== s.chatModel && local.some((m) => m.path === s.voiceModel) ? s.voiceModel : null;
  const hw = await engine.hardwareInfo().catch(() => null);
  const main = local.find((m) => m.path === s.chatModel);
  if (!main || engine.modelFit(main.bytes, hw) === 'fast') return null;
  const fast = local.filter((m) => m.path !== s.chatModel && engine.modelFit(m.bytes, hw) === 'fast')
    .sort((a, b) => models.catalogRank(a) - models.catalogRank(b));
  return fast[0]?.path ?? null;
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
  else if (!source.remote && !engine.isChatReady()) await loadChat();

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
    } else if (Notification.isSupported()) {
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
  if (action === 'restart' || action === 'shutdown') return winctl.runPs(`shutdown.exe ${action === 'restart' ? '/r' : '/s'} /t 0`);
  if (action === 'explorer') { await desktop.stopShell(); return winctl.explorerRunning().then((on) => on || winctl.startExplorer()); }
  if (action === 'end-preview') return desktop.stopShell();
  throw new Error('Unknown power action');
}

function registerIpc() {
  const h = (channel, fn) => ipcMain.handle(channel, (_e, arg) => {
    if (lock.isLocked() && !LOCK_SCREEN_CHANNELS.has(channel)) throw new Error('Scorpion is locked');
    return fn(arg);
  });

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
    if (win && !win.isDestroyed()) win.setFullScreen(Boolean(on));
    return Boolean(win?.isFullScreen());
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
  h('shell:preview', async (on) => { if (on) await desktop.startShell('preview'); else if (desktop.shellMode() === 'preview') await desktop.stopShell(); return desktopStatus(); });
  // Only ever from the user's own button in Settings → Desktop.
  h('shell:setDesktop', async (on) => { await winctl.setUserShell(on ? shellCommand() : null); return desktopStatus(); });
  h('shell:windows', async () => {
    const own = new Set(BrowserWindow.getAllWindows().filter((w) => w !== win).map((w) => w.getNativeWindowHandle().readBigInt64LE().toString()));
    const list = (await winctl.listWindows({ kept: true })).filter((w) => !own.has(w.hwnd));
    for (const w of list) w.icon = await fileIcon(w.exe);
    return list;
  });
  h('shell:window', ({ hwnd, action }) => winctl.windowByHandle(String(hwnd), action));
  h('shell:tray', () => desktop.trayStatus());
  h('shell:show', (view) => { showView(view || 'home'); return true; });
  // The keyboard's volume keys (each step is 2%).
  h('shell:volume', (action) => winctl.runPsKept(`(New-Object -ComObject WScript.Shell).SendKeys([char]${action === 'up' ? 175 : action === 'down' ? 174 : 173})`));
  h('shell:power', powerAction);
  // Menus open as native menus so they can reach above the thin taskbar.
  ipcMain.handle('shell:menu', (e, { kind, hwnd, title } = {}) => {
    const owner = BrowserWindow.fromWebContents(e.sender);
    const item = (label, click) => ({ label, click: () => Promise.resolve(click()).catch((err) => console.error(err)) });
    let template;
    if (kind === 'window') {
      template = [{ label: title || 'Window', enabled: false }, { type: 'separator' },
        item('Switch to', () => winctl.windowByHandle(String(hwnd), 'focus')),
        item('Minimize', () => winctl.windowByHandle(String(hwnd), 'minimize')),
        item('Close window', () => winctl.windowByHandle(String(hwnd), 'close'))];
    } else if (kind === 'clock') {
      template = [{ label: new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), enabled: false }, { type: 'separator' },
        item('Date and time settings', () => winctl.openSettings('time'))];
    } else {
      const preview = desktop.shellMode() === 'preview';
      template = [item('Lock', () => powerAction('lock')), item('Sleep', () => powerAction('sleep')),
        ...(preview ? [] : [item('Sign out', () => powerAction('signout')), item('Restart', () => powerAction('restart')), item('Shut down', () => powerAction('shutdown'))]),
        { type: 'separator' },
        preview ? item('End the preview', () => powerAction('end-preview')) : item('Switch to the Windows desktop', () => powerAction('explorer'))];
    }
    Menu.buildFromTemplate(template).popup({ window: owner });
    return true;
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
  h('app:setOpenAtLogin', (on) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(on), args: ['--hidden'] });
    return app.getLoginItemSettings().openAtLogin;
  });
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
  store.initStore(app.getPath('userData'));
  desktop.initShell({ BrowserWindow, screen, preload: path.join(__dirname, '..', 'preload.cjs'), dataDir: app.getPath('userData'), getMainWindow: () => win, showView });
  winctl.setFolderOpener((dir, select) => { showView('files', { dir, select }); return dir; });
  // Three starts as the desktop within three minutes means Scorpion keeps
  // failing: bring up the Windows desktop instead, so the PC stays usable.
  const asDesktop = shellLaunch && !desktop.recordShellStart();
  if (shellLaunch && !asDesktop) winctl.startExplorer().catch(() => {});
  if (asDesktop) process.on('uncaughtException', (err) => { console.error(err); winctl.explorerRunning().then((on) => on || winctl.startExplorer()).catch(() => {}); });
  if (!asDesktop) desktop.recoverWorkArea().catch(() => {});
  secrets.initSecrets(safeStorage);
  voice.initVoice(store.paths.models);
  faces.initFaces(store.paths.models, app.getPath('userData'));
  insights.initFaceInsights(store.paths.models);
  initMediaModels(store.paths.models);
  library.initLibrary(app.getPath('userData'), {
    decode: decodeInWindow,
    busy: () => running.size > 0, // the scan waits while Scorpion is answering
    onStatus: (s) => send('library:status', s),
    onLowCpu: (on) => { setLowCpu(on); faces.setFaceThreads(on ? 1 : 0); },
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
  createWindow();
  if (asDesktop) await desktop.startShell('shell').catch((err) => { console.error(err); return winctl.startExplorer(); });
  scheduler.startScheduler(runScheduled);
  for (const server of store.getSettings().mcpServers || []) if (server.enabled) connectMcp(server).catch(() => {});
  startTelegram().catch(() => {});
  // Pick up new and changed files a little after start-up.
  setTimeout(() => { if (library.libraryStatus().folders.length) library.scan().catch(() => {}); }, 20000);
  ensureTrayHint();
  if (startHidden && !keepsRunning()) showWindow();
  app.on('activate', showWindow);
});

app.on('second-instance', showWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !keepsRunning() && !desktop.shellMode()) app.quit(); });
app.on('before-quit', (e) => {
  // Leaving the desktop: put the screen area back (and the Windows desktop,
  // when Scorpion was it) before quitting.
  if (desktop.shellMode()) { e.preventDefault(); for (const w of BrowserWindow.getAllWindows()) w.hide(); desktop.stopShell().finally(() => app.quit()); return; }
  winctl.stopPsKept();
  quitting = true; scheduler.stopScheduler(); for (const m of mcp.allStatus()) mcp.disconnect(m.id); tg?.stop(); for (const c of running.values()) c.abort(); engine.shutdown(); });
