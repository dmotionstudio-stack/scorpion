// The Interact orb on the website. assets/orb/orb.js is an exact copy of the
// app's src/renderer/orb.js (a test keeps them the same); this file only puts
// it on the page: a calm one rising over the hero, and one you can play with
// in the ORB section. Each renders only while it's on screen.

import { createOrb } from './orb/orb.js';

const ACCENT = '#f4c51c';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const smallScreen = matchMedia('(max-width: 720px)').matches;

function mount(container, options = {}) {
  let orb;
  try {
    orb = createOrb(container, { accent: ACCENT, quality: smallScreen ? 'low' : 'high' });
  } catch (err) {
    console.warn('Orb unavailable:', err.message);
    container.classList.add('orb-fallback');
    return null;
  }
  if (reduceMotion || options.frameCap) orb.setFrameCap(reduceMotion ? 24 : options.frameCap);
  // Render only while visible, so the page stays light.
  new IntersectionObserver(([entry]) => (entry.isIntersecting ? orb.start() : orb.stop()), { threshold: 0.02 })
    .observe(container);
  container.classList.add('orb-ready');
  return orb;
}

// A voice level that rises and falls like speech, for the demo states.
function speechLevel(t) {
  const syllable = Math.max(0, Math.sin(t * 9.5)) * (0.55 + 0.45 * Math.sin(t * 2.3));
  const phrase = Math.sin(t * 0.9) > -0.35 ? 1 : 0.1;
  return syllable * phrase * 0.8;
}

