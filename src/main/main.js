import { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Notification, Tray, Menu, nativeImage, session, systemPreferences } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as store from './store.js';
import * as models from './models.js';
import * as engine from './engine.js';
import * as rag from './rag.js';
import * as memory from './memory.js';
import * as agents from './agents.js';
import * as scheduler from './scheduler.js';
import * as voice from './voice.js';
import { TOOLS } from './tools.js';
import { applyEvent } from '../shared/events.js';
import { buildFunctions, buildSystemPrompt, withDocumentContext, withConversationRecall } from './agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..');
const RENDERER_DIR = path.join(APP_ROOT, 'src', 'renderer');
const SHARED_DIR = path.join(APP_ROOT, 'src', 'shared');
const THREE_BUILD = path.join(APP_ROOT, 'node_modules', 'three', 'build');
// The orb's few Three.js add-ons are vendored (installers drop node_modules
// "examples" folders); test/orb.test.js keeps them in step with three.
const THREE_ADDONS = path.join(APP_ROOT, 'src', 'vendor', 'three-addons');
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
const running = new Map(); // threadId -> AbortController
const approvals = new Map(); // approval id -> resolve(boolean)

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function serveApp() {
  protocol.handle('scorpion', (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    let file;
    if (rel.startsWith('vendor/three/')) {
      // Three.js is a set of ES modules: its build, plus the add-ons the orb uses.
      const sub = rel.slice('vendor/three/'.length);
      const build = /^build\/(three\.(module|core)\.js)$/.exec(sub);
      const addon = /^examples\/jsm\/((controls|postprocessing|shaders)\/\w+\.js)$/.exec(sub);
      file = build ? path.join(THREE_BUILD, build[1]) : addon ? path.join(THREE_ADDONS, addon[1]) : null;
    } else if (rel.startsWith('vendor/')) file = VENDOR[rel.slice('vendor/'.length)];
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
    if (quitting || !scheduler.hasEnabledSchedules()) return;
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
    return info;
  } catch (err) {
    send('model:status', { loading: false, error: err.message });
    throw err;
  }
}

/**
 * One agent turn on a thread, used by chats and scheduled agents alike.
 * `approve` decides write/exec actions; chats ask the user in the UI, schedules
 * use their "allow changes" setting. `workspace` overrides the folder.
 */
async function runAgentTurn({ thread, text, displayText = text, approve, workspace, mode, interactive = false }) {
  const threadId = thread.id;
  if (running.has(threadId)) throw new Error('Scorpion is still answering in this chat');
  const base = store.getSettings();
  const settings = { ...base, workspace: workspace ?? base.workspace, mode: mode || thread.mode || 'build' };
  const agent = agents.getAgent(thread.agentId || 'scorpion');
  if (!engine.isChatReady()) await loadChat();

  const assistant = { role: 'assistant', blocks: [], model: engine.chatModelName(), agentId: agent.id, mode: settings.mode, createdAt: Date.now() };
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
  const allowedFolders = [...(base.allowedFolders || []), ...sessionFolders];

  const searcher = rag.createSearcher(settings);
  let streamed = '';
  const info = await engine.engineInfo();
  try {
    const recall = settings.memoryEnabled && settings.recallEnabled ? withConversationRecall(text, memory, threadId) : text;
    thread.history = await engine.runTurn({
      threadId,
      history: thread.history,
      systemPrompt: buildSystemPrompt(settings, {
        docNames: rag.listDocuments().map((d) => d.name),
        memoryBlock: settings.memoryEnabled ? memory.memoryPromptBlock() : '',
        agent,
        canAskForFolders: Boolean(requestFolderAccess),
      }),
      text: await withDocumentContext(recall, searcher),
      temperature: agent.temperature ?? settings.temperature,
      // Building writes whole files and iterates on errors, so it gets more room.
      // A single reply also has to fit in the context, so cap it at half of it.
      maxTokens: Math.min(settings.mode === 'build' ? 6144 : 3072, Math.floor((info.contextSize || 8192) / 2)),
      signal: controller.signal,
      functions: buildFunctions({
        settings, agent, rag: searcher, memory, threadId, emit, requestApproval, requestFolderAccess, allowedFolders,
        signal: controller.signal, streamedText: () => streamed, runHelper: engine.runHelperTurn,
        maxToolChars: info.maxToolChars ?? undefined,
      }),
      continuation: () => continuationPrompt(assistant.blocks),
      onText: (delta) => { streamed += delta; emit({ type: 'text', delta }); },
      onThought: (delta) => emit({ type: 'thought', delta }),
    });
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
      detail: `The agent wants to work with files (${summary}).\n\nChoose the folder it may read and work in. You can change it any time with 📁 in the top bar.`,
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

async function chatSend({ threadId, text }) {
  const thread = store.getThread(threadId);
  if (!thread) throw new Error('Chat not found');
  const result = await runAgentTurn({ thread, text, approve: askUser, interactive: true });
  return { ok: !result.error };
}

// A scheduled run posts into the schedule's own chat and notifies when done.
async function runScheduled(schedule, reason) {
  let thread = schedule.threadId && store.getThread(schedule.threadId);
  if (!thread) {
    thread = store.createThread();
    thread.title = `⏰ ${schedule.name}`;
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
    displayText: `⏰ ${reason}\n${schedule.prompt}`,
    approve: async () => schedule.allowChanges,
    workspace,
    mode: 'build',
  });
  if (Notification.isSupported()) {
    const n = new Notification({
      title: `${result.error ? '⚠ ' : ''}${schedule.name}`,
      body: (result.error || result.text || 'Done').replace(/[#*`>_]/g, '').trim().slice(0, 180),
      silent: true,
    });
    n.on('click', () => { showWindow(); send('open-thread', thread.id); });
    n.show();
  }
  send('schedules:changed');
  return result;
}

function registerIpc() {
  const h = (channel, fn) => ipcMain.handle(channel, (_e, arg) => fn(arg));

  h('app:state', state);
  h('voice:install', async () => {
    await voice.installVoice((p) => send('voice:download', p));
    return voice.voiceStatus();
  });
  h('voice:warm', () => { voice.warmUp(); return true; });
  h('voice:uninstall', async () => { await voice.uninstallVoice(); return voice.voiceStatus(); });
  h('voice:transcribe', async (pcm) => voice.transcribe(pcm, store.getSettings().voiceLanguage));
  h('voice:speak', async (text) => {
    const s = store.getSettings();
    return voice.speak(text, { voice: s.voiceName, speed: s.voiceSpeed });
  });
  // macOS asks the user once; Windows uses its own privacy setting.
  h('voice:micAccess', async () => {
    if (process.platform !== 'darwin') return true;
    if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true;
    return systemPreferences.askForMediaAccess('microphone');
  });
  h('settings:update', async (patch) => {
    const before = store.getSettings();
    const next = store.updateSettings(patch);
    if ((patch.glass !== undefined && patch.glass !== before.glass) || (patch.theme && patch.theme !== before.theme)) applyGlass();
    if (patch.chatModel && patch.chatModel !== before.chatModel) loadChat().catch(() => {});
    else if (((patch.contextSize && patch.contextSize !== before.contextSize) || (patch.gpuLayers !== undefined && patch.gpuLayers !== before.gpuLayers)) && engine.isChatReady()) {
      await engine.unloadChatModel();
      loadChat().catch(() => {});
    }
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

  h('workspace:choose', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose the folder Scorpion may work in', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return store.getSettings();
    return store.updateSettings({ workspace: r.filePaths[0] });
  });
  h('workspace:open', () => { const w = store.getSettings().workspace; if (w) shell.openPath(w); });

  h('thread:create', (opts) => {
    const { agentId, mode } = typeof opts === 'string' ? { agentId: opts } : opts || {};
    const t = store.createThread();
    if (agentId) t.agentId = agents.getAgent(agentId).id;
    if (['chat', 'plan', 'build'].includes(mode)) t.mode = mode;
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
  h('chat:approve', ({ id, approved }) => { approvals.get(id)?.(Boolean(approved)); approvals.delete(id); });

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

// The UI may use the microphone (for voice chat) and nothing else: no camera,
// screen, location or notifications from the page.
function allowMicrophoneOnly() {
  const isOwnPage = (url) => String(url || '').startsWith('scorpion://');
  const micOnly = (permission, details) => permission === 'media'
    && (details?.mediaTypes ?? ['audio']).every((t) => t === 'audio');
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(isOwnPage(details?.requestingUrl ?? wc.getURL()) && micOnly(permission, details));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin, details) => {
    return isOwnPage(origin) && (permission === 'media' ? (details?.mediaType ?? 'audio') === 'audio' : false);
  });
}

// Starting minimized at login only makes sense if something is scheduled.
function ensureTrayHint() {
  if (scheduler.hasEnabledSchedules()) ensureTray();
}

app.whenReady().then(async () => {
  store.initStore(app.getPath('userData'));
  voice.initVoice(store.paths.models);
  allowMicrophoneOnly();
  await autoSelectModels();
  serveApp();
  registerIpc();
  createWindow();
  scheduler.startScheduler(runScheduled);
  ensureTrayHint();
  if (startHidden && !scheduler.hasEnabledSchedules()) showWindow();
  app.on('activate', showWindow);
});

app.on('second-instance', showWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !scheduler.hasEnabledSchedules()) app.quit(); });
app.on('before-quit', () => { quitting = true; scheduler.stopScheduler(); for (const c of running.values()) c.abort(); engine.shutdown(); });
