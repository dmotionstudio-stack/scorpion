// The orb as a whole system: Interact becomes the front of everything.
// - Shortcuts orbit the orb (Scorpion's places, and every open window); pick
//   one by saying its name, pointing and pinching, or clicking.
// - As the Windows desktop the orb is what's behind your apps; places open
//   over it and "back" (or pushing your hand toward the screen) returns.
// - Changes Scorpion wants to make are asked out loud: say yes or no.
// - The PC's events (battery, downloads, finished schedules, check-ins) make
//   the orb pulse, and are spoken if the user wants.
// - Apps open inside the orb: the app in front is framed in a panel on the
//   left (orb-frame.js does the window work), the orb moves to the right.
// - At sign-in the orb greets the person it recognizes.
// - The wake word: saying "Scorpion" starts listening.
import { parseWake, parseYesNo, matchShortcut, nextIndex, callGreeting } from './orb-commands.js';
import { intentsFor, matchSpoken } from '/shared/intents.js';
import { PLATFORM } from './palette.js';
import { ringLook, siteUrl } from './orb-bubbles.js';
import { arrange, ensureWeights, resizeWeights, insertApp, removeApp, moveItem, swapItems, cellAt, sideOfRect, GAP } from '/shared/tiles.js';

// The least a tile may be dragged down to (CSS pixels): app windows have a smallest size of their own.
const MIN_TILE_W = 280;
const MIN_TILE_H = 200;

const IS_WINDOWS = navigator.userAgent.includes('Windows');
const PLACES = [
  { id: 'apps', label: 'Apps', say: ['applications', 'programs', 'start', 'start menu'], windows: true },
  { id: 'files', label: 'Files', say: ['my files', 'file explorer', 'explorer', 'this pc'], windows: true },
  { id: 'library', label: 'Library', say: ['photos', 'my photos', 'pictures', 'music', 'videos'] },
  { id: 'chats', label: 'Chats', say: ['chat', 'conversations', 'messages'] },
  { id: 'people', label: 'People', say: ['faces'] },
  { id: 'settings', label: 'Settings', say: ['preferences', 'options'] },
].filter((p) => !p.windows || IS_WINDOWS);

