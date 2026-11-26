// The "two forms" section (the home page and the ORB page): the orb and the humanoid, with state buttons, a Transform button and a
// replay of the humanoid's entrance. The work is in forms-core.js.

import { createForms, reduceMotion, speechLevel } from './forms-core.js';
import { SHORTCUTS } from './orb-shortcuts.js';

const box = document.querySelector('[data-forms]');

const STATES = {
  standby: { label: 'Standby', say: 'Waiting quietly. Say "Scorpion" and ask.' },
  listening: { label: 'Listening', say: 'Listening: it leans in, turns the opposite colour, and rings of sound close in on it.' },
  thinking: { label: 'Thinking', say: 'Thinking it through on your own computer. Nothing leaves it.' },
  speaking: { label: 'Speaking', say: 'Speaking: light runs up its body in time with the voice.' },
};
const HINT = {
  humanoid: 'Say "show me the orb" to change it back.',
  orb: 'Say "transform into the humanoid" and it becomes one.',
};

async function init() {
  const stage = box.querySelector('[data-forms-stage]');
  const hud = box.querySelector('[data-forms-state]');
  const sayEl = box.querySelector('[data-forms-say]');
  const hintEl = box.querySelector('[data-forms-hint]');
  const switchBtn = box.querySelector('[data-forms-switch]');
  const replayBtn = box.querySelector('[data-forms-replay]');
  const chips = [...box.querySelectorAll('[data-forms-state-btn]')];

  let forms;
  try {
    forms = await createForms({
      containers: { orb: stage, humanoid: stage },
      start: 'humanoid',
      satellites: SHORTCUTS, // the apps around the orb (the humanoid has none)
      onChange: ({ form, busy }) => {
        switchBtn.disabled = busy;
        switchBtn.textContent = form === 'humanoid' ? 'Transform into the orb' : 'Transform into the humanoid';
        hintEl.textContent = HINT[form];
        replayBtn.hidden = form !== 'humanoid';
        const canvas = stage.querySelector('canvas:last-of-type');
        if (canvas) canvas.style.touchAction = 'pan-y';
      },
    });
  } catch (err) {
    console.warn('The humanoid is unavailable:', err.message);
    stage.classList.add('orb-fallback');
    return;
  }
  stage.classList.add('orb-ready');
  const canvas = stage.querySelector('canvas');
  if (canvas) canvas.style.touchAction = 'pan-y';

  let state = 'standby';
  let auto = !reduceMotion;
  function setState(name) {
    state = name;
    const s = STATES[name];
    forms.setState(name);
    hud.textContent = s.label;
    sayEl.textContent = s.say;
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.formsStateBtn === name)));
    if (name === 'speaking') forms.pulse('ok');
  }
  chips.forEach((c) => c.addEventListener('click', () => { auto = false; setState(c.dataset.formsStateBtn); }));
  if (!reduceMotion) {
    const order = Object.keys(STATES);
    let step = 0;
    setInterval(() => { if (auto && forms.visible && !forms.busy) { step = (step + 1) % order.length; setState(order[step]); } }, 4600);
    const t0 = performance.now();
    setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      forms.setLevel(state === 'speaking' ? speechLevel(t) : state === 'listening' ? speechLevel(t * 0.8) * 0.5 : 0);
    }, 50);
  }

  // It follows the pointer over the stage; the page scrolls over it.
  stage.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect();
    forms.pointAt(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  });
  stage.addEventListener('pointerleave', () => forms.pointAt(null));
  stage.addEventListener('wheel', (e) => e.stopPropagation(), { capture: true });

  switchBtn.addEventListener('click', () => forms.transform(forms.form === 'humanoid' ? 'orb' : 'humanoid'));
  replayBtn.addEventListener('click', () => forms.replay());
  setState('standby');
}

if (box) init();
