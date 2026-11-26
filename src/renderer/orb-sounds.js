// Soft sounds on the orb (Settings → General → Orb look): a short rising cue when it starts listening, and a gentle
// chime when it finishes thinking. Made with the Web Audio API, so there is nothing to download; quiet on purpose.
// There is no hum while it listens: the microphone would hear it and it would spoil what you say.

// Which sound a change of state gets: 'listen' | 'done' | null.
export function soundFor(prev, next) {
  if (prev === next) return null;
  if (next === 'listening') return 'listen';
  if (prev === 'thinking' && (next === 'speaking' || next === 'standby')) return 'done';
  return null;
}

// A note: a sine with a soft attack and a long decay.
function note(ctx, when, freq, length, peak) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(peak, when + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + length + 0.05);
}

export function createOrbSounds() {
  let ctx = null;
  const context = () => {
    try { ctx ??= new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  };
  return {
    play(kind) {
      const c = context();
      if (!c || !kind) return;
      const t = c.currentTime + 0.02;
      if (kind === 'listen') { note(c, t, 523.25, 0.22, 0.035); note(c, t + 0.1, 783.99, 0.3, 0.03); } // C5 then G5, rising
      else if (kind === 'done') { note(c, t, 880, 0.5, 0.04); note(c, t + 0.12, 659.25, 0.7, 0.03); } // A5 then E5, settling
    },
  };
}
