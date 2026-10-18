import { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as store from './store.js';
import * as models from './models.js';
import * as engine from './engine.js';
import * as rag from './rag.js';
import * as memory from './memory.js';
import { buildFunctions, buildSystemPrompt, withDocumentContext, withConversationRecall } from './agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..');
const RENDERER_DIR = path.join(APP_ROOT, 'src', 'renderer');
const VENDOR = {
  'marked.js': path.join(APP_ROOT, 'node_modules', 'marked', 'lib', 'marked.esm.js'),
  'purify.js': path.join(APP_ROOT, 'node_modules', 'dompurify', 'dist', 'purify.es.mjs'),
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'kenzo', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Portable/test mode: keep all data (models, chats, memory) in a chosen folder.
if (process.env.KENZO_DATA_DIR) app.setPath('userData', path.resolve(process.env.KENZO_DATA_DIR));

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
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
    else {
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

  // Smoke test: KENZO_SCREENSHOT=out.png [KENZO_VIEW=models] npm start
  if (process.env.KENZO_SCREENSHOT) {
    win.webContents.on('console-message', (e) => console.log(`[renderer] ${e.message}`));
    win.webContents.once('did-finish-load', async () => {
      if (process.env.KENZO_VIEW) await win.webContents.executeJavaScript(`document.querySelector('[data-view="${process.env.KENZO_VIEW}"]')?.click()`);
      await new Promise((r) => setTimeout(r, 2500));
      fs.writeFileSync(process.env.KENZO_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
      app.quit();
    });
  }
}

function modelEnv() {
  return { resourcesPath: process.resourcesPath, appRoot: APP_ROOT };
}

async function state() {
  return {
    settings: store.getSettings(),
    models: models.listLocalModels(modelEnv()),
    catalog: models.CATALOG,
    threads: store.listThreads(),
    documents: rag.listDocuments(),
    memories: memory.listMemories(),
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
  send('model:status', { loading: true, name: path.basename(s.chatModel) });
  try {
    const info = await engine.loadChatModel(s.chatModel, {
      contextSize: s.contextSize,
      onProgress: (p) => send('model:status', { loading: true, progress: p, name: path.basename(s.chatModel) }),
    });
    send('model:status', { loading: false, info });
    return info;
  } catch (err) {
    send('model:status', { loading: false, error: err.message });
    throw err;
  }
}

function applyEvent(blocks, ev) {
  const last = blocks.at(-1);
  if (ev.type === 'text' || ev.type === 'thought') {
    if (last?.type === ev.type) last.text += ev.delta;
    else blocks.push({ type: ev.type, text: ev.delta });
  } else if (ev.type === 'tool') {
    blocks.push({ type: 'tool', id: ev.id, name: ev.name, access: ev.access, summary: ev.summary, args: ev.args, status: 'running' });
  } else if (ev.type === 'tool-result') {
    const b = blocks.find((x) => x.type === 'tool' && x.id === ev.id);
    if (b) Object.assign(b, { status: ev.ok ? 'ok' : 'error', output: ev.output });
  } else if (ev.type === 'plan') {
    const existing = blocks.find((x) => x.type === 'plan');
    if (existing) existing.steps = ev.steps;
    else blocks.push({ type: 'plan', steps: ev.steps });
  }
}

async function chatSend({ threadId, text }) {
  if (running.has(threadId)) throw new Error('Kenzo is still answering in this chat');
  const thread = store.getThread(threadId);
  if (!thread) throw new Error('Chat not found');
  const settings = store.getSettings();
  if (!engine.isChatReady()) await loadChat();

  const assistant = { role: 'assistant', blocks: [], model: engine.chatModelName(), createdAt: Date.now() };
  thread.messages.push({ role: 'user', text, createdAt: Date.now() }, assistant);
  if (thread.title === 'New chat') thread.title = text.replace(/\s+/g, ' ').slice(0, 60);
  store.saveThread(thread);

  const controller = new AbortController();
  running.set(threadId, controller);
  const emit = (ev) => {
    applyEvent(assistant.blocks, ev);
    send('chat:event', { threadId, ...ev });
  };
  const requestApproval = (info) => new Promise((resolve) => {
    approvals.set(info.id, resolve);
    controller.signal.addEventListener('abort', () => resolve(false), { once: true });
    send('chat:event', { threadId, type: 'approval', ...info });
  });

  const searcher = rag.createSearcher(settings);
  let streamed = '';
  try {
    thread.history = await engine.runTurn({
      threadId,
      history: thread.history,
      systemPrompt: buildSystemPrompt(settings, {
        docNames: rag.listDocuments().map((d) => d.name),
        memoryBlock: settings.memoryEnabled ? memory.memoryPromptBlock() : '',
      }),
      text: await withDocumentContext(settings.memoryEnabled && settings.recallEnabled ? withConversationRecall(text, memory, threadId) : text, searcher),
      temperature: settings.temperature,
      signal: controller.signal,
      functions: buildFunctions({ settings, rag: searcher, memory, threadId, emit, requestApproval, signal: controller.signal, streamedText: () => streamed }),
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
  return { ok: !assistant.error };
}

function registerIpc() {
  const h = (channel, fn) => ipcMain.handle(channel, (_e, arg) => fn(arg));

  h('app:state', state);
  h('settings:update', async (patch) => {
    const before = store.getSettings();
    const next = store.updateSettings(patch);
    if (patch.chatModel && patch.chatModel !== before.chatModel) loadChat().catch(() => {});
    else if (patch.contextSize && patch.contextSize !== before.contextSize && engine.isChatReady()) {
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

  h('thread:create', () => store.createThread());
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

app.whenReady().then(() => {
  store.initStore(app.getPath('userData'));
  autoSelectModels();
  serveApp();
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { for (const c of running.values()) c.abort(); engine.shutdown(); });
