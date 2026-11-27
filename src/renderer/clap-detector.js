// Waking by sound: two claps, or one finger snap. A clap or a snap is a very short, loud, hissy burst that dies away at once, which is
// nothing like speech (it goes on, and has a pitch), a fan (it never starts), a keyboard (far quieter) or a door (low, and rings). This
// reads the microphone in 8 ms steps and looks for exactly that. It is plain arithmetic on the samples, with nothing to download, and
// what it hears is never kept.

export const RATE = 16000;
export const HOP = 128; // samples: 8 ms

const MIN_PEAK = 0.06; // how loud a clap has to be (full scale is 1) ...
const FLOOR_FACTOR = 10; // ... and how far above the room's own noise
const CLAP_GAP = [0.16, 0.95]; // seconds between the two claps of a double clap
const REFRACTORY = 0.12; // seconds after an event before the next one can start
const SNAP_PEAK = 0.1;

// The energy of a step, and how hissy it is (the first difference of the samples is large for high frequencies: about 1.4 times the
// energy for white noise, a tenth of it for a low hum).
export function stepFeatures(data, from, to) {
  let sum = 0, diff = 0;
  for (let i = from; i < to; i++) {
    sum += data[i] * data[i];
    if (i > 0) { const d = data[i] - data[i - 1]; diff += d * d; }
  }
  const n = to - from;
  const rms = Math.sqrt(sum / n);
  return { rms, hiss: rms > 1e-6 ? Math.sqrt(diff / n) / rms : 0 };
}

export class ClapDetector {
  // onWake('claps' | 'snap'): what woke it. onEvent({ kind, peak, at }): every clap or snap seen (for tests and the like).
  constructor({ onWake = () => {}, onEvent = () => {}, rate = RATE } = {}) {
    this.onWake = onWake;
    this.onEvent = onEvent;
    this.rate = rate;
    this.floor = 0.004; // the room's noise, slowly followed
    this.history = []; // the energies of the last few steps
    this.pending = null; // a burst being watched: { peak, hiss, start, widths, at }
    this.lastEvent = -1e9; // time of the last clap or snap
    this.lastClap = null; // the clap that a second one can follow: { at }
    this.t = 0; // seconds since start
    this.carry = new Float32Array(0);
  }

  // Feeds any amount of audio (Float32Array of mono samples at this.rate).
  feed(samples) {
    let data = samples;
    if (this.carry.length) { data = new Float32Array(this.carry.length + samples.length); data.set(this.carry); data.set(samples, this.carry.length); }
    const step = Math.round((HOP * this.rate) / RATE);
    let i = 0;
    for (; i + step <= data.length; i += step) this.step(stepFeatures(data, i, i + step), step / this.rate);
    this.carry = data.slice(i);
  }

  step({ rms, hiss }, dt) {
    this.t += dt;
    const recent = this.history.length ? this.history.reduce((a, b) => a + b, 0) / this.history.length : rms;
    this.history.push(rms);
    if (this.history.length > 8) this.history.shift();

    if (this.pending) {
      const p = this.pending;
      p.steps += 1;
      if (rms > p.peak) { p.peak = rms; p.hiss = hiss; }
      if (rms > p.peak * 0.5) p.wide += 1;
      // after about 80 ms a clap or a snap is nearly gone; speech, a hum or a door are not
      if (p.steps >= 10) {
        this.pending = null;
        if (rms < p.peak * 0.35 && p.hiss > 0.7 && p.wide <= 6) this.event(p);
      }
      return;
    }
    // The room's noise is followed while nothing is going on.
    if (rms < this.floor * 3) this.floor = Math.max(0.002, this.floor * 0.98 + rms * 0.02);
    if (this.t - this.lastEvent < REFRACTORY) return;
    // A burst begins: loud, far above the room, and far above the steps just before.
    if (rms > Math.max(MIN_PEAK, this.floor * FLOOR_FACTOR) && rms > recent * 3.5) {
      this.pending = { peak: rms, hiss, steps: 0, wide: 1, at: this.t };
    }
  }

  event(p) {
    const kind = p.hiss > 1.15 && p.wide <= 3 && p.peak >= SNAP_PEAK ? 'snap' : 'clap';
    this.lastEvent = this.t;
    this.onEvent({ kind, peak: p.peak, at: p.at });
    // two of them close together: woken
    if (this.lastClap && p.at - this.lastClap.at >= CLAP_GAP[0] && p.at - this.lastClap.at <= CLAP_GAP[1]) {
      this.lastClap = null;
      this.onWake('claps');
      return;
    }
    this.lastClap = { at: p.at };
    // a loud, sharp snap by itself is enough
    if (kind === 'snap' && p.peak >= 0.15) { this.lastClap = null; this.onWake('snap'); }
  }
}

// The microphone, opened with every filter off (a clap is exactly what noise suppression removes), feeding a ClapDetector.
export class SoundWake {
  constructor(onWake) {
    this.onWake = onWake;
    this.ctx = null;
  }

  get active() { return Boolean(this.ctx); }

  async start() {
    if (this.ctx) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const ctx = new AudioContext({ sampleRate: RATE });
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(2048, 1, 1);
    const detector = new ClapDetector({ onWake: (how) => this.onWake(how), rate: ctx.sampleRate });
    node.onaudioprocess = (e) => detector.feed(e.inputBuffer.getChannelData(0));
    source.connect(node);
    node.connect(ctx.destination);
    this.ctx = ctx;
    this.stream = stream;
    this.node = node;
  }

  stop() {
    if (!this.ctx) return;
    this.node.onaudioprocess = null;
    for (const t of this.stream.getTracks()) t.stop();
    this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}
