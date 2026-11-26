import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVoiceFrame, describeSound, frameFeatures } from '../src/renderer/voice-focus.js';
import { parseSoundCheck, parseSwitch } from '../src/renderer/orb-commands.js';

const R = 16000, N = 2048;
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());

// A voice: a stack of harmonics shaped by three formants, with a little breath.
function voice(f0, amp = 0.2, noise = 0.01) {
  const d = new Float32Array(N);
  for (let h = 1; h * f0 < 4000; h++) {
    const f = h * f0;
    const env = 0.6 * Math.exp(-((f - 500) ** 2) / (2 * 250 ** 2)) + 0.5 * Math.exp(-((f - 1500) ** 2) / (2 * 400 ** 2)) + 0.3 * Math.exp(-((f - 2500) ** 2) / (2 * 500 ** 2)) + 0.02;
    for (let i = 0; i < N; i++) d[i] += (amp * env * Math.sin((2 * Math.PI * f * i) / R + h)) / 2;
  }
  for (let i = 0; i < N; i++) d[i] += gauss() * noise;
  return d;
}
const white = (a) => Float32Array.from({ length: N }, () => gauss() * a);
const fan = () => Float32Array.from({ length: N }, (_, i) => 0.08 * Math.sin((2 * Math.PI * 90 * i) / R) + 0.04 * Math.sin((2 * Math.PI * 180 * i) / R) + gauss() * 0.01);
const click = () => { const d = new Float32Array(N); for (const at of [300, 1200]) for (let i = 0; i < 80; i++) d[at + i] = gauss() * 0.5 * Math.exp(-i / 15); return d; };
const share = (make, n = 30) => { let k = 0; for (let i = 0; i < n; i++) if (isVoiceFrame(make())) k++; return k / n; };
// A few seconds of one kind of sound, as the room check would hear it.
const seconds = (make, frames = 36) => { const out = new Float32Array(frames * N); for (let i = 0; i < frames; i++) out.set(make(i), i * N); return out; };

test('a human voice is a voice, whatever its pitch or loudness', () => {
  for (const f0 of [100, 140, 200, 260]) assert.ok(share(() => voice(f0)) > 0.95, `f0 ${f0}`);
  assert.ok(share(() => voice(150, 0.03, 0.002)) > 0.95, 'quiet speech');
});

test('fans, hiss, clicks and keyboards are not a voice', () => {
  assert.equal(share(() => fan()), 0, 'a fan hums low');
  assert.equal(share(() => white(0.1)), 0, 'hiss is flat');
  assert.equal(share(() => click()), 0, 'clicks are flat and short');
  const f = frameFeatures(fan());
  assert.ok(f.lowShare > 0.5, 'its energy is rumble');
});

test('asked what the room sounds like, it says what it hears, in a few words', () => {
  assert.match(describeSound(seconds(() => white(0.0005))), /very quiet/);
  assert.match(describeSound(seconds(() => voice(150))), /voices/);
  assert.match(describeSound(seconds(() => fan())), /low hum/);
  assert.match(describeSound(seconds((i) => (i % 9 === 0 ? click() : white(0.004)))), /clicks or taps/);
  assert.match(describeSound(seconds(() => white(0.06))), /hiss/);
  assert.match(describeSound(new Float32Array(100)), /could not listen long enough/);
});

test('it listens to the room only when asked, and blocking noise is a switch', () => {
  for (const say of ["what's that noise", 'what is that sound', 'identify the background noises', 'what do you hear', 'listen to the background sounds', 'Scorpion, what are the background noises around me', 'tell me the sounds in the background']) {
    assert.equal(parseSoundCheck(say), true, say);
  }
  for (const say of ['what is the weather', 'turn up the sound', 'play some music', 'what time is it', 'block background noises']) {
    assert.equal(parseSoundCheck(say), false, say);
  }
  assert.deepEqual(parseSwitch('block background noises'), { key: 'noise', on: true });
  assert.deepEqual(parseSwitch('turn on noise cancellation'), { key: 'noise', on: true });
  assert.deepEqual(parseSwitch('stop blocking background noise'), { key: 'noise', on: false });
  assert.deepEqual(parseSwitch('turn off background noise blocking'), { key: 'noise', on: false });
  assert.deepEqual(parseSwitch('allow background sounds'), { key: 'noise', on: false });
});

