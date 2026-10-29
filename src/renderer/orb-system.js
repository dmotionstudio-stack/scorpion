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
import { parseWake, parseYesNo, matchShortcut, nextIndex } from './orb-commands.js';
import { intentsFor, matchSpoken } from '/shared/intents.js';
import { PLATFORM } from './palette.js';

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
  const items = () => [
    ...PLACES.map((p) => ({ ...p, kind: 'tool' })),
    ...O.windows.map((w) => ({ id: `w:${w.hwnd}`, kind: 'window', label: w.title, app: w.process, icon: w.icon, hwnd: w.hwnd, exe: w.exe })),
  ];
  const showShortcuts = () => IX.orb?.setSatellites(items());

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
    leaveOrb(() => {
      if (item.id === 'apps') desktopUi.showApps();
      else if (item.id === 'files') desktopUi.showFiles();
      else if (item.id === 'library') $('#open-library').click();
      else if (item.id === 'chats') setView('chat');
      else setView(item.id);
    });
  }

  // An app inside the orb's panel; one that refuses (an app running as
  // administrator) is just brought to the front.
  async function show(hwnd) {
    const ok = IS_WINDOWS && await api.orbFrame({ frame: hwnd }).catch(() => false);
    if (!ok) await api.shellWindow({ hwnd, action: 'focus' }).catch((err) => toast(errText(err)));
  }

  // The panel: the left of the screen between the status lines and the
  // controls. The page draws its frame; the app's window is placed inside.
  function panelRect() {
    const x = 24;
    const y = 148;
    const h = $('#interact').clientHeight || innerHeight; // above Scorpion's taskbar in full mode
    return { x, y, width: Math.max(320, Math.round(innerWidth * 0.64) - x), height: Math.max(240, h - y - 178) };
  }
  function sendPanel() {
    if (!IS_WINDOWS || !IX.open || S.settings.orbApps === false) return;
    const r = panelRect();
    const el = $('#interact');
    for (const [k, v] of Object.entries({ x: r.x, y: r.y, w: r.width, h: r.height })) el.style.setProperty(`--app-${k}`, `${v}px`);
    api.orbFrame({ panel: r }).catch(() => {});
  }
  function onFrameChanged(v) {
    O.framed = v;
    if (!IX.open) return;
    if (v && O.away) returnToOrb(); // an app opened from a place shows in the orb
    $('#interact').classList.toggle('ix-framed', Boolean(v));
    $('#ix-app').classList.toggle('hidden', !v);
    IX.orb?.setCompact(Boolean(v));
    if (!v) return;
    $('#ix-app-title').textContent = v.title;
    const icon = O.windows.find((w) => w.hwnd === v.hwnd)?.icon;
    if (icon) $('#ix-app-icon').src = icon;
    $('#ix-app-icon').hidden = !icon;
    O.lastFocused = v.hwnd;
    O.winIndex = O.windows.findIndex((w) => w.hwnd === v.hwnd);
  }
  const appAction = (what) => api.orbFrame({ action: what }).catch((err) => toast(errText(err)));

  // As the desktop, places open over the orb and "back" returns to it; in a
  // normal Interact session they just close Interact.
  function leaveOrb(open) {
    if (!O.desktop) { closeInteract(); open(); return; }
    if (IS_WINDOWS) api.orbFrame({ away: true }).catch(() => {}); // the app waits, minimized
    O.away = true;
    $('#interact').classList.add('hidden');
    IX.orb?.stop();
    showMini();
    open();
  }

  // ---------- the floating mini orb ----------
  // While the orb is minimized (or a place is open over it), a small orb floats
  // on the screen: click it to bring the orb back, drag it anywhere (where it
  // goes is remembered on this computer).
  function showMini() {
    const m = $('#mini-orb');
    try { const p = JSON.parse(localStorage.getItem('miniOrbAt') || 'null'); if (p) placeMini(p.x, p.y); } catch { /* default corner */ }
    m.classList.remove('hidden');
  }
  const hideMini = () => $('#mini-orb').classList.add('hidden');
  function placeMini(x, y) {
    const m = $('#mini-orb');
    const size = 72;
    m.style.left = `${Math.max(4, Math.min(innerWidth - size - 4, x))}px`;
    m.style.top = `${Math.max(4, Math.min(innerHeight - size - 4, y))}px`;
    m.style.right = 'auto';
    m.style.bottom = 'auto';
  }
  function wireMini() {
    const m = $('#mini-orb');
    let drag = null;
    m.addEventListener('pointerdown', (e) => { const r = m.getBoundingClientRect(); drag = { x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false }; m.setPointerCapture(e.pointerId); });
    m.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      drag.moved = true;
      m.classList.add('dragging');
      placeMini(e.clientX - drag.dx, e.clientY - drag.dy);
    });
    m.addEventListener('pointerup', () => {
      const d = drag;
      drag = null;
      m.classList.remove('dragging');
      if (!d) return;
      if (d.moved) { const r = m.getBoundingClientRect(); try { localStorage.setItem('miniOrbAt', JSON.stringify({ x: r.left, y: r.top })); } catch { /* not kept */ } return; }
      restoreFromMini();
    });
    m.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); restoreFromMini(); } });
  }
  // Back to the orb: from a place over it, or reopened after minimizing.
  function restoreFromMini() {
    hideMini();
    if (IX.open) returnToOrb(); else ctx.openInteract?.(O.minimizedAs || {});
  }
  // The orb's Minimize button: down to the mini orb.
  function minimize() {
    if (O.desktop) { leaveOrb(() => setView(S.lastMainView && S.lastMainView !== 'chat' ? S.lastMainView : 'home')); return; }
    O.minimizedAs = {};
    closeInteract();
    // Windows: Scorpion's window steps aside and the summon dot floats on the
    // desktop (its wheel's centre brings the orb back).
    if (IS_WINDOWS && S.settings.summonDot !== false) { api.windowMinimize().catch(() => showMini()); return; }
    showMini();
  }

  function returnToOrb() {
    if (!IX.open) return false;
    if (O.away) {
      O.away = false;
      $('#interact').classList.remove('hidden');
      hideMini();
      IX.orb?.start();
      refreshWindows();
      if (IS_WINDOWS) api.orbFrame({ away: false }).catch(() => {}); // and the app it was showing
      return true;
    }
    return false;
  }

  // "Back" / push: return from a place, or put the window you switched to away.
  async function goBack() {
    if (returnToOrb()) return;
    if (O.framed) { caption('Back to the orb'); await appAction('orb'); return; }
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
    if (r.pointer && performance.now() - (O.lastMove || 0) > 33) { O.lastMove = performance.now(); send({ move: r.pointer }); }
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
    if (O.framed) await appAction('orb');
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
    wireMini();
    $('#ix-min').onclick = minimize;
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
  const wakeOn = () => Boolean(IX.open && S.settings.wakeWord && S.voice?.installed);
  function scheduleWake(ms = 400) {
    clearTimeout(O.wakeTimer);
    if (wakeOn()) O.wakeTimer = setTimeout(wakeTick, ms);
  }
  async function wakeTick() {
    if (!wakeOn()) return;
    const busy = V.talk || V.starting || V.onText || V.transcribing || speaker.busy || O.approval || O.asking || (S.thread && S.running.has(S.thread.id));
    if (busy) { scheduleWake(700); return; }
    O.wakeListening = true;
    renderInteract();
    await listen((text) => {
      O.wakeListening = false;
      const w = parseWake(text);
      if (!w) { scheduleWake(150); return; }
      if (w.command) { run(w.command); return; }
      // Just the name: answer and listen for the request.
      $('#ix-you').textContent = 'Scorpion';
      speaker.say('Yes?');
      const follow = () => {
        if (speaker.busy) { setTimeout(follow, 120); return; }
        listen((cmd) => { if (cmd) run(cmd); else scheduleWake(150); });
      };
      setTimeout(follow, 150);
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
  function run(text) {
    if (handleSpoken(text)) { scheduleWake(600); return; }
    V.wakeTurn = true; // the reply is spoken
    sendMessage(text, { spoken: true });
    scheduleWake(800);
  }
  async function toggleWake() {
    const on = !S.settings.wakeWord;
    if (on && !S.voice?.installed) { toast('The wake word needs the voice download first: Settings → Voice → Install.'); return; }
    S.settings = await api.updateSettings({ wakeWord: on });
    renderWake();
    if (on) { toast('Wake word on. Say "Scorpion" and then what you want.'); scheduleWake(200); }
    else stopWakeListening();
  }
  function renderWake() {
    const b = $('#ix-wake');
    b.setAttribute('aria-pressed', String(Boolean(S.settings.wakeWord)));
    b.textContent = S.settings.wakeWord ? 'Wake word on' : 'Wake word off';
  }

  // ---------- open / close ----------
  function onOpen({ desktop = false, signin = false } = {}) {
    O.desktop = desktop;
    O.away = false;
    $('#interact').classList.toggle('ix-desktop', desktop);
    hideMini();
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
    clearInterval(O.pollTimer);
    stopWakeListening();
    O.away = false;
    O.desktop = false;
    hideMini();
    $('#interact').classList.remove('ix-desktop');
    toggleGuide(false);
    clearApproval();
    api.pcEvents(false).catch(() => {});
    if (IS_WINDOWS) api.orbFrame({ panel: null }).catch(() => {}); // apps get their windows back
    onFrameChanged(null);
    $('#interact').classList.remove('ix-framed');
    $('#ix-app').classList.add('hidden');
    IX.orb?.setCompact(false);
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
  $('#ix-app-prev').onclick = () => appAction('prev');
  $('#ix-guide-btn').onclick = () => toggleGuide();
  $('#ix-guide-close').onclick = () => toggleGuide(false);
  $('#ix-app-next').onclick = () => appAction('next');
  $('#ix-app-orb').onclick = () => appAction('orb');
  $('#ix-app-pop').onclick = () => appAction('popout');
  $('#ix-app-close').onclick = () => appAction('close');
  api.onFrameChanged?.(onFrameChanged);
  window.addEventListener('resize', () => { clearTimeout(O.resizeTimer); O.resizeTimer = setTimeout(sendPanel, 200); });
  $('#ix-approval-no').onclick = () => answer(false);
  $('#ix-wake').onclick = toggleWake;
  wireMouse();
  api.onPcEvent?.(onPcEvent);
  // The orb looks calmer while another window is in front (less graphics work).
  window.addEventListener('blur', () => { if (O.desktop) IX.orb?.setFrameCap(ctx.orbFps?.('away') ?? 12); });
  window.addEventListener('focus', () => IX.orb?.setFrameCap(ctx.orbFps?.('on') ?? 60));

  return {
    onOpen, onClose, state, handleSpoken, handleGesture, onApproval, clearApproval, returnToOrb, greeted, scheduleWake, stopWake: stopWakeListening, leave: leaveOrb,
    toggleGuide, goHome, handleGlobals, togglePause,
    get paused() { return Boolean(O.handsPaused); },
    get wakeListening() { return O.wakeListening; },
    get desktop() { return O.desktop; },
    get away() { return O.away; },
  };
}
