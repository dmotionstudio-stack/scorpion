// Hand gestures on Scorpion's own screens (Home, chats, Files, Apps, Library,
// Settings…), the same gestures as on the orb: point to move a hand cursor,
// quick pinch to click, "zoom in" (fist, then open) to double-click/open,
// middle-finger pinch for the right-click menu, two fingers to scroll; sweeps
// switch apps (left/right), go home (up) or to Apps (down); a push goes back;
// thumbs answer a question or start/stop talking. The orb (and the apps inside
// it) handles its own gestures in orb-system.js.

const CLICKABLE = 'button, a[href], input, select, textarea, label, summary, [role="button"], [data-tool], [data-open-thread], .home-tool, .files-row, .app-tile, .crumb, .thread, .theme-card, [tabindex]:not([tabindex="-1"])';

export function initHandControl({ api, $, S, V, IX, orbSys, setView, desktopUi }) {
  const H = { hover: null, lastMove: 0, flashTimer: 0 };
  const cursor = $('#hand-pointer');

  // Camera positions (0..1) to the window, stretched so the edges are reachable.
  const toWindow = (p) => ({
    x: Math.max(0, Math.min(innerWidth - 1, ((p.x - 0.5) * 1.7 + 0.5) * innerWidth)),
    y: Math.max(0, Math.min(innerHeight - 1, ((p.y - 0.5) * 1.7 + 0.5) * innerHeight)),
  });
  const under = (pt) => {
    cursor.style.visibility = 'hidden'; // never hit the cursor itself
    const el = document.elementFromPoint(pt.x, pt.y);
    cursor.style.visibility = '';
    return el;
  };

  function point(p) {
    const pt = toWindow(p);
    cursor.classList.remove('hidden');
    cursor.style.transform = `translate(${pt.x}px, ${pt.y}px)`;
    const target = under(pt)?.closest(CLICKABLE) || null;
    if (target !== H.hover) {
      H.hover?.classList.remove('hand-hover');
      target?.classList.add('hand-hover');
      H.hover = target;
    }
  }
  function hideCursor() {
    cursor.classList.add('hidden');
    H.hover?.classList.remove('hand-hover');
    H.hover = null;
  }

  function click(p) {
    const pt = toWindow(p);
    const el = under(pt);
    if (!el) return;
    const target = el.closest(CLICKABLE) || el;
    target.classList.add('hand-press');
    setTimeout(() => target.classList.remove('hand-press'), 180);
    if (target.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select')) { target.focus(); return; }
    const opts = { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, view: window };
    target.dispatchEvent(new PointerEvent('pointerdown', opts));
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new PointerEvent('pointerup', opts));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    target.click();
  }

  function dblclick(p) {
    const pt = toWindow(p);
    const el = under(pt);
    if (!el) return;
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, view: window }));
  }

  function contextmenu(p) {
    const pt = toWindow(p);
    under(pt)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, button: 2, view: window }));
  }

  // The nearest scrollable box under the hand cursor (or the open page).
  function scroll(lines) {
    const pt = H.lastPoint || { x: innerWidth / 2, y: innerHeight / 2 };
    let el = under(pt);
    while (el && el !== document.body) {
      const st = getComputedStyle(el);
      if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 2) break;
      el = el.parentElement;
    }
    (el && el !== document.body ? el : document.querySelector('section.view:not(.hidden) .page, section.view:not(.hidden)'))?.scrollBy({ top: -lines * 90 }); // instant: scroll gestures arrive many times a second
  }

  // Both hands spreading: open what the hand cursor was on (a folder, an app,
  // a tile); closing them: up a folder in Files, else back.
  function zoom(factor) {
    H.zoom = (H.zoom || 0) - Math.log(factor);
    if (H.zoom > 0.45) {
      H.zoom = 0;
      const el = H.lastPoint && under(H.lastPoint);
      const row = el?.closest('.files-row');
      if (row) { flash('Zoom in: open'); row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); return; }
      const target = el?.closest(CLICKABLE);
      if (target) { flash('Zoom in: open'); target.click(); }
    } else if (H.zoom < -0.45) {
      H.zoom = 0;
      const up = document.querySelector('#view-files:not(.hidden) #files-up:not(:disabled)');
      if (up) { flash('Zoom out: up a folder'); up.click(); } else { flash('Back'); goBack(); }
    }
  }

  // Previous / next of the other open apps (they come to the front).
  async function switchApp(direction) {
    const list = (await api.shellWindows().catch(() => [])).filter((w) => !w.self);
    if (!list.length) return;
    H.winIndex = H.winIndex == null ? -1 : H.winIndex;
    const step = direction === 'left' ? -1 : 1;
    H.winIndex = ((H.winIndex + step) % list.length + list.length) % list.length;
    await api.shellWindow({ hwnd: list[H.winIndex].hwnd, action: 'focus' }).catch(() => {});
  }

  function goHome() {
    if (IX.open) { orbSys.goHome(); return; } // a place over the orb: back to the orb
    setView('home');
  }
  function goBack() {
    if (IX.open && orbSys.away) { orbSys.returnToOrb(); return; }
    if (document.querySelector('.face-capture:not(.hidden), .modal:not(.hidden)')) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return; }
    setView(S.view === 'home' ? 'home' : S.lastMainView && S.lastMainView !== S.view ? S.lastMainView : 'home');
  }

  // Thumb up/down: answer the question waiting in this chat, or talk / stop.
  function thumb(dir) {
    const waiting = [...S.pending.values()].filter((p) => p.threadId === S.thread?.id).pop();
    if (waiting) {
      api.approve({ id: waiting.id, approved: dir === 'up' });
      S.pending.delete(waiting.id);
      flash(dir === 'up' ? 'Yes' : 'No');
      return;
    }
    if (dir === 'up' && !V.talk) { flash('Talk'); $('#talk').click(); }
    else if (dir === 'down' && V.talk) { flash('Stop'); $('#talk').click(); }
  }

  function flash(text) {
    const el = $('#ix-gesture-flash');
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(H.flashTimer);
    H.flashTimer = setTimeout(() => el.classList.remove('on'), 900);
  }

  // One camera frame's gestures, on Scorpion's screens. Returns the orb's own
  // motions it used (all of them: there is no orb on screen).
  function handle(r, { globals = true } = {}) {
    if (r.pointer) {
      H.lastPoint = toWindow(r.pointer);
      if (performance.now() - H.lastMove > 16) { H.lastMove = performance.now(); point(r.pointer); }
    } else if (r.pose && r.pose !== 'point' && !r.drag) hideCursor();
    if (!r.hands) hideCursor();
    if (r.tap) { flash('Click'); click(r.tap); }
    if (r.bloom) { flash('Open'); dblclick(r.bloom); }
    if (r.rightTap) { flash('Menu'); contextmenu(r.rightTap); }
    if (r.scroll) scroll(r.scroll);
    if (r.mode === 'zoom' && r.zoom) zoom(r.zoom); else H.zoom = 0;
    if (globals) handleGlobals(r);
    return { rotate: true, zoom: true };
  }

  // The gestures that mean the same on every screen: sweeps, push, thumbs.
  function handleGlobals(r) {
    if (r.swipe === 'up') { flash('Home'); goHome(); }
    else if (r.swipe === 'down') { flash('Apps'); if (desktopUi && navigator.userAgent.includes('Windows')) desktopUi.showApps(); }
    else if (r.swipe) { flash(r.swipe === 'left' ? 'Previous app' : 'Next app'); switchApp(r.swipe); }
    if (r.push) { flash('Back'); goBack(); }
    if (r.thumb) thumb(r.thumb);
    if (r.sign === 'three' && desktopUi && navigator.userAgent.includes('Windows')) { flash('Files'); desktopUi.showFiles(); }
    if (r.sign === 'shaka') { flash(V.talk ? 'Stop talking' : 'Talk'); $('#talk').click(); }
  }

  return { handle, handleGlobals, hideCursor, flash };
}