test('Scorpion waits until you have finished talking: a pause to think does not end your turn', async () => {
  const { endPause } = await import('../src/renderer/voice.js');
  // never the old 0.6 to 0.8 seconds, and longer the longer you have spoken
  assert.ok(endPause(1000) >= 1400, 'a short sentence still gets a second and a half');
  assert.ok(endPause(5000) > endPause(1000) && endPause(12000) > endPause(5000), 'longer talk, longer patience');
  // a sentence that trails off gets more time, a finished one a little less
  assert.ok(endPause(4000, 'I was thinking that we could, and') > endPause(4000, 'I was thinking that we could.') + 1000);
  assert.ok(endPause(4000, 'Remind me about the meeting,') > endPause(4000, null) + 1000);
  assert.ok(endPause(4000, 'What time is it?') < endPause(4000, null));
  assert.equal(endPause(4000, ''), endPause(4000, null), 'no text yet: the usual wait');
  assert.ok(endPause(4000, 'Tell me about the history of') > endPause(4000, 'Tell me about the history of Rome.'), 'a dangling word');
});

// ---- the recorder, with a pretend microphone: frames go in one at a time, as the audio graph would deliver them ----
async function listenTo(frames, options = {}) {
  const { Recorder } = await import('../src/renderer/voice.js');
  let node = null;
  const connectable = () => ({ connect(next) { return next; }, frequency: {}, Q: {} });
  const realNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const realCtx = globalThis.AudioContext;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getAudioTracks: () => [{ muted: false }], getTracks: () => [{ stop() {} }] }) } } });
  globalThis.AudioContext = class {
    constructor() { this.destination = {}; }
    createMediaStreamSource() { return connectable(); }
    createBiquadFilter() { return connectable(); }
    createScriptProcessor() { node = { ...connectable(), onaudioprocess: null }; return node; }
    close() { return Promise.resolve(); }
  };
  const ends = [];
  const recorder = new Recorder();
  try {
    await recorder.start({ onEnd: (pcm) => ends.push(pcm.length), ...options });
    for (const frame of frames) { if (node?.onaudioprocess) node.onaudioprocess({ inputBuffer: { getChannelData: () => frame } }); }
  } finally {
    node && (node.onaudioprocess = null);
    if (realNav) Object.defineProperty(globalThis, 'navigator', realNav); else delete globalThis.navigator;
    globalThis.AudioContext = realCtx;
  }
  return ends;
}
const times = (n, make) => Array.from({ length: n }, () => make());

test('a pause to think does not end the turn; the end of the thought does', async () => {
  const talk = () => voice(150);
  const hush = () => white(0.0005);
  // 1 s of talk, a 1 s pause (the old recorder answered here), 1 s more talk, then silence
  const ends = await listenTo([...times(8, talk), ...times(8, hush), ...times(8, talk), ...times(16, hush)]);
  assert.equal(ends.length, 1, 'one turn, not two');
  assert.ok(ends[0] > R * 2.5, 'with both parts of what was said');
  // a pause of a second and a half, with nothing after: the turn is over
  assert.equal((await listenTo([...times(8, talk), ...times(16, hush)])).length, 1);
  // while the pause is still short, nothing has ended yet
  assert.equal((await listenTo([...times(8, talk), ...times(8, hush)])).length, 0, 'a second of quiet is not the end');
});

test('a sentence that trails off is given more time still', async () => {
  const talk = () => voice(150);
  const hush = () => white(0.0005);
  const frames = [...times(8, talk), ...times(13, hush)]; // about 1.7 s of quiet
  assert.equal((await listenTo(frames, { hint: () => 'I was thinking that we could.' })).length, 1, 'a finished sentence: over');
  assert.equal((await listenTo(frames, { hint: () => 'I was thinking that we could, and' })).length, 0, 'trailing off: still waiting');
});

test('noises that are not a voice never start a turn', async () => {
  assert.equal((await listenTo([...times(40, () => fan()), ...times(20, () => white(0.0005))])).length, 0, 'a fan');
  assert.equal((await listenTo([...times(40, () => click()), ...times(20, () => white(0.0005))])).length, 0, 'a keyboard');
  assert.equal((await listenTo([...times(40, () => white(0.1)), ...times(20, () => white(0.0005))])).length, 0, 'hiss');
  assert.equal((await listenTo([...times(8, () => voice(150)), ...times(24, () => white(0.0005))])).length, 1, 'but a voice does');
});
