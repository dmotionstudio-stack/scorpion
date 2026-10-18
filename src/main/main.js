import { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Notification, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as store from './store.js';
import * as models from './models.js';
import * as engine from './engine.js';
import * as rag from './rag.js';
import * as memory from './memory.js';
import * as agents from './agents.js';
import * as scheduler from './scheduler.js';
import { TOOLS } from './tools.js';
import { applyEvent } from '../shared/events.js';
import { buildFunctions, buildSystemPrompt, withDocumentContext, withConversationRecall } from './agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..');
const RENDERER_DIR = path.join(APP_ROOT, 'src', 'renderer');
const SHARED_DIR = path.join(APP_ROOT, 'src', 'shared');
const VENDOR = {
  'marked.js': path.join(APP_ROOT, 'node_modules', 'marked', 'lib', 'marked.esm.js'),
  'purify.js': path.join(APP_ROOT, 'node_modules', 'dompurify', 'dist', 'purify.es.mjs'),
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'kenzo', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Portable mode: a "kenzo-data" folder next to Kenzo.exe holds everything
// (models, chats, memory), so Kenzo can run from a USB stick and leave nothing
// on the computer. KENZO_DATA_DIR overrides it (used for testing).
const portableDir = path.join(path.dirname(process.execPath), 'kenzo-data');
if (process.env.KENZO_DATA_DIR) app.setPath('userData', path.resolve(process.env.KENZO_DATA_DIR));
else if (app.isPackaged && fs.existsSync(portableDir)) {
  app.setPath('userData', portableDir);
  // Chromium caches also go in the portable folder instead of AppData.
  app.setPath('sessionData', path.join(portableDir, 'session'));
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
  protocol.handle('kenzo', (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    let file;
    if (rel.startsWith('vendor/')) file = VENDOR[rel.slice('vendor/'.length)];
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

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 820,
    minHeight: 560,
    title: 'Kenzo',
    show: false,
    backgroundColor: '#111214',
    autoHideMenuBar: true,
    icon: path.join(APP_ROOT, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Kenzo is offline: never navigate the app window anywhere else; open
  // external links (e.g. in rendered Markdown) in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('kenzo://')) e.preventDefault();
  });
  win.loadURL('kenzo://app/index.html');
  if (!startHidden || process.env.KENZO_SCREENSHOT) win.once('ready-to-show', () => win.show());

  // With scheduled agents on, closing the window keeps Kenzo running in the tray.
  win.on('close', (e) => {
    if (quitting || !scheduler.hasEnabledSchedules()) return;
    e.preventDefault();
    win.hide();
    ensureTray();
  });

  // Smoke test: KENZO_SCREENSHOT=out.png [KENZO_VIEW=models] npm start
  if (process.env.KENZO_SCREENSHOT) {
    win.webContents.on('console-message', (e) => console.log(`[renderer] ${e.message}`));
    win.webContents.once('did-finish-load', async () => {
      if (process.env.KENZO_VIEW) await win.webContents.executeJavaScript(`document.querySelector('[data-view="${process.env.KENZO_VIEW}"]')?.click()`);
      await new Promise((r) => setTimeout(r, Number(process.env.KENZO_SCREENSHOT_DELAY) || 2500));
      fs.writeFileSync(process.env.KENZO_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
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
  tray.setToolTip('Kenzo — scheduled agents are running');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Kenzo', click: showWindow },
    { type: 'separator' },
    { label: 'Quit Kenzo', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

function modelEnv() {
  return { resourcesPath: process.resourcesPath, appRoot: APP_ROOT };
}

function scheduleView() {
  return scheduler.listSchedules().map((s) => ({ ...s, nextRunAt: scheduler.nextRunAt(s) }));
}

async function state() {
  return {
    settings: store.getSettings(),
    models: models.listLocalModels(modelEnv()),
    catalog: models.CATALOG,
    threads: store.listThreads(),
    documents: rag.listDocuments(),
    memories: memory.listMemories(),
    agents: agents.listAgents(),
    tools: Object.entries(TOOLS).map(([name, t]) => ({ name, access: t.access, description: t.description.split('. ')[0] })).concat([{ name: 'ask_agent', access: 'agent', description: 'Hand subtasks to other agents' }]),
    schedules: scheduleView(),
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    supportedDocs: rag.SUPPORTED_EXTENSIONS,
    engine: await engine.engineInfo().catch((e) => ({ error: e.message })),
    platform: process.platform,
  };
}

// Pick sensible defaults the first time: a bundled/downloaded model is used
// automatically so a preloaded offline install works with zero clicks.
function autoSelectModels() {
  const s = store.getSettings();
  const local = models.listLocalModels(modelEnv());
  const exists = (p) => p && fs.existsSync(p);
  const patch = {};
  if (!exists(s.chatModel)) patch.chatModel = local.find((m) => m.kind === 'chat')?.path ?? null;
  if (!exists(s.embedModel)) patch.embedModel = local.find((m) => m.kind === 'embedding')?.path ?? null;
  if (Object.keys(patch).length) store.updateSettings(patch);
}

async function loadChat() {
  const s = store.getSettings();
  if (!s.chatModel) return engine.engineInfo();
  const display = models.listLocalModels(modelEnv()).find((m) => m.path === s.chatModel)?.name || path.basename(s.chatModel);
  send('model:status', { loading: true, name: display });
  try {
    const info = await engine.loadChatModel(s.chatModel, {
      contextSize: s.contextSize,
      gpuLayers: s.gpuLayers,
      name: models.listLocalModels(modelEnv()).find((m) => m.path === s.chatModel)?.name,
      onProgress: (p) => send('model:status', { loading: true, progress: p, name: display }),
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
async function runAgentTurn({ thread, text, displayText = text, approve, workspace }) {
  const threadId = thread.id;
  if (running.has(threadId)) throw new Error('Kenzo is still answering in this chat');
  const base = store.getSettings();
  const settings = { ...base, workspace: workspace ?? base.workspace };
  const agent = agents.getAgent(thread.agentId || 'kenzo');
  if (!engine.isChatReady()) await loadChat();

  const assistant = { role: 'assistant', blocks: [], model: engine.chatModelName(), agentId: agent.id, createdAt: Date.now() };
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

  const searcher = rag.createSearcher(settings);
  let streamed = '';
  try {
    const recall = settings.memoryEnabled && settings.recallEnabled ? withConversationRecall(text, memory, threadId) : text;
    thread.history = await engine.runTurn({
      threadId,
      history: thread.history,
      systemPrompt: buildSystemPrompt(settings, {
        docNames: rag.listDocuments().map((d) => d.name),
        memoryBlock: settings.memoryEnabled ? memory.memoryPromptBlock() : '',
        agent,
      }),
      text: await withDocumentContext(recall, searcher),
      temperature: agent.temperature ?? settings.temperature,
      signal: controller.signal,
      functions: buildFunctions({
        settings, agent, rag: searcher, memory, threadId, emit, requestApproval,
        signal: controller.signal, streamedText: () => streamed, runHelper: engine.runHelperTurn,
      }),
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

// Interactive approval: show Allow/Deny in the chat and wait for the click.
function askUser(info, signal, threadId) {
  return new Promise((resolve) => {
    approvals.set(info.id, resolve);
    signal.addEventListener('abort', () => resolve(false), { once: true });
    send('chat:event', { threadId, type: 'approval', ...info });
  });
}

async function chatSend({ threadId, text }) {
  const thread = store.getThread(threadId);
  if (!thread) throw new Error('Chat not found');
  const result = await runAgentTurn({ thread, text, approve: askUser });
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
  h('settings:update', async (patch) => {
    const before = store.getSettings();
    const next = store.updateSettings(patch);
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
  h('model:delete', async (file) => {
    const s = store.getSettings();
    if (s.chatModel === file) { await engine.unloadChatModel(); store.updateSettings({ chatModel: null }); }
    if (s.embedModel === file) store.updateSettings({ embedModel: null });
    models.deleteModel(file);
  });

  h('workspace:choose', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose the folder Kenzo may work in', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return store.getSettings();
    return store.updateSettings({ workspace: r.filePaths[0] });
  });
  h('workspace:open', () => { const w = store.getSettings().workspace; if (w) shell.openPath(w); });

  h('thread:create', (agentId) => {
    const t = store.createThread();
    if (agentId) { t.agentId = agents.getAgent(agentId).id; store.saveThread(t); }
    return t;
  });
  h('thread:setAgent', ({ id, agentId }) => {
    const t = store.getThread(id);
    if (!t) throw new Error('Chat not found');
    t.agentId = agents.getAgent(agentId).id;
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

// Starting minimized at login only makes sense if something is scheduled.
function ensureTrayHint() {
  if (scheduler.hasEnabledSchedules()) ensureTray();
}

app.whenReady().then(() => {
  store.initStore(app.getPath('userData'));
  autoSelectModels();
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
