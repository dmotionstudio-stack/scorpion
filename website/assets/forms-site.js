// The orb and the humanoid on the website: the same two forms as in the app (assets/orb/orb.js and assets/orb/humanoid.js are
// exact copies of the app's, a test keeps them the same), and the same slow transformation between them. The orb folds into a
// point of light and the humanoid grows from it; the humanoid folds into its heart and the orb swells out of that point.
// Renders only while it is on screen.

import { createOrb } from './orb/orb.js';

const ACCENT = '#f4c51c';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const smallScreen = matchMedia('(max-width: 720px)').matches;
const HEART_AT = '50% 81%'; // where the humanoid's heart is on its screen: what everything folds into and grows from

const box = document.querySelector('[data-forms]');

const STATES = {
  standby: { label: 'Standby', say: 'Waiting quietly. Say "Scorpion" and ask.' },
  listening: { label: 'Listening', say: 'Listening: it leans in, turns the opposite colour, and rings of sound close in on it.' },
  thinking: { label: 'Thinking', say: 'Thinking it through on your own computer. Nothing leaves it.' },
  speaking: { label: 'Speaking', say: 'Speaking: light runs up its body in time with the voice.' },
};
const CAPTION = {
  humanoid: 'Say "show me the orb" to change it back.',
  orb: 'Say "transform into the humanoid" and it becomes one.',
};

// A voice level that rises and falls like speech, for the demo states.
function speechLevel(t) {
  const syllable = Math.max(0, Math.sin(t * 9.5)) * (0.55 + 0.45 * Math.sin(t * 2.3));
  const phrase = Math.sin(t * 0.9) > -0.35 ? 1 : 0.1;
  return syllable * phrase * 0.8;
}

async function make(which, stage) {
  const quality = smallScreen ? 'low' : 'high';
  if (which === 'humanoid') {
    const { createHumanoid } = await import('./orb/humanoid.js');
    return createHumanoid(stage, { accent: ACCENT, quality, lines: 'subtle' });
  }
  return createOrb(stage, { accent: ACCENT, quality });
}