const GREET_BY_TIME = () => { const h = new Date().getHours(); return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

export function initOrbSystem(ctx) {
  const { api, $, S, IX, V, speaker, toast, errText, listen, sendMessage, setView, closeInteract, startFace, stopFace, FX, desktopUi, renderInteract } = ctx;
  const O = { desktop: false, away: false, framed: null, windows: [], winIndex: -1, lastFocused: null, approval: null, asking: false, wakeListening: false, wakeTimer: 0, pollTimer: 0, eventTimer: 0, greetTimer: 0, pointer: null };

  // ---------- shortcuts ----------
  // As Settings arranges them (orb-bubbles.js): places, your own, open windows.
  // The orb as a voice chat (Settings → Voice and hands): the voice is installed and the setting is on.
  const voiceOnly = () => S.settings.orbVoiceOnly !== false && Boolean(S.voice?.installed);
  // Voice only: no shortcuts around the orb (apps, places, windows).
  // No bubbles around the orb: the apps are tiles, and Scorpion's taskbar on the orb's screen has the rest.
  const items = () => [];
  const showShortcuts = () => {
    IX.orb?.setRingLook?.(ringLook(S.settings.orbBubbles));
    IX.orb?.setSatellites(items());
  };
  // The orb's screen: just the orb, what is said, and how it is listening. The wake word is always on.
  function applyVoiceOnly() {
    const on = voiceOnly();
    document.body.classList.toggle('ix-voice-only', on);
    const hint = $('#ix-hint');
    if (hint && !hint.dataset.full) hint.dataset.full = hint.innerHTML; // the usual hint, kept for when voice-only is off
    if (hint) hint.innerHTML = on ? '<span class="key">Say</span> “Scorpion” and ask <span class="key">Space</span> talk / interrupt <span class="key">Esc</span> leave' : hint.dataset.full;
    if (IX.open) showShortcuts();
  }

  async function refreshWindows() {
    if (!IS_WINDOWS || !IX.open || O.away) return;
    try {
      const list = (await api.shellWindows()).filter((w) => !w.self);
      const key = (l) => l.map((w) => `${w.hwnd}|${w.title}|${Boolean(w.icon)}`).join('\n');
      if (key(list) !== key(O.windows)) { O.windows = list; showShortcuts(); }
    } catch { /* locked: keep the last list */ }
  }

  function caption(text) {
    $('#ix-reply').textContent = text;
  }

  async function activate(item) {
    if (!item) return;
    if (item.kind === 'window') {
      O.winIndex = O.windows.findIndex((w) => w.hwnd === item.hwnd);
      O.lastFocused = item.hwnd;
      caption(`Switching to ${item.label}`);
      await show(item.hwnd);
      return;
    }
    caption(`Opening ${item.label}`);
    if (item.custom) { openOwn(item.custom); return; }
    leaveOrb(() => {
      if (item.id === 'apps') desktopUi.showApps();
      else if (item.id === 'files') desktopUi.showFiles();
      else if (item.id === 'library') $('#open-library').click();
      else if (item.id === 'chats') setView('chat');
      else setView(item.id);
    });
  }

  // A bubble of your own: an app (it opens inside the orb, like the others),
  // a folder (in Scorpion's Files), a website (in your browser) or one of
  // Scorpion's actions (as the command palette runs it).
  async function openOwn(b) {
    try {
      if (b.kind === 'app') await api.shellLaunch({ id: b.target, name: b.label });
      else if (b.kind === 'folder') leaveOrb(() => (desktopUi ? desktopUi.showFiles(b.target) : api.filesOpen(b.target)));
      else if (b.kind === 'site') { const url = siteUrl(b.target); if (url) await api.openLink(url); else throw new Error(`${b.target} isn't a web address`); }
      else if (b.kind === 'action') {
        const it = intentsFor(PLATFORM, { live: Boolean(S.live) }).find((i) => i.id === b.target);
        if (!it) throw new Error(`Scorpion can't do "${b.label}" here`);
        ctx.runIntent?.(it);
      }
    } catch (err) { toast(errText(err), 'error'); }
  }

  // An app inside the orb's panel; one that refuses (an app running as
  // administrator) is just brought to the front.
  async function show(hwnd) {
    const ok = IS_WINDOWS && await api.orbFrame({ frame: hwnd }).catch(() => false);
    if (!ok) await api.shellWindow({ hwnd, action: 'focus' }).catch((err) => toast(errText(err)));
  }

  // ---------- apps as tiles ----------
  // Every app that opens inside the orb gets a tile (shared/tiles.js); the orb keeps a tile of its own,
  // always there. An app that opened on the left of the screen goes left, one on the right goes right, so
  // the orb ends up between them (or beside them): it moves to wherever the apps leave room. Tiles can be
  // moved (the arrows, or dragging a title bar onto another tile) and resized (drag the divider between them).
  O.tiles = { items: ['orb'], weights: null, apps: new Map(), focus: null, layout: null, els: new Map() };
  // The stage: the screen between the status lines above and the controls below.
  function stageRect() {
    const el = $('#interact');
    const w = el.clientWidth || innerWidth;
    const h = el.clientHeight || innerHeight;
    // Room for the taskbar on whichever edge it is (none when it hides by itself); below: the captions and the typing row.
    const ins = ctx.insets?.() || { top: 0, right: 0, bottom: 0, left: 0 };
    return { x: 24 + ins.left, y: 108 + ins.top, w: Math.max(480, w - 48 - ins.left - ins.right), h: Math.max(260, h - 108 - ins.top - ins.bottom - 150) };
  }
  function sendPanel() {
    if (!IS_WINDOWS || !IX.open || S.settings.orbApps === false) return;
    const r = stageRect();
    api.orbFrame({ panel: { x: r.x, y: r.y, width: r.w, height: r.h } }).catch(() => {});
    relayout();
  }
  const appTitle = (id) => O.tiles.apps.get(id)?.title || 'App';
  function tileEl(id) {
    let el = O.tiles.els.get(id);
    if (el) return el;
    el = document.createElement('div');
    el.className = id === 'orb' ? 'ix-tile ix-tile-orb' : id === 'scorpion' ? 'ix-tile ix-tile-page' : 'ix-tile';
    el.dataset.id = id;
    const arrows = '<button type="button" class="ix-btn" data-act="left" title="Move this tile left">◀</button><button type="button" class="ix-btn" data-act="right" title="Move this tile right">▶</button>';
    const pageTile = `<div class="ix-tile-head"><span class="ix-tile-title">Scorpion</span><span class="ix-gap"></span>${arrows}<button type="button" class="ix-btn" data-act="closepage" title="Close this page: the orb stays">✕</button></div><div class="ix-page-body" id="ix-page-body"></div>`;
    el.innerHTML = id === 'scorpion' ? pageTile : id === 'orb'
      ? `<div class="ix-tile-head"><span class="ix-tile-title">Scorpion</span><span class="ix-gap"></span>${arrows}</div>`
      : `<div class="ix-tile-head"><img class="ix-tile-icon" alt="" hidden><span class="ix-tile-title"></span><span class="ix-gap"></span>${arrows}<button type="button" class="ix-btn" data-act="min" title="Tuck this app away (it stays open, minimized)">–</button><button type="button" class="ix-btn" data-act="pop" title="Give this app its normal window">⧉</button><button type="button" class="ix-btn" data-act="close" title="Close the app (it can still ask to save your work)">✕</button></div>`;
    $('#ix-tiles').appendChild(el);
    O.tiles.els.set(id, el);
    return el;
  }
  function dividerEl(key, axis, index) {
    let el = O.tiles.els.get(key);
    if (el) return el;
    el = document.createElement('div');
    el.className = 'ix-div';
    el.dataset.axis = axis;
    el.dataset.index = String(index);
    el.title = 'Drag to resize';
    $('#ix-tiles').appendChild(el);
    O.tiles.els.set(key, el);
    return el;
  }
  const place = (el, r) => { el.style.left = `${r.x}px`; el.style.top = `${r.y}px`; el.style.width = `${r.w}px`; el.style.height = `${r.h}px`; };

  // Work out where everything goes, draw the frames, put the windows there and the orb in its tile.
  function relayout() {
    if (!IX.open) return;
    const T = O.tiles;
    T.weights = ensureWeights(T.weights, T.items);
    const L = arrange(T.items, stageRect(), T.weights);
    T.layout = L;
    T.weights = L.weights;
    const keep = new Set();
    for (const c of L.cells) {
      keep.add(c.id);
      const el = tileEl(c.id);
      place(el, c.rect);
      el.classList.toggle('focus', c.id !== 'orb' && c.id === T.focus);
      if (c.id !== 'orb' && c.id !== 'scorpion') {
        el.querySelector('.ix-tile-title').textContent = appTitle(c.id);
        const icon = T.apps.get(c.id)?.icon;
        const img = el.querySelector('.ix-tile-icon');
        if (icon && img.getAttribute('src') !== icon) img.src = icon;
        img.hidden = !icon;
      }
      el.querySelector('[data-act="left"]').disabled = T.items.indexOf(c.id) === 0;
      el.querySelector('[data-act="right"]').disabled = T.items.indexOf(c.id) === T.items.length - 1;
    }
    for (const d of L.dividers) { const key = `div-${d.axis}${d.index}`; keep.add(key); place(dividerEl(key, d.axis, d.index), d.rect); }
    for (const [key, el] of [...T.els]) if (!keep.has(key)) { el.remove(); T.els.delete(key); }
    // The orb in its tile, or the whole view when it is alone.
    const orb = L.cells.find((c) => c.id === 'orb');
    const apps = T.items.length > 1;
    IX.orb?.setTile(apps ? { cx: orb.body.x + orb.body.w / 2, cy: orb.body.y + orb.body.h / 2, w: orb.body.w, h: orb.body.h } : null);
    $('#ix-tiles').classList.toggle('hidden', !apps);
    $('#interact').classList.toggle('ix-framed', apps);
    // The windows go to their tiles (the newest layout wins in the main process).
    if (IS_WINDOWS) {
      const rects = L.cells.filter((c) => c.id !== 'orb').map((c) => ({ hwnd: c.id, x: c.body.x, y: c.body.y, w: c.body.w, h: c.body.h }));
      if (rects.length) api.orbFrame({ layout: rects }).catch(() => {});
    }
  }

  // The apps framed by the main process (orb-frame.js): newcomers take their side, the closed ones go.
  function onFrameChanged(v) {
    const list = Array.isArray(v) ? v : v ? [v] : [];
    O.framed = list.length ? list : null;
    if (!IX.open) return;
    const T = O.tiles;
    const now = new Set(list.map((x) => String(x.hwnd)));
    let items = T.items.filter((id) => id === 'orb' || id === 'scorpion' || now.has(id));
    for (const a of list) {
      const id = String(a.hwnd);
      if (!items.includes(id)) items = insertApp(items, id, a.orig ? sideOfRect(a.orig, screen.width * (window.devicePixelRatio || 1)) : 'right');
      T.apps.set(id, { title: a.title, icon: O.windows.find((w) => w.hwnd === id)?.icon || T.apps.get(id)?.icon });
      if (a.focus) { T.focus = id; O.lastFocused = id; }
    }
    for (const id of [...T.apps.keys()]) if (!now.has(id)) T.apps.delete(id);
    if (!now.has(T.focus)) T.focus = list[0] ? String(list[0].hwnd) : null;
    T.items = items;
    if (list.length && O.away) returnToOrb(); // an app opened from a place shows in the orb
    O.winIndex = O.windows.findIndex((w) => w.hwnd === T.focus);
    relayout();
  }
  // The buttons of the tiles, the title bars (drag one onto another tile to swap them) and the dividers.
  function wireTiles() {
    const host = $('#ix-tiles');
    host.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      const id = b?.closest('.ix-tile')?.dataset.id;
      if (!b || !id) return;
      const T = O.tiles;
      if (b.dataset.act === 'left' || b.dataset.act === 'right') { T.items = moveItem(T.items, id, b.dataset.act === 'left' ? -1 : 1); relayout(); }
      else if (b.dataset.act === 'closepage') hidePage();
      else appAction({ min: 'minimize', pop: 'popout', close: 'close' }[b.dataset.act], id);
    });
    let drag = null;
    host.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const div = e.target.closest('.ix-div');
      if (div) {
        const T = O.tiles;
        const grid = T.layout.grid;
        const stage = stageRect();
        const axis = div.dataset.axis;
        drag = { kind: 'div', axis, index: Number(div.dataset.index), from: axis === 'col' ? e.clientX : e.clientY, weights: T.weights, total: axis === 'col' ? stage.w - GAP * (grid.cols - 1) : stage.h - GAP * (grid.rows - 1) };
        host.setPointerCapture(e.pointerId);
        div.classList.add('on');
        return;
      }
      const head = e.target.closest('.ix-tile-head');
      if (head && !e.target.closest('button')) {
        drag = { kind: 'tile', id: head.closest('.ix-tile').dataset.id, over: null };
        host.setPointerCapture(e.pointerId);
        head.closest('.ix-tile').classList.add('lifted');
      }
    });
    host.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const T = O.tiles;
      if (drag.kind === 'div') {
        const now = drag.axis === 'col' ? e.clientX : e.clientY;
        T.weights = resizeWeights(drag.weights, drag.axis, drag.index, now - drag.from, drag.total, drag.axis === 'col' ? MIN_TILE_W : MIN_TILE_H);
        relayout();
      } else {
        const over = cellAt(T.layout.cells, e.clientX, e.clientY);
        const id = over && over.id !== drag.id ? over.id : null;
        if (id !== drag.over) { for (const el of T.els.values()) el.classList.remove('drop'); if (id) T.els.get(id)?.classList.add('drop'); drag.over = id; }
      }
    });
    const end = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      for (const el of O.tiles.els.values()) el.classList.remove('drop', 'lifted', 'on');
      if (d.kind === 'tile' && d.over) { O.tiles.items = swapItems(O.tiles.items, d.id, d.over); relayout(); }
    };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
  }
  // A button of a tile, or a spoken "back": minimize, pop out, close, focus, everything away.
  const appAction = (what, hwnd) => api.orbFrame({ action: what, hwnd }).catch((err) => toast(errText(err)));

  // ---------- Scorpion's own pages as a tile ----------
  // Home, the chat, Settings... open as a tile beside the orb, like an app: the orb is always on the screen.
  // The page is the same one as ever (the whole Scorpion window, moved into the tile), so everything in it works.
  const pageOpen = () => O.tiles.items.includes('scorpion');
  function sidebarFor() { // the page's chat list gives way when its tile is narrow
    const T = O.tiles;
    if (!T.ro && typeof ResizeObserver !== 'undefined' && $('#ix-page-body')) {
      T.ro = new ResizeObserver(() => {
        let user = false;
        try { user = localStorage.getItem('sidebarHidden') === '1'; } catch { /* default */ }
        document.body.classList.toggle('sidebar-hidden', user || ($('#ix-page-body')?.clientWidth || 0) < 900);
      });
      T.ro.observe($('#ix-page-body'));
    }
  }
  function showPage() {
    const T = O.tiles;
    const app = document.querySelector('.app');
    if (!app || !IX.open) return;
    if (!pageOpen()) T.items = insertApp(T.items, 'scorpion', 'left');
    relayout(); // makes the tile
    const body = $('#ix-page-body');
    if (body && app.parentNode !== body) { T.pageApp = app; T.pageHome = { parent: app.parentNode, next: app.nextSibling }; body.appendChild(app); }
    sidebarFor();
    document.body.classList.add('orb-paged');
  }
  function hidePage() {
    const T = O.tiles;
    if (T.pageApp && T.pageHome && T.pageApp.parentNode !== T.pageHome.parent) T.pageHome.parent.insertBefore(T.pageApp, T.pageHome.next && T.pageHome.next.parentNode === T.pageHome.parent ? T.pageHome.next : null);
    T.pageApp = null;
    T.pageHome = null;
    T.ro?.disconnect();
    T.ro = null;
    try { document.body.classList.toggle('sidebar-hidden', localStorage.getItem('sidebarHidden') === '1'); } catch { /* default */ }
    document.body.classList.remove('orb-paged');
    T.items = removeApp(T.items, 'scorpion');
    relayout();
  }
  function leaveOrb(open) {
    if (!IX.open) { open(); return; }
    showPage();
    open();
  }

  // Back to the orb alone: Scorpion's page tile closes (the orb never left).
  function returnToOrb() {
    if (!IX.open || !pageOpen()) return false;
    hidePage();
    return true;
  }

  // "Back" / push: return from a place, or put the window you switched to away.
  async function goBack() {
    if (returnToOrb()) return;
    if (O.framed) { caption('Putting the app away'); await appAction('minimize', O.tiles.focus); return; }
    const front = O.windows.find((w) => w.active) || O.windows.find((w) => w.hwnd === O.lastFocused);
    if (front) {
      await api.shellWindow({ hwnd: front.hwnd, action: 'minimize' }).catch(() => {});
      await api.shellShow('desktop').catch(() => {});
    }
  }

  async function swipe(direction) {
    if (!O.windows.length) return;
    O.winIndex = nextIndex(O.winIndex, O.windows.length, direction);
    const w = O.windows[O.winIndex];
    O.lastFocused = w.hwnd;
    caption(`Switching to ${w.title}`);
    await show(w.hwnd);
  }

  // A spoken command the orb handles itself. Returns true if it did.
  function handleSpoken(text) {
    if (!IX.open) return false;
    if (voiceOnly()) return false; // everything said is a question for Scorpion: no opening apps or running intents
    if (O.approval) { answer(parseYesNo(text)); return true; }
    const m = matchShortcut(text, items());
    if (!m) {
      // Anything else Scorpion does in one step ("open Wi-Fi settings", "lock the screen").
      const it = ctx.runIntent && matchSpoken(text, intentsFor(PLATFORM, { live: Boolean(S.live) }));
      if (!it) return false;
      $('#ix-you').textContent = text;
      caption(it.label);
      ctx.runIntent(it);
      return true;
    }
    $('#ix-you').textContent = text;
    if (m.back) goBack(); else activate(m.item);
    return true;
  }

  // Camera gestures (gestures.js): point, tap to pick, swipe, push to go back.
  // The camera covers the middle of what a hand can reach, so it is stretched
  // a little to reach the edges of the view.
  // Hand positions (0..1 across the mirrored camera) on the orb's screen,
  // stretched so a hand in the middle of the camera reaches the edges. The
  // drawn fingertip and the orb's pointer use the same mapping.
  // With the hand as the mouse it is 1.7, as for the real pointer (main.js).
  const reach = () => (ctx.handIsMouse?.() ? 1.7 : 1.9);
  const toView = (p) => [Math.max(-1, Math.min(1, (p.x - 0.5) * reach())), Math.max(-1, Math.min(1, -(p.y - 0.5) * reach()))];
  const DWELL_MS = 1200;

  // Returns which of the orb's own motions it used (an app, a place, or a
  // zoom aimed at a shortcut takes them).
  // The gestures that mean the same everywhere in the orb: a held fist pauses
  // or resumes the hands (so a resting hand does nothing); sweeps, push,
  // thumbs, signs and a still palm. False while paused.
  function handleGlobals(r) {
    if (r.hold === 'fist') togglePause();
    if (O.handsPaused) return false;
    if (r.swipe === 'up') { flash('Home'); goHome(); }
    else if (r.swipe === 'down') { flash('Apps'); activate(PLACES.find((p) => p.id === 'apps') || PLACES[0]); }
    else if (r.swipe) { flash(r.swipe === 'left' ? 'Previous app' : 'Next app'); swipe(r.swipe); }
    if (r.push) { flash('Back'); goBack(); }
    if (r.thumb) thumb(r.thumb);
    if (r.sign === 'three') { const files = PLACES.find((p) => p.id === 'files'); if (files) { flash('Files'); activate(files); } }
    if (r.sign === 'shaka') { flash(V.talk ? 'Stop talking' : 'Talk'); $('#ix-talk').click(); }
    if (r.hold === 'palm') { flash('Stop'); speaker.stop(); toggleGuide(false); }
    return true;
  }
  function togglePause() { O.handsPaused = !O.handsPaused; flash(O.handsPaused ? 'Hands paused' : 'Hands on'); }

  function handleGesture(r) {
    if (!IX.orb) return {};
    if (!handleGlobals(r)) return { rotate: true, zoom: true };
    if (O.away) return ctx.pageGestures?.(r) || { rotate: true, zoom: true }; // a place is open over the orb
    return O.framed ? appGesture(r) : orbGesture(r);
  }

  // On the orb: point at a shortcut (hold to open it), tap or "zoom in" to
  // open it, both hands spread while aiming at one fly into it, two fingers
  // turn the rings.
  function orbGesture(r) {
    const now = performance.now();
    if (r.pointer) {
      const id = IX.orb.pointAt(...toView(r.pointer));
      if (id) O.lastHover = { id, at: now };
      // Dwell: keep pointing at the same shortcut to open it.
      if (id && O.dwell?.id === id) {
        O.dwellProgress = Math.min(1, (now - O.dwell.since) / DWELL_MS);
        if (O.dwellProgress >= 1 && !O.dwell.done) {
          O.dwell.done = true;
          const item = items().find((i) => i.id === id);
          if (item) { flash(item.label); activate(item); }
        }
      } else { O.dwell = id ? { id, since: now } : null; O.dwellProgress = 0; }
    } else if (r.pose && r.pose !== 'point') { IX.orb.pointAt(null); O.dwell = null; O.dwellProgress = 0; }
    const pick = r.tap || r.bloom;
    if (pick) {
      const id = IX.orb.pick(...toView(pick));
      const item = id && items().find((i) => i.id === id);
      if (item) { flash(r.bloom ? `Zoom into ${item.label}` : item.label); activate(item); }
      // The constellation map: a project, an item or the star under the hand.
      else if (IX.orb.tap?.(...toView(pick))) flash('Open');
    }
    if (r.scroll) IX.orb.spinRings(r.scroll * 0.25);
    // Both hands, spreading, right after pointing at a shortcut: fly into it
    // and open it. Without a shortcut aimed at, it zooms the orb.
    if (r.mode === 'zoom') {
      O.zoomIn ??= { target: O.lastHover && now - O.lastHover.at < 2500 ? O.lastHover.id : null, acc: 0 };
      if (O.zoomIn.target && r.zoom) {
        O.zoomIn.acc += -Math.log(r.zoom);
        if (O.zoomIn.acc < -0.25) { O.zoomIn.target = null; IX.orb.zoomToward(null); return {}; }
        IX.orb.zoomToward(O.zoomIn.target, Math.max(0, O.zoomIn.acc / 0.5));
        if (O.zoomIn.acc >= 0.5) {
          const item = items().find((i) => i.id === O.zoomIn.target);
          O.zoomIn.target = null;
          if (item) { flash(`Zoom into ${item.label}`); activate(item); }
          setTimeout(() => IX.orb?.zoomToward(null), 400);
        }
      }
      return O.zoomIn.target ? { zoom: true } : {};
    }
    if (O.zoomIn) { if (O.zoomIn.target) IX.orb.zoomToward(null); O.zoomIn = null; }
    return {};
  }

  // Inside an app: the air mouse. Point to move the pointer, tap to click,
  // "zoom in" (fist, then open) to double-click, middle-finger tap to right-click, pinch
  // and move to drag, two fingers to scroll, both hands to zoom the app.
  function appGesture(r) {
    moveCursor(null);
    const send = (cmd) => api.orbMouse(cmd).catch(() => {});
    // Every frame's move (orb-frame.js sends only the newest one waiting).
    if (r.pointer && performance.now() - (O.lastMove || 0) > 12) { O.lastMove = performance.now(); send({ move: r.pointer }); }
    if (r.tap) { flash('Click'); send({ click: 'left', at: r.tap }); }
    if (r.rightTap) { flash('Right-click'); send({ click: 'right', at: r.rightTap }); }
    if (r.bloom) { flash('Open'); send({ click: 'double', at: r.bloom }); }
    if (r.drag) send({ drag: r.drag.phase, at: r.drag });
    if (r.scroll) {
      O.wheel = (O.wheel || 0) + r.scroll;
      const n = Math.trunc(O.wheel);
      if (n) { O.wheel -= n; send({ wheel: n }); }
    }
    if (r.zoom) {
      // Spreading the hands (factor below 1) zooms the app in: Ctrl + wheel.
      O.zoomAcc = (O.zoomAcc || 0) - Math.log(r.zoom) * 8;
      const n = Math.trunc(O.zoomAcc);
      if (n) { O.zoomAcc -= n; flash(n > 0 ? 'Zoom in' : 'Zoom out'); send({ wheel: n, ctrl: true }); }
    }
    return { rotate: true, zoom: true };
  }

  // Thumb up or down: the answer to a question; otherwise start or stop talking.
  function thumb(dir) {
    if (O.approval) { flash(dir === 'up' ? 'Yes' : 'No'); answer(dir === 'up'); return; }
    if (dir === 'up' && !V.talk) { flash('Talk'); $('#ix-talk').click(); }
    else if (dir === 'down' && (V.talk || speaker.busy)) { flash('Stop'); if (V.talk) $('#ix-talk').click(); else speaker.stop(); }
  }

  // Home: everything back to the orb (apps wait, minimized).
  async function goHome() {
    returnToOrb();
    if (O.framed) await appAction('minimizeAll');
    IX.orb?.resetView();
    caption('Home');
  }

  function toggleGuide(on) {
    const el = $('#ix-guide');
    el.classList.toggle('hidden', on === undefined ? !el.classList.contains('hidden') : !on);
  }

  function flash(text) {
    const el = $('#ix-gesture-flash');
    if (!el) return;
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(O.flashTimer);
    O.flashTimer = setTimeout(() => el.classList.remove('on'), 900);
  }

  function moveCursor(x, y) {
    const c = $('#ix-pointer');
    if (x == null) { c.classList.add('hidden'); return; }
    c.classList.remove('hidden');
    c.style.left = `${((x + 1) / 2) * 100}%`;
    c.style.top = `${((1 - y) / 2) * 100}%`;
  }

  // Mouse: hover highlights, a click (not a drag) picks.
  function wireMouse() {
    const stage = $('#ix-stage');
    const at = (e) => { const r = stage.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)]; };
    let down = null;
    stage.addEventListener('pointermove', (e) => { const id = IX.orb?.pointAt(...at(e)); stage.style.cursor = id ? 'pointer' : ''; });
    stage.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    stage.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      const id = IX.orb?.pick(...at(e));
      if (id) activate(items().find((i) => i.id === id));
    });
  }

  // ---------- spoken approvals ----------
  function onApproval(ev) {
    if (!IX.open) return;
    returnToOrb();
    stopWakeListening(); // the microphone is needed for the answer
    O.approval = ev;
    const what = ev.summary || ev.name;
    $('#ix-approval-text').textContent = `Should I ${lowerFirst(what)}?`;
    $('#ix-approval').classList.remove('hidden');
    renderInteract();
    if (!S.voice?.installed) return;
    O.tries = 0;
    askAloud(`Should I ${lowerFirst(what)}? Say yes or no.`);
  }

  function askAloud(question) {
    O.asking = true;
    speaker.say(question);
    const wait = () => {
      if (!O.approval) { O.asking = false; return; }
      if (speaker.busy || V.transcribing || V.starting) { setTimeout(wait, 150); return; }
      if (O.wakeListening || V.onText) { setTimeout(wait, 150); return; } // the microphone is busy
      listen((text) => {
        if (!O.approval) return;
        const yes = parseYesNo(text);
        if (yes === null && O.tries++ < 1) { askAloud('Please say yes or no.'); return; }
        O.asking = false;
        if (yes !== null) answer(yes);
      });
    };
    setTimeout(wait, 200);
  }

  function answer(yes) {
    const ev = O.approval;
    if (!ev || yes === null) return;
    api.approve({ id: ev.id, approved: yes });
    S.pending.delete(ev.id);
    clearApproval();
    caption(yes ? 'OK.' : 'Cancelled.');
  }

  function clearApproval(id) {
    if (id && O.approval?.id !== id) return;
    O.approval = null;
    O.asking = false;
    $('#ix-approval').classList.add('hidden');
    renderInteract();
  }

  // ---------- PC events ----------
  function onPcEvent(ev) {
    if (!IX.open) return;
    IX.orb?.pulse(ev.level);
    const box = $('#ix-event');
    box.textContent = ev.text;
    box.dataset.level = ev.level;
    box.classList.remove('hidden');
    clearTimeout(O.eventTimer);
    O.eventTimer = setTimeout(() => box.classList.add('hidden'), 8000);
    const busy = speaker.busy || V.transcribing || (S.thread && S.running.has(S.thread.id)) || O.approval;
    if (S.settings.orbSpeakEvents && S.voice?.installed && !busy) speaker.say(ev.text);
  }

  // ---------- greeting at sign-in ----------
  function greetAtSignIn() {
    if (!S.faces?.installed || S.settings.orbGreet === false) return;
    FX.greetOnce = (person) => {
      const lang = (S.settings.voiceLanguage || 'en').toLowerCase();
      const hello = lang === 'en' ? `${GREET_BY_TIME()}, ${person.name}.` : null;
      caption(hello || `${person.name}`);
      return hello;
    };
    startFace();
    // The camera is only for the greeting: off again after a while.
    clearTimeout(O.greetTimer);
    O.greetTimer = setTimeout(() => { if (FX.greetOnce) { FX.greetOnce = null; stopFace(); } }, 30_000);
  }
  // Called by Interact once the greeting was said.
  function greeted() {
    clearTimeout(O.greetTimer);
    O.greetTimer = setTimeout(() => stopFace(), 2500);
  }

  // ---------- the wake word ----------
  // While it's on, Scorpion listens for speech; each thing said is
  // transcribed on this computer and only acted on if it starts with
  // "Scorpion". Nothing is recorded or kept.
  const wakeOn = () => Boolean(IX.open && (S.settings.wakeWord || voiceOnly()) && S.voice?.installed);
  function scheduleWake(ms = 400) {
    clearTimeout(O.wakeTimer);
    if (wakeOn()) O.wakeTimer = setTimeout(wakeTick, ms);
  }
  async function wakeTick() {
    if (!wakeOn()) return;
    const busy = V.talk || V.dictating || V.starting || V.onText || V.transcribing || speaker.busy || O.approval || O.asking || (S.thread && S.running.has(S.thread.id));
    if (busy) { scheduleWake(700); return; }
    O.wakeListening = true;
    renderInteract();
    await listen((text) => {
      O.wakeListening = false;
      const w = parseWake(text);
      if (!w) { scheduleWake(150); return; }
      if (w.command) { run(w.command); return; }
      called();
    });
    // The microphone could not start (the reason was shown): stop trying.
    if (O.wakeListening && !ctx.recorder.active && !V.transcribing) { O.wakeListening = false; V.onText = null; renderInteract(); }
  }
  function stopWakeListening() {
    clearTimeout(O.wakeTimer);
    if (!O.wakeListening) return;
    O.wakeListening = false;
    V.onText = null;
    ctx.recorder.stop();
    renderInteract();
  }
  // Called by name alone: a greeting, then it listens for the request.
  function called() {
    stopWakeListening();
    if (speaker.busy) speaker.stop();
    const hello = callGreeting({ lang: S.settings.voiceLanguage });
    $('#ix-you').textContent = 'Scorpion';
    caption(hello);
    speaker.say(hello);
    const follow = () => {
      if (speaker.busy) { setTimeout(follow, 120); return; }
      listen((cmd) => { if (cmd) run(cmd); else scheduleWake(150); });
    };
    setTimeout(follow, 150);
  }
  function run(text) {
    if (handleSpoken(text)) { scheduleWake(600); return; }
    V.wakeTurn = true; // the reply is spoken
    sendMessage(text, { spoken: true });
    scheduleWake(800);
  }
  async function toggleWake(want) {
    const on = typeof want === 'boolean' ? want : !S.settings.wakeWord;
    if (on && !S.voice?.installed) { toast('The wake word needs the voice download first: Settings → Voice → Install.'); renderWake(); return; }
    S.settings = await api.updateSettings({ wakeWord: on });
    renderWake();
    if (on) { toast('Wake word on. Say "Scorpion" and then what you want.'); scheduleWake(200); }
    else stopWakeListening();
  }
  function renderWake() {
    applyVoiceOnly();
    const b = $('#orb-wake');
    if (b) b.checked = Boolean(S.settings.wakeWord);
  }

  // ---------- open / close ----------
  function onOpen({ desktop = false, signin = false } = {}) {
    O.desktop = desktop;
    O.away = false;
    $('#interact').classList.toggle('ix-desktop', desktop);
    showShortcuts();
    refreshWindows();
    clearInterval(O.pollTimer);
    if (IS_WINDOWS) O.pollTimer = setInterval(refreshWindows, 2500);
    api.pcEvents(true).catch(() => {});
    sendPanel();
    renderWake();
    scheduleWake(800);
    if (signin) greetAtSignIn();
  }
  function onClose() {
    hidePage(); // the Scorpion window goes back where it was
    clearInterval(O.pollTimer);
    stopWakeListening();
    O.away = false;
    O.desktop = false;
    $('#interact').classList.remove('ix-desktop');
    toggleGuide(false);
    clearApproval();
    api.pcEvents(false).catch(() => {});
    if (IS_WINDOWS) api.orbFrame({ panel: null }).catch(() => {}); // apps get their windows back
    onFrameChanged(null);
    $('#interact').classList.remove('ix-framed');
    O.tiles.items = ['orb'];
    O.tiles.weights = null;
    O.tiles.apps.clear();
    for (const el of O.tiles.els.values()) el.remove();
    O.tiles.els.clear();
    $('#ix-tiles').classList.add('hidden');
    IX.orb?.setTile(null);
  }

  // Extra looks for the orb: waiting for the user's answer, or working on the PC.
  function state() {
    if (O.approval) return 'waiting';
    const msg = S.thread?.messages.at(-1);
    const running = S.thread && S.running.has(S.thread.id);
    if (running && msg?.blocks?.some((b) => b.type === 'tool' && b.status === 'running')) return 'acting';
    return null;
  }

  $('#ix-approval-yes').onclick = () => answer(true);
  $('#ix-guide-btn').onclick = () => toggleGuide();
  $('#ix-guide-close').onclick = () => toggleGuide(false);
  wireTiles();
  api.onFrameChanged?.(onFrameChanged);
  window.addEventListener('resize', () => { clearTimeout(O.resizeTimer); O.resizeTimer = setTimeout(sendPanel, 200); });
  $('#ix-approval-no').onclick = () => answer(false);
  $('#orb-wake').onchange = (e) => toggleWake(e.target.checked);
  wireMouse();
  api.onPcEvent?.(onPcEvent);
  // The orb looks calmer while another window is in front (less graphics work).
  window.addEventListener('blur', () => { if (O.desktop) IX.orb?.setFrameCap(ctx.orbFps?.('away') ?? 12); });
  window.addEventListener('focus', () => IX.orb?.setFrameCap(ctx.orbFps?.('on') ?? 60));

  return {
    onOpen, onClose, state, handleSpoken, handleGesture, onApproval, clearApproval, returnToOrb, greeted, scheduleWake, stopWake: stopWakeListening, leave: leaveOrb,
    toggleGuide, goHome, handleGlobals, togglePause,
    // For the taskbar on the orb's screen: a place (Apps, Files) over the orb, a window into a tile of the orb, the stage.
    place: (id) => { const p = PLACES.find((x) => x.id === id); if (p) activate(p); else leaveOrb(() => setView('home')); },
    openWindow: (w) => { if (O.tiles.items.includes(String(w.hwnd))) appAction('focus', String(w.hwnd)); else activate({ kind: 'window', hwnd: w.hwnd, label: w.title }); },
    sendPanel,
    closePage: hidePage,
    get pageOpen() { return pageOpen(); },
    // Settings changed (the orb's bubbles among them): the rings follow.
    refreshShortcuts: () => { if (IX.open) showShortcuts(); },
    applyVoiceOnly,
    get voiceOnly() { return voiceOnly(); },
    get paused() { return Boolean(O.handsPaused); },
    get wakeListening() { return O.wakeListening; },
    get desktop() { return O.desktop; },
    get away() { return O.away; },
  };
}
