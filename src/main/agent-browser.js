// The agent's own browser, after OpenClaw's managed browser: a separate
// Scorpion window with its own profile (cookies, logins), never the user's
// everyday browser. The agent opens pages, reads them, clicks and types.
// Every page is untrusted. Typing, and clicks that look like they commit to
// something (buy, send, delete, sign up…), wait for the user's approval.
// Downloads, pop-ups and device permissions are refused.
import { UNTRUSTED } from './web.js';

const PARTITION = 'persist:scorpion-browser';
const MAX_TEXT = 5000;
const MAX_ELEMENTS = 80;

// Runs inside the page: numbers the visible things you can click or fill in
// (data-scorpion-ref) and returns them with the page's text.
export const SCAN_SCRIPT = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('placeholder') || el.name || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  document.querySelectorAll('[data-scorpion-ref]').forEach((el) => el.removeAttribute('data-scorpion-ref'));
  const items = [];
  const sel = 'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], summary, [contenteditable=true]';
  for (const el of document.querySelectorAll(sel)) {
    if (items.length >= ${MAX_ELEMENTS} || !visible(el) || el.disabled) continue;
    const ref = items.length + 1;
    el.setAttribute('data-scorpion-ref', String(ref));
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const kind = tag === 'a' || el.getAttribute('role') === 'link' ? 'link' : tag === 'input' ? 'input' : tag === 'textarea' || el.isContentEditable ? 'textbox' : tag === 'select' ? 'select' : 'button';
    const form = el.form || el.closest('form');
    items.push({
      ref, kind, type, text: label(el),
      href: tag === 'a' ? el.href.slice(0, 160) : undefined,
      value: kind === 'select' ? el.options[el.selectedIndex]?.text : type === 'password' ? (el.value ? '••••' : '') : (kind === 'input' || kind === 'textbox') ? String(el.value || el.innerText || '').slice(0, 60) : undefined,
      options: kind === 'select' ? [...el.options].slice(0, 15).map((o) => o.text.trim()) : undefined,
      submit: type === 'submit' || (tag === 'button' && form && (el.getAttribute('type') || 'submit') === 'submit'),
      checked: type === 'checkbox' || type === 'radio' ? el.checked : undefined,
    });
  }
  const text = (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
  return { title: document.title, url: location.href, text, items };
})()`;

// Clicks that commit to something get the user's OK first.
const RISKY = /\b(buy|order|purchase|checkout|check out|pay|place order|subscribe|donate|transfer|send|post|publish|submit|delete|remove|confirm|sign up|register|create account|accept|agree|book|reserve|unsubscribe|log ?out|sign out)\b/i;
export function riskyClick(item) {
  if (!item) return true; // unknown element: ask
  return Boolean(item.submit) || RISKY.test(item.text || '');
}

export function describe(page, { maxText = MAX_TEXT } = {}) {
  const lines = page.items.map((i) => {
    const bits = [`[${i.ref}] ${i.kind}${i.type && i.kind === 'input' ? `(${i.type})` : ''}`];
    if (i.text) bits.push(`"${i.text}"`);
    if (i.href) bits.push(`→ ${i.href}`);
    if (i.value) bits.push(`value="${i.value}"`);
    if (i.options) bits.push(`options: ${i.options.join(' | ')}`);
    if (i.checked !== undefined) bits.push(i.checked ? 'checked' : 'unchecked');
    return bits.join(' ');
  });
  const text = page.text.length > maxText ? `${page.text.slice(0, maxText)}\n…[more below: browser_scroll down, then browser_read]` : page.text;
  return `${UNTRUSTED}\n\n${page.title || '(untitled)'}\n${page.url}\n\nPage text:\n${text || '(none)'}\n\nThings you can use (by number):\n${lines.join('\n') || '(none)'}`;
}

export function cleanUrl(url) {
  let u = String(url || '').trim();
  if (!u) throw new Error('Give a web address');
  if (!/^[a-z]+:\/\//i.test(u)) u = /\s/.test(u) || !u.includes('.') ? `https://duckduckgo.com/html/?q=${encodeURIComponent(u)}` : `https://${u}`;
  const parsed = new URL(u);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http and https pages can be opened');
  return parsed.href;
}