// ——— Hero: the orb rises over the horizon, follows the pointer, and drifts
// through its states as if mid-conversation.
const heroBox = document.querySelector('[data-hero-orb]');
const hero = heroBox && mount(heroBox, { frameCap: 50 });
if (hero) {
  const cycle = ['standby', 'listening', 'thinking', 'speaking'];
  let step = 0;
  let state = 'standby';
  if (!reduceMotion) {
    setInterval(() => {
      step = (step + 1) % cycle.length;
      state = cycle[step];
      hero.setState(state);
    }, 4200);
    const t0 = performance.now();
    setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      hero.setLevel(state === 'speaking' ? speechLevel(t) : state === 'listening' ? speechLevel(t * 0.8) * 0.5 : 0);
    }, 50);
  }
  addEventListener('pointermove', (e) => {
    hero.setGaze((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
  }, { passive: true });
}

// ——— ORB section: pick a state, point at the shortcuts, spin and zoom.
const STATES = {
  standby: {
    label: 'Standby',
    you: '',
    say: 'Waiting quietly. Say "Scorpion" or press Space to talk.',
  },
  listening: {
    label: 'Listening',
    you: 'Find my tax receipts from March and total them up.',
    say: 'Listening... the orb pulses with your voice.',
  },
  thinking: {
    label: 'Thinking',
    you: 'Find my tax receipts from March and total them up.',
    say: 'Thinking it through on your own computer. Nothing leaves it.',
  },
  acting: {
    label: 'Working',
    you: 'Find my tax receipts from March and total them up.',
    say: 'Searching Documents, reading 14 PDFs, adding up the amounts...',
  },
  waiting: {
    label: 'Asking you',
    you: '',
    say: 'I found 14 receipts. Save the total to a spreadsheet in Documents? Thumbs up for yes.',
  },
  speaking: {
    label: 'Speaking',
    you: '',
    say: 'Done. Your March receipts come to $1,284.50, saved in March-receipts.xlsx.',
  },
};

const SHORTCUTS = [
  { id: 'chat', label: 'Chat', kind: 'tool', about: 'Ask anything. Answers stream in from a model running on your machine.' },
  { id: 'agent', label: 'Agent', kind: 'tool', about: 'Reads, writes and edits files and runs commands, asking before anything risky.' },
  { id: 'voice', label: 'Voice', kind: 'tool', about: 'Hands-free conversation with Whisper and Kokoro, in 22 languages.' },
  { id: 'docs', label: 'Documents', kind: 'tool', about: 'Chat with your PDFs and Word files. It names its sources.' },
  { id: 'memory', label: 'Memory', kind: 'tool', about: 'Remembers your name, projects and preferences across chats. You can erase it.' },
  { id: 'team', label: 'Agents', kind: 'tool', about: 'Coder, Researcher, Writer, Analyst, Organizer and Reviewer work together.' },
  { id: 'schedule', label: 'Schedule', kind: 'tool', about: 'Agents that run every morning, on a timer, or when files change.' },
  { id: 'people', label: 'People', kind: 'tool', about: 'Optional face recognition: it greets people by name and can lock Scorpion to you.' },
];

const demoBox = document.querySelector('[data-demo-orb]');
const demo = demoBox && mount(demoBox);
if (demo) {
  // The shortcut ring is wider than a phone screen, so phones get the orb alone.
  if (!smallScreen) demo.setSatellites(SHORTCUTS.map(({ id, label, kind }) => ({ id, label, kind })));
  else document.querySelector('.orb-hint').textContent = 'Drag to spin. Pick a state to see how the orb reacts.';

  // Let the page scroll over the orb: the wheel never reaches its controls
  // (zoom has buttons), and on touch screens vertical swipes scroll the page.
  demoBox.addEventListener('wheel', (e) => e.stopPropagation(), { capture: true });
  const canvas = demoBox.querySelector('canvas');
  if (canvas) canvas.style.touchAction = 'pan-y';

  const youEl = document.querySelector('[data-demo-you]');
  const sayEl = document.querySelector('[data-demo-say]');
  const stateEl = document.querySelector('[data-demo-state]');
  const infoEl = document.querySelector('[data-demo-info]');
  const buttons = [...document.querySelectorAll('[data-orb-state]')];
  let current = 'standby';
  let auto = !reduceMotion;

  function setState(name) {
    current = name;
    const s = STATES[name];
    demo.setState(name);
    stateEl.textContent = s.label;
    youEl.textContent = s.you;
    youEl.hidden = !s.you;
    sayEl.textContent = s.say;
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.orbState === name)));
    if (name === 'speaking' || name === 'waiting') demo.pulse(name === 'speaking' ? 'ok' : 'info');
  }

  buttons.forEach((b) => b.addEventListener('click', () => { auto = false; setState(b.dataset.orbState); }));

  const order = ['standby', 'listening', 'thinking', 'acting', 'waiting', 'speaking'];
  setInterval(() => { if (auto) setState(order[(order.indexOf(current) + 1) % order.length]); }, 3800);

  const t0 = performance.now();
  setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    demo.setLevel(current === 'speaking' ? speechLevel(t) : current === 'listening' ? speechLevel(t * 0.8) * 0.6 : 0);
  }, 50);

  // Point at a shortcut to highlight it; click to read what it does.
  const toView = (e) => {
    const r = demoBox.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
  };
  let downAt = null;
  demoBox.addEventListener('pointermove', (e) => {
    const id = demo.pointAt(...toView(e));
    demoBox.style.cursor = id ? 'pointer' : 'grab';
  });
  demoBox.addEventListener('pointerleave', () => demo.pointAt(null));
  demoBox.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  demoBox.addEventListener('pointerup', (e) => {
    // A drag spins the orb; only a tap opens a shortcut.
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    const id = demo.pick(...toView(e));
    const item = SHORTCUTS.find((s) => s.id === id);
    if (!item) return;
    demo.pulse('info');
    infoEl.innerHTML = '';
    const title = document.createElement('b');
    title.textContent = item.label;
    infoEl.append(title, document.createTextNode(` ${item.about}`));
    infoEl.hidden = false;
  });

  document.querySelector('[data-orb-zoom-in]')?.addEventListener('click', () => demo.zoomIn());
  document.querySelector('[data-orb-zoom-out]')?.addEventListener('click', () => demo.zoomOut());
  document.querySelector('[data-orb-reset]')?.addEventListener('click', () => demo.resetView());

  setState('standby');
}
