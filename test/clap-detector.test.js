import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClapDetector, RATE } from '../src/renderer/clap-detector.js';
import { isVoiceFrame } from '../src/renderer/voice-focus.js';

let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());

const room = (seconds, level = 0.004) => Float32Array.from({ length: Math.round(seconds * RATE) }, () => gauss() * level);
// a burst of hiss that dies away: tau is how fast (seconds), lowpass makes it a clap (duller) rather than a snap (sharper)
function burst(amp, tau, dull = 0.35, seconds = 0.12) {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const noise = gauss();
    lp += dull * (noise - lp); // dull = 1: pure hiss, lower: duller
    out[i] = amp * Math.exp(-(i / RATE) / tau) * (dull >= 1 ? noise : lp * 2.2);
  }
  return out;
}
const clap = (amp = 0.5) => burst(amp, 0.014, 0.45);
const snap = (amp = 0.5) => burst(amp, 0.004, 1);
// a recording: silence with sounds placed at times (seconds)
function record(total, sounds, level = 0.004) {
  const rec = room(total, level);
  for (const [at, sound] of sounds) { const k = Math.round(at * RATE); for (let i = 0; i < sound.length && k + i < rec.length; i++) rec[k + i] += sound[i]; }
  return rec;
}
function listen(rec, rate = RATE) {
  const events = [], wakes = [];
  const d = new ClapDetector({ rate, onEvent: (e) => events.push(e), onWake: (how) => wakes.push(how) });
  for (let i = 0; i < rec.length; i += 2048) d.feed(rec.subarray(i, Math.min(rec.length, i + 2048)));
  return { events, wakes };
}
function voice(f0, seconds, amp = 0.3) {
  const n = Math.round(seconds * RATE);
  const d = new Float32Array(n);
  for (let h = 1; h * f0 < 4000; h++) {
    const f = h * f0;
    const env = 0.6 * Math.exp(-((f - 500) ** 2) / (2 * 250 ** 2)) + 0.5 * Math.exp(-((f - 1500) ** 2) / (2 * 400 ** 2)) + 0.02;
    for (let i = 0; i < n; i++) d[i] += (amp * env * Math.sin((2 * Math.PI * f * i) / RATE + h)) / 2 * (0.6 + 0.4 * Math.sin((2 * Math.PI * 3 * i) / RATE));
  }
  return d;
}

test('two claps in a row wake it', () => {
  for (const gap of [0.25, 0.4, 0.6, 0.85]) {
    const { events, wakes } = listen(record(3, [[1, clap()], [1 + gap, clap(0.45)]]));
    assert.equal(events.length, 2, `gap ${gap}: both claps seen`);
    assert.deepEqual(wakes, ['claps'], `gap ${gap}`);
  }
});

test('one clap alone does not, nor two claps too far apart, nor too close', () => {
  assert.deepEqual(listen(record(3, [[1, clap()]])).wakes, []);
  assert.deepEqual(listen(record(5, [[1, clap()], [3.5, clap()]])).wakes, [], 'two and a half seconds apart');
  assert.deepEqual(listen(record(3, [[1, clap()], [1.05, clap()]])).wakes, [], 'one clap with an echo');
});

test('a loud finger snap wakes it by itself, a faint one does not', () => {
  const loud = listen(record(3, [[1, snap(0.6)]]));
  assert.deepEqual(loud.wakes, ['snap']);
  assert.equal(loud.events[0].kind, 'snap');
  assert.deepEqual(listen(record(3, [[1, snap(0.08)]])).wakes, [], 'too faint');
});

test('speech, a fan, music, typing and a long noise never wake it', () => {
  assert.deepEqual(listen(record(4, [[0.5, voice(140, 2.5)], [3.2, voice(200, 0.6)]])).wakes, [], 'speech');
  const fan = Float32Array.from({ length: 4 * RATE }, (_, i) => 0.08 * Math.sin((2 * Math.PI * 90 * i) / RATE) + gauss() * 0.01);
  assert.deepEqual(listen(fan).wakes, [], 'a fan');
  const tone = Float32Array.from({ length: 4 * RATE }, (_, i) => 0.2 * (Math.sin((2 * Math.PI * 440 * i) / RATE) + Math.sin((2 * Math.PI * 660 * i) / RATE)));
  assert.deepEqual(listen(tone).wakes, [], 'music');
  const typing = record(5, Array.from({ length: 12 }, (_, k) => [0.4 + k * 0.33, burst(0.07, 0.002, 1, 0.04)]));
  assert.deepEqual(listen(typing).wakes, [], 'a keyboard');
  const vacuum = record(4, [[1, Float32Array.from({ length: Math.round(0.6 * RATE) }, () => gauss() * 0.3)], [2.2, Float32Array.from({ length: Math.round(0.6 * RATE) }, () => gauss() * 0.3)]]);
  assert.deepEqual(listen(vacuum).wakes, [], 'long noise');
});

test('claps in a noisy room still count, and the detector copes with any chunk size', () => {
  const rec = record(4, [[1, clap(0.7)], [1.45, clap(0.7)]], 0.02);
  assert.deepEqual(listen(rec).wakes, ['claps']);
  const d = new ClapDetector({ onWake: (h) => woken.push(h) });
  const woken = [];
  for (let i = 0; i < rec.length; i += 777) d.feed(rec.subarray(i, Math.min(rec.length, i + 777)));
  assert.deepEqual(woken, ['claps']);
});

test('a clap is not taken for a voice by the voice check either (they are different things)', () => {
  assert.equal(isVoiceFrame(record(0.128, [[0, clap(0.5)]]).subarray(0, 2048)), false);
});

test('it can be turned off by voice: "turn off clapping", "turn on finger snapping"', async () => {
  const { parseSwitch } = await import('../src/renderer/orb-commands.js');
  assert.deepEqual(parseSwitch('turn off clapping'), { key: 'claps', on: false });
  assert.deepEqual(parseSwitch('turn on finger snapping'), { key: 'claps', on: true });
  assert.deepEqual(parseSwitch('disable the clap wake'), { key: 'claps', on: false });
  assert.deepEqual(parseSwitch('enable wake sounds'), { key: 'claps', on: true });
});
