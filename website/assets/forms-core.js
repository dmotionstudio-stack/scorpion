// The orb and the humanoid on a page, and the slow transformation between them. assets/orb/orb.js and assets/orb/humanoid.js are
// exact copies of the app's (a test keeps them the same); the transformation is the app's too (switchLook in src/renderer/app.js):
// the orb folds into a point of light and the humanoid grows from it, and the humanoid folds into its heart and the orb swells out
// of that point. Used by the home page's hero and by the "two forms" section (forms-site.js). Renders only while on screen.

import { createOrb } from './orb/orb.js';

const ACCENT = '#f4c51c';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const smallScreen = matchMedia('(max-width: 720px)').matches;

// containers: { orb, humanoid } (the same element is fine): where each form's canvas goes.
// start: the form to begin with. orbOrigin / orbLift(): where the orb folds to and grows from, when its box is not the
// humanoid's (the home page hero): a transform-origin, and how many pixels above that the humanoid's heart is.
export async function createForms({ containers, start = 'humanoid', frameCap = 50, orbOrigin = '50% 81%', orbLift = () => 0, onChange = () => {} }) {
  const box = (which) => containers[which];
  const make = async (which) => {
    const quality = smallScreen ? 'low' : 'high';
    if (which === 'humanoid') {
      const { createHumanoid } = await import('./orb/humanoid.js');
      return createHumanoid(box(which), { accent: ACCENT, quality, lines: 'subtle' });
    }
    return createOrb(box(which), { accent: ACCENT, quality });
  };

  let form = start;
  let current = await make(form);
  const cap = reduceMotion ? 24 : frameCap;
  current.setFrameCap(cap);
  let visible = false;
  let state = 'standby';
  let busy = false;

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) current.start(); else current.stop();
  }, { threshold: 0.05 }).observe(box(start));

  const notify = () => onChange({ form, busy });
  const origin = (which) => (which === 'orb' ? orbOrigin : '50% 81%');
  const lift = () => orbLift() || 0;
  const orbKeyframes = (frames) => frames.map((f) => (f.transform ? { ...f, transform: `translateY(${-lift()}px) ${f.transform}` } : f));

  async function transform(to) {
    if (busy || to === form) return;
    busy = true;
    notify();
    const toHumanoid = to === 'humanoid';
    const old = current;
    const from = form;
    const before = [...box(from).querySelectorAll('canvas')];
    const beforeNew = [...box(to).querySelectorAll('canvas')];
    const started = performance.now();
    const OUT = toHumanoid ? 2400 : 2700;
    if (toHumanoid) {
      for (const c of before) {
        c.style.transformOrigin = origin('orb');
        c.style.mixBlendMode = 'screen';
        c.animate(orbKeyframes([
          { transform: 'scale(1)', filter: 'brightness(1)', opacity: 1, offset: 0 },
          { transform: 'scale(1.07)', filter: 'brightness(1.6)', offset: 0.18 },
          { transform: 'scale(0.3)', filter: 'brightness(2)', offset: 0.75 },
          { transform: 'scale(0.04)', filter: 'brightness(2.4)', opacity: 1, offset: 0.97 },
          { transform: 'scale(0.02)', filter: 'brightness(2.4)', opacity: 0, offset: 1 },
        ]), { duration: OUT, easing: 'ease-in-out', fill: 'forwards' });
      }
    } else old.outro?.(OUT / 1000);
    // The point of light, over the humanoid's heart: it is there from before the orb has quite gone, and stays until the next form grows.
    const seed = document.createElement('div');
    seed.className = 'forms-seed';
    box('humanoid').appendChild(seed);
    seed.animate([{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 1, transform: 'scale(1)', offset: 0.3 }, { opacity: 0.8, transform: 'scale(0.8)', offset: 0.65 }, { opacity: 1, transform: 'scale(1)' }],
      { duration: 1400, delay: toHumanoid ? OUT * 0.62 : 0, iterations: Infinity, direction: 'alternate', fill: 'backwards' });
    let fresh;
    try {
      fresh = await make(to);
    } catch {
      seed.remove();
      busy = false;
      notify();
      return;
    }
    const added = [...box(to).querySelectorAll('canvas')].filter((c) => !beforeNew.includes(c));
    current = fresh;
    form = to;
    fresh.setFrameCap(cap);
    fresh.setState(state);
    if (visible) fresh.start();
    const wait = Math.max(0, OUT - 500 - (performance.now() - started));
    if (toHumanoid) {
      fresh.introduce?.(10, { slow: 1.8, delay: wait / 1000 });
      setTimeout(() => fresh.pulse?.('info'), wait); // a ring of light goes out as the growing begins
      setTimeout(() => { for (const c of before) c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, fill: 'forwards' }); }, wait + 200);
    } else {
      for (const c of added) {
        c.style.transformOrigin = origin('orb');
        c.style.mixBlendMode = 'screen';
        c.animate(orbKeyframes([
          { transform: 'scale(0.02)', filter: 'brightness(2.4)', opacity: 0, offset: 0 },
          { opacity: 1, offset: 0.12 },
          { transform: 'scale(0.35)', filter: 'brightness(2)', offset: 0.4 },
          { transform: 'scale(1.1)', filter: 'brightness(1.5)', offset: 0.75 },
          { transform: 'scale(1)', filter: 'brightness(1)', opacity: 1, offset: 1 },
        ]), { duration: 3400, delay: wait, easing: 'ease-out', fill: 'both' });
      }
    }
    setTimeout(() => { seed.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, fill: 'forwards' }); setTimeout(() => seed.remove(), 750); }, wait + (toHumanoid ? 250 : OUT + 100));
    setTimeout(() => { try { old.dispose(); } catch { /* already gone */ } }, Math.max(wait + 900, OUT + 150));
    notify();
    await new Promise((resolve) => setTimeout(resolve, wait + (toHumanoid ? 6400 : 3600)));
    for (const c of added) c.style.mixBlendMode = '';
    busy = false;
    notify();
  }

  return {
    get current() { return current; },
    get form() { return form; },
    get busy() { return busy; },
    get visible() { return visible; },
    transform,
    setState(name) { state = name; current.setState(name); },
    setLevel(v) { current.setLevel(v); },
    setGaze(x, y) { current.setGaze?.(x, y); },
    pointAt(x, y) { current.pointAt?.(x, y); },
    pulse(kind) { current.pulse?.(kind); },
    replay() { if (!busy && form === 'humanoid') current.introduce?.(); },
  };
}

// A voice level that rises and falls like speech, for the demo states.
export function speechLevel(t) {
  const syllable = Math.max(0, Math.sin(t * 9.5)) * (0.55 + 0.45 * Math.sin(t * 2.3));
  const phrase = Math.sin(t * 0.9) > -0.35 ? 1 : 0.1;
  return syllable * phrase * 0.8;
}

export { reduceMotion };
