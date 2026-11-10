// The preview and browser for Build: a page of a server running on this
// computer, shown inside Scorpion beside the chat (a view docked into the
// window at the place the page asks for). It only ever shows localhost; a link
// to anywhere else opens in the person's own browser. The agent can look at the
// page and its console errors to fix what it built (describe in agent-browser.js).
import { isLocalUrl } from './devserver.js';

const MAX_CONSOLE = 100;

// deps: { WebContentsView, session, getWindow(), openExternal(url), onState(state) }
export function createPreview({ WebContentsView, session, getWindow, openExternal, onState = () => {} }) {
  let view = null;
  let attached = false;
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  let wanted = false; // the pane is open
  const consoleLog = [];

  const wc = () => view?.webContents;
  const state = () => {
    const c = wc();
    return { url: c && !c.isDestroyed() ? c.getURL() : '', title: c && !c.isDestroyed() ? c.getTitle() : '', loading: Boolean(c?.isLoading()), canBack: Boolean(c?.navigationHistory?.canGoBack()), canForward: Boolean(c?.navigationHistory?.canGoForward()), errors: consoleLog.filter((l) => l.level >= 3).length };
  };
  const emit = () => onState(state());

  function ensure() {
    if (view && !view.webContents.isDestroyed()) return view;
    view = new WebContentsView({ webPreferences: { session: session.fromPartition('persist:scorpion-preview'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const c = view.webContents;
    // Nothing but this computer's own pages: a link elsewhere opens in the person's browser.
    c.setWindowOpenHandler(({ url }) => { if (isLocalUrl(url)) load(url); else if (/^https?:/i.test(url)) openExternal(url); return { action: 'deny' }; });
    c.on('will-navigate', (e, url) => { if (!isLocalUrl(url)) { e.preventDefault(); if (/^https?:/i.test(url)) openExternal(url); } });
    c.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading', 'page-title-updated']) c.on(ev, emit);
    // The page's own console (an error here is what the agent should fix). Electron's event shape changed between versions.
    c.on('console-message', (...args) => {
      const d = args[0]?.message !== undefined ? args[0] : { level: args[1], message: args[2], lineNumber: args[3], sourceId: args[4] };
      const level = typeof d.level === 'number' ? d.level : ({ verbose: 0, info: 1, warning: 2, error: 3 }[d.level] ?? 1);
      consoleLog.push({ level, message: String(d.message).slice(0, 500), source: String(d.sourceId || '').slice(-80), line: d.lineNumber });
      while (consoleLog.length > MAX_CONSOLE) consoleLog.shift();
    });
    return view;
  }
  function attach() {
    const w = getWindow();
    if (!w || w.isDestroyed()) return;
    ensure();
    if (!attached) { w.contentView.addChildView(view); attached = true; }
    view.setBounds(bounds);
  }
  function detach() {
    const w = getWindow();
    if (attached && w && !w.isDestroyed() && view) { try { w.contentView.removeChildView(view); } catch { /* gone */ } }
    attached = false;
  }

  function load(url) {
    if (!isLocalUrl(url)) throw new Error('The preview shows pages on this computer only (localhost).');
    ensure();
    consoleLog.length = 0;
    if (wanted) attach();
    return wc().loadURL(url).catch((err) => { /* a server that is not up yet: the page says so */ if (!/ERR_ABORTED/.test(err.message)) throw err; });
  }
  return {
    // The pane's place (CSS pixels of the window) and whether it is open.
    setBounds({ x, y, width, height, visible }) {
      bounds = { x: Math.round(x), y: Math.round(y), width: Math.max(0, Math.round(width)), height: Math.max(0, Math.round(height)) };
      wanted = Boolean(visible) && bounds.width > 20 && bounds.height > 20;
      if (wanted) attach(); else detach();
    },
    load,
    nav(action) {
      const c = wc();
      if (!c || c.isDestroyed()) return state();
      if (action === 'back' && c.navigationHistory.canGoBack()) c.navigationHistory.goBack();
      else if (action === 'forward' && c.navigationHistory.canGoForward()) c.navigationHistory.goForward();
      else if (action === 'reload') c.reload();
      else if (action === 'devtools') c.openDevTools({ mode: 'detach' });
      else if (action === 'external' && c.getURL()) openExternal(c.getURL());
      return state();
    },
    state,
    consoleLog: () => consoleLog.slice(),
    // What the agent sees: the page's text and controls, and what its console complained about.
    async snapshot(describe, scan) {
      const c = wc();
      if (!c || c.isDestroyed() || !c.getURL()) throw new Error('Nothing is open in the preview. Start the server and open it first.');
      const page = await c.executeJavaScript(scan);
      const errors = consoleLog.filter((l) => l.level >= 2).slice(-15).map((l) => `${l.level >= 3 ? 'error' : 'warning'}: ${l.message}${l.source ? ` (${l.source}${l.line ? `:${l.line}` : ''})` : ''}`);
      return `${describe(page, { maxText: 3000 })}\n\nConsole: ${errors.length ? `\n${errors.join('\n')}` : 'no errors or warnings'}`;
    },
    destroy() { detach(); if (view && !view.webContents.isDestroyed()) view.webContents.close(); view = null; },
  };
}
