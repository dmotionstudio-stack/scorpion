// The page a phone or another computer opens to see and work this computer. It talks only to the Scorpion that served it.
(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN = 'scorpion-remote-token';
  let device = null;
  let session = null;
  let size = { w: 1, h: 1 };
  let live = false;
  const sticky = { ctrl: false, alt: false, meta: false };
  const store = { get: () => { try { return localStorage.getItem(TOKEN); } catch { return null; } }, set: (v) => { try { v ? localStorage.setItem(TOKEN, v) : localStorage.removeItem(TOKEN); } catch { /* private mode */ } } };

  const show = (which) => { for (const id of ['pairBox', 'waitBox']) $(id).hidden = id !== which; $('stage').hidden = $('bar').hidden = which !== 'screen'; };
  const say = (t) => { $('msg').textContent = t || ''; };
  async function api(path, body, token) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(j.error || `Error ${res.status}`); e.status = res.status; throw e; }
    return j;
  }

  async function pair() {
    say('');
    try {
      const j = await api('/pair', { code: $('code').value.trim(), name: $('devname').value.trim() });
      store.set(j.token);
      device = j.token;
      connect();
    } catch (err) { say(err.message); }
  }

  async function connect() {
    device = device || store.get();
    if (!device) return show('pairBox');
    show('waitBox');
    $('waitText').textContent = 'Someone at the computer must press Allow.';
    try {
      session = (await api('/session', {}, device)).session;
    } catch (err) {
      if (err.status === 401) { store.set(null); device = null; show('pairBox'); say(err.message); return; }
      show('pairBox'); say(err.message); return;
    }
    show('screen');
    live = true;
    loop();
  }

  async function loop() {
    const view = $('view');
    while (live) {
      const t0 = performance.now();
      if (document.hidden) { await new Promise((r) => setTimeout(r, 500)); continue; }
      try {
        const res = await fetch('/frame', { headers: { Authorization: `Bearer ${session}` } });
        if (!res.ok) throw Object.assign(new Error('over'), { status: res.status });
        size = { w: Number(res.headers.get('X-Screen-Width')) || size.w, h: Number(res.headers.get('X-Screen-Height')) || size.h };
        const url = URL.createObjectURL(await res.blob());
        await new Promise((r) => { view.onload = view.onerror = r; view.src = url; });
        URL.revokeObjectURL(url);
      } catch (err) {
        if (err.status === 401) { ended('The session is over.'); return; }
        await new Promise((r) => setTimeout(r, 1000));
      }
      await new Promise((r) => setTimeout(r, Math.max(0, 110 - (performance.now() - t0))));
    }
  }

  function ended(text) {
    live = false;
    session = null;
    show('waitBox');
    $('waitText').textContent = `${text} Press Reload to ask the computer again.`;
  }

  // ---------- sending what you do ----------
  let sending = Promise.resolve();
  const send = (body) => {
    if (!session) return;
    sending = sending.then(() => fetch('/input', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` }, body: JSON.stringify(body) }).then((r) => { if (r.status === 401) ended('The session is over.'); }).catch(() => {}));
  };
  const place = (e) => {
    const r = $('view').getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const mods = (extra = {}) => ({ ctrl: sticky.ctrl || Boolean(extra.ctrl), alt: sticky.alt || Boolean(extra.alt), shift: Boolean(extra.shift), meta: sticky.meta || Boolean(extra.meta) });
  const clearSticky = () => { for (const k of Object.keys(sticky)) sticky[k] = false; for (const id of ['bCtrl', 'bAlt', 'bWin']) $(id).classList.remove('on'); };
  const key = (name, extra) => { send({ type: 'key', key: name, mods: mods(extra) }); clearSticky(); };

  let gesture = null;
  const view = $('view');
  view.addEventListener('contextmenu', (e) => e.preventDefault());
  view.addEventListener('pointerdown', (e) => {
    view.setPointerCapture(e.pointerId);
    const p = place(e);
    if (e.pointerType === 'mouse') { send({ type: 'down', ...p, button: e.button === 2 ? 'right' : 'left' }); gesture = { mouse: true, button: e.button === 2 ? 'right' : 'left', last: 0 }; return; }
    gesture = { x0: e.clientX, y0: e.clientY, p, at: Date.now(), dragging: false, last: 0 };
  });
  view.addEventListener('pointermove', (e) => {
    if (!gesture) return;
    const p = place(e);
    const t = Date.now();
    if (gesture.mouse) { if (t - gesture.last > 30) { gesture.last = t; send({ type: 'move', ...p }); } return; }
    if (!gesture.dragging && Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0) > 10) { gesture.dragging = true; send({ type: 'down', ...gesture.p, button: 'left' }); }
    if (gesture.dragging && t - gesture.last > 30) { gesture.last = t; send({ type: 'move', ...p }); }
  });
  view.addEventListener('pointerup', (e) => {
    if (!gesture) return;
    const p = place(e);
    if (gesture.mouse) send({ type: 'up', ...p, button: gesture.button });
    else if (gesture.dragging) send({ type: 'up', ...p, button: 'left' });
    else send({ type: 'click', ...p, button: Date.now() - gesture.at > 550 ? 'right' : 'left', count: 1 }); // a tap; a long press is a right click
    gesture = null;
  });
  view.addEventListener('wheel', (e) => { e.preventDefault(); send({ type: 'wheel', ...place(e), notches: -Math.sign(e.deltaY) * Math.min(5, Math.ceil(Math.abs(e.deltaY) / 100)) }); }, { passive: false });

  // A physical keyboard (a computer's browser).
  document.addEventListener('keydown', (e) => {
    if (!live || e.isComposing || e.key === 'Unidentified' || ['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    e.preventDefault();
    const m = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
    if (e.key.length === 1 && !m.ctrl && !m.alt && !m.meta) send({ type: 'text', text: e.key });
    else send({ type: 'key', key: e.key.length === 1 ? e.key.toLowerCase() : e.key, mods: mods(m) });
  });
  // A phone's keyboard.
  const kb = $('kb');
  kb.addEventListener('input', () => { if (kb.value) send({ type: 'text', text: kb.value }); kb.value = ''; });
  kb.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Backspace') { e.preventDefault(); key(e.key); e.stopPropagation(); } });

  $('bKb').onclick = () => kb.focus();
  for (const [id, name] of [['bEsc', 'Escape'], ['bTab', 'Tab'], ['bEnter', 'Enter'], ['bBack', 'Backspace'], ['bDel', 'Delete'], ['bL', 'ArrowLeft'], ['bU', 'ArrowUp'], ['bD', 'ArrowDown'], ['bR', 'ArrowRight']]) $(id).onclick = () => key(name);
  for (const [id, m] of [['bCtrl', 'ctrl'], ['bAlt', 'alt'], ['bWin', 'meta']]) $(id).onclick = () => { sticky[m] = !sticky[m]; $(id).classList.toggle('on', sticky[m]); };
  $('bUp').onclick = () => send({ type: 'wheel', x: 0.5, y: 0.5, notches: 5 });
  $('bDown').onclick = () => send({ type: 'wheel', x: 0.5, y: 0.5, notches: -5 });
  $('bEnd').onclick = async () => { live = false; try { await api('/end', {}, session); } catch { /* already over */ } ended('Disconnected.'); };
  $('pairBtn').onclick = pair;
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') pair(); });
  $('cancelBtn').onclick = () => location.reload();

  if (store.get()) connect(); else show('pairBox');
})();