// ---------- the window (Electron) ----------
export function createAgentBrowser({ BrowserWindow, session, show = true }) {
  let win = null;
  let last = null; // latest scan
  const ses = session.fromPartition(PARTITION);
  ses.on('will-download', (e) => e.preventDefault());
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);

  function ensure() {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({
      width: 1200, height: 860, show: false, title: 'Scorpion browser',
      autoHideMenuBar: true,
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true },
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) win.loadURL(url).catch(() => {});
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => { if (!/^https?:/.test(url)) e.preventDefault(); });
    win.on('closed', () => { win = null; last = null; });
    return win;
  }

  const settle = (wc, ms = 9000) => new Promise((resolve) => {
    const done = () => setTimeout(resolve, 600);
    if (!wc.isLoading()) { setTimeout(() => (wc.isLoading() ? wc.once('did-stop-loading', done) : resolve()), 700); return; }
    const t = setTimeout(resolve, ms);
    wc.once('did-stop-loading', () => { clearTimeout(t); done(); });
  });

  async function scan() {
    const w = ensure();
    last = await w.webContents.executeJavaScript(SCAN_SCRIPT, true);
    return last;
  }

  const element = (ref) => last?.items.find((i) => i.ref === Number(ref)) || null;

  async function open(url) {
    const w = ensure();
    if (show && !w.isVisible()) w.showInactive();
    await w.loadURL(cleanUrl(url)).catch((err) => { if (!/ERR_ABORTED/.test(err.message)) throw err; });
    await settle(w.webContents);
    return describe(await scan());
  }

  async function read() {
    if (!win || win.isDestroyed()) throw new Error('No page is open. Use browser_open first.');
    return describe(await scan());
  }

  async function click(ref) {
    const w = ensure();
    const box = await w.webContents.executeJavaScript(`(() => { const el = document.querySelector('[data-scorpion-ref="${Number(ref)}"]'); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`, true);
    if (!box) throw new Error(`There is no element [${ref}] on the page any more. Call browser_read to see the current page.`);
    for (const type of ['mouseDown', 'mouseUp']) w.webContents.sendInputEvent({ type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await settle(w.webContents);
    return describe(await scan(), { maxText: 3000 });
  }

  async function type(ref, text, submit) {
    const w = ensure();
    const kind = await w.webContents.executeJavaScript(`(() => { const el = document.querySelector('[data-scorpion-ref="${Number(ref)}"]'); if (!el) return null; el.scrollIntoView({ block: 'center' }); el.focus(); if (el.tagName === 'SELECT') return 'select'; if (el.select) el.select(); else document.execCommand('selectAll'); return 'text'; })()`, true);
    if (!kind) throw new Error(`There is no element [${ref}] on the page any more. Call browser_read to see the current page.`);
    if (kind === 'select') {
      const ok = await w.webContents.executeJavaScript(`(() => { const el = document.querySelector('[data-scorpion-ref="${Number(ref)}"]'); const want = ${JSON.stringify(String(text))}.toLowerCase(); const o = [...el.options].find((x) => x.text.trim().toLowerCase() === want) || [...el.options].find((x) => x.text.toLowerCase().includes(want)); if (!o) return false; el.value = o.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`, true);
      if (!ok) throw new Error(`No option like "${text}" in that list.`);
    } else {
      await w.webContents.insertText(String(text));
    }
    if (submit) for (const t of ['keyDown', 'char', 'keyUp']) w.webContents.sendInputEvent({ type: t, keyCode: 'Enter' });
    await settle(w.webContents, submit ? 9000 : 1500);
    return describe(await scan(), { maxText: 3000 });
  }

  async function scroll(direction) {
    const w = ensure();
    await w.webContents.executeJavaScript(`window.scrollBy(0, ${direction === 'up' ? -1 : 1} * window.innerHeight * 0.85)`, true);
    // Text below the fold: show what's on screen now.
    const page = await scan();
    const visibleText = await w.webContents.executeJavaScript(`(() => { const out = []; const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = walk.nextNode()) && out.join(' ').length < ${MAX_TEXT}) { const r = n.parentElement?.getBoundingClientRect(); if (r && r.bottom > 0 && r.top < innerHeight && n.textContent.trim()) out.push(n.textContent.trim()); } return out.join(' '); })()`, true);
    return describe({ ...page, text: visibleText }, { maxText: 3000 });
  }

  async function back() {
    const w = ensure();
    if (!w.webContents.navigationHistory?.canGoBack?.() && !w.webContents.canGoBack?.()) throw new Error('There is no previous page');
    (w.webContents.navigationHistory?.goBack ? w.webContents.navigationHistory.goBack() : w.webContents.goBack());
    await settle(w.webContents);
    return describe(await scan(), { maxText: 3000 });
  }

  function close() {
    if (win && !win.isDestroyed()) win.close();
    return 'Closed the browser.';
  }

  const show_ = () => { const w = ensure(); w.show(); w.focus(); };
  const clearData = () => ses.clearStorageData();

  return { open, read, click, type, scroll, back, close, element, show: show_, clearData, isOpen: () => Boolean(win && !win.isDestroyed()) };
}

// Tool-table entries (same shape as TOOLS in tools.js).
export function browserTools(browser) {
  return {
    browser_open: {
      access: 'web', noWorkspace: true,
      description: 'Open a web page in your own browser window (or search words). Returns the page text and numbered links, buttons and fields. Use it for sites that need clicking, forms or logins; read_webpage is faster for plain reading.',
      params: { type: 'object', properties: { url: { type: 'string' } } },
      run: ({ url }) => browser.open(url),
    },
    browser_read: {
      access: 'web', noWorkspace: true,
      description: 'Read the page that is open in your browser again (after it changed).',
      params: { type: 'object', properties: {} },
      run: () => browser.read(),
    },
    browser_click: {
      access: 'web', noWorkspace: true,
      // Buttons that send, buy, delete etc. wait for the user's OK.
      approve: ({ ref }) => riskyClick(browser.element(ref)),
      describeAction: ({ ref }) => { const i = browser.element(ref); return i ? `click ${i.kind} "${i.text}"${i.href ? ` → ${i.href}` : ''}` : `click [${ref}]`; },
      description: 'Click a link or button on the open page by its number.',
      params: { type: 'object', properties: { ref: { type: 'integer' } } },
      run: ({ ref }) => browser.click(ref),
    },
    browser_type: {
      access: 'web', noWorkspace: true,
      approve: () => true, // typing into websites always asks first
      describeAction: ({ ref, text, submit }) => { const i = browser.element(ref); return `type "${i?.type === 'password' ? '••••' : text}" into ${i ? `${i.kind} "${i.text}"` : `[${ref}]`}${submit ? ', then press Enter' : ''}`; },
      description: 'Type into a field on the open page (or pick an option in a list) by its number. submit true presses Enter after.',
      params: { type: 'object', properties: { ref: { type: 'integer' }, text: { type: 'string' }, submit: { type: 'boolean' } } },
      run: ({ ref, text, submit }) => browser.type(ref, text, submit),
    },
    browser_scroll: {
      access: 'web', noWorkspace: true,
      description: 'Scroll the open page down or up and read what is now on screen.',
      params: { type: 'object', properties: { direction: { enum: ['down', 'up'] } } },
      run: ({ direction }) => browser.scroll(direction),
    },
    browser_back: {
      access: 'web', noWorkspace: true,
      description: 'Go back to the previous page.',
      params: { type: 'object', properties: {} },
      run: () => browser.back(),
    },
  };
}