async function init() {
  const stage = box.querySelector('[data-forms-stage]');
  const hud = box.querySelector('[data-forms-state]');
  const sayEl = box.querySelector('[data-forms-say]');
  const hintEl = box.querySelector('[data-forms-hint]');
  const switchBtn = box.querySelector('[data-forms-switch]');
  const replayBtn = box.querySelector('[data-forms-replay]');
  const chips = [...box.querySelectorAll('[data-forms-state-btn]')];

  let form = 'humanoid';
  let current;
  try {
    current = await make(form, stage);
  } catch (err) {
    console.warn('The humanoid is unavailable:', err.message);
    stage.classList.add('orb-fallback');
    return;
  }
  stage.classList.add('orb-ready');
  const cap = reduceMotion ? 24 : 50;
  current.setFrameCap(cap);

  let visible = false;
  let state = 'standby';
  let auto = !reduceMotion;
  let busy = false;
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) current.start(); else current.stop();
  }, { threshold: 0.05 }).observe(stage);

  function setState(name) {
    state = name;
    const s = STATES[name];
    current.setState(name);
    hud.textContent = s.label;
    sayEl.textContent = s.say;
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.formsStateBtn === name)));
    if (name === 'speaking') current.pulse?.('ok');
  }
  chips.forEach((c) => c.addEventListener('click', () => { auto = false; setState(c.dataset.formsStateBtn); }));
  if (!reduceMotion) {
    const order = Object.keys(STATES);
    let step = 0;
    setInterval(() => { if (auto && visible && !busy) { step = (step + 1) % order.length; setState(order[step]); } }, 4600);
    const t0 = performance.now();
    setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      current.setLevel(state === 'speaking' ? speechLevel(t) : state === 'listening' ? speechLevel(t * 0.8) * 0.5 : 0);
    }, 50);
  }

  // It follows the pointer over the stage.
  stage.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect();
    current.pointAt?.(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  });
  stage.addEventListener('pointerleave', () => current.pointAt?.(null));
  stage.addEventListener('wheel', (e) => e.stopPropagation(), { capture: true }); // the page scrolls over it
  const canvas = stage.querySelector('canvas');
  if (canvas) canvas.style.touchAction = 'pan-y';

  // The transformation (the same as the app's: switchLook in src/renderer/app.js).
  async function transform(to) {
    if (busy || to === form) return;
    busy = true;
    switchBtn.disabled = true;
    const toHumanoid = to === 'humanoid';
    const old = current;
    const before = [...stage.querySelectorAll('canvas')];
    const started = performance.now();
    const OUT = toHumanoid ? 2400 : 2700;
    if (toHumanoid) {
      for (const c of before) {
        c.style.transformOrigin = HEART_AT;
        c.style.mixBlendMode = 'screen';
        c.animate([
          { transform: 'scale(1)', filter: 'brightness(1)', opacity: 1, offset: 0 },
          { transform: 'scale(1.07)', filter: 'brightness(1.6)', offset: 0.18 },
          { transform: 'scale(0.3)', filter: 'brightness(2)', offset: 0.75 },
          { transform: 'scale(0.04)', filter: 'brightness(2.4)', opacity: 1, offset: 0.97 },
          { transform: 'scale(0.02)', filter: 'brightness(2.4)', opacity: 0, offset: 1 },
        ], { duration: OUT, easing: 'ease-in-out', fill: 'forwards' });
      }
    } else old.outro?.(OUT / 1000);
    const seed = document.createElement('div');
    seed.className = 'forms-seed';
    stage.appendChild(seed);
    seed.animate([{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 1, transform: 'scale(1)', offset: 0.3 }, { opacity: 0.8, transform: 'scale(0.8)', offset: 0.65 }, { opacity: 1, transform: 'scale(1)' }],
      { duration: 1400, delay: toHumanoid ? OUT * 0.62 : 0, iterations: Infinity, direction: 'alternate', fill: 'backwards' });
    let fresh;
    try {
      fresh = await make(to, stage);
    } catch (err) {
      seed.remove();
      busy = false;
      switchBtn.disabled = false;
      return;
    }
    const added = [...stage.querySelectorAll('canvas')].filter((c) => !before.includes(c));
    current = fresh;
    form = to;
    fresh.setFrameCap(cap);
    fresh.setState(state);
    if (visible) fresh.start();
    const wait = Math.max(0, OUT - 500 - (performance.now() - started));
    if (toHumanoid) {
      fresh.introduce?.(10, { slow: 1.8, delay: wait / 1000 });
      setTimeout(() => fresh.pulse?.('info'), wait);
      setTimeout(() => { for (const c of before) c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, fill: 'forwards' }); }, wait + 200);
    } else {
      for (const c of added) {
        c.style.transformOrigin = HEART_AT;
        c.style.mixBlendMode = 'screen';
        c.animate([
          { transform: 'scale(0.02)', filter: 'brightness(2.4)', opacity: 0, offset: 0 },
          { opacity: 1, offset: 0.12 },
          { transform: 'scale(0.35)', filter: 'brightness(2)', offset: 0.4 },
          { transform: 'scale(1.1)', filter: 'brightness(1.5)', offset: 0.75 },
          { transform: 'scale(1)', filter: 'brightness(1)', opacity: 1, offset: 1 },
        ], { duration: 3400, delay: wait, easing: 'ease-out', fill: 'both' });
      }
    }
    setTimeout(() => { seed.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, fill: 'forwards' }); setTimeout(() => seed.remove(), 750); }, wait + (toHumanoid ? 250 : OUT + 100));
    setTimeout(() => { try { old.dispose(); } catch { /* already gone */ } }, Math.max(wait + 900, OUT + 150));
    const canvasNow = stage.querySelector('canvas:last-of-type');
    if (canvasNow) canvasNow.style.touchAction = 'pan-y';
    switchBtn.textContent = toHumanoid ? 'Transform into the orb' : 'Transform into the humanoid';
    hintEl.textContent = CAPTION[form];
    replayBtn.hidden = !toHumanoid;
    setTimeout(() => { busy = false; switchBtn.disabled = false; for (const c of added) c.style.mixBlendMode = ''; }, wait + (toHumanoid ? 6400 : 3600));
  }

  switchBtn.addEventListener('click', () => transform(form === 'humanoid' ? 'orb' : 'humanoid'));
  replayBtn.addEventListener('click', () => { if (!busy && form === 'humanoid') current.introduce?.(); });
  setState('standby');
}

if (box) init();
