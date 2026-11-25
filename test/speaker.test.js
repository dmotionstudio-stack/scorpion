import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Speaker, trimClip, KEEP_LEAD_MS, KEEP_TAIL_MS } from '../src/renderer/voice.js';

const RATE = 24000;
// Kokoro's clips: quiet, then the words, then quiet again (measured: about 0.3 s before and 0.45 s after)
function clip(wordsSec, { lead = 0.3, tail = 0.45 } = {}) {
  const a = new Float32Array(Math.round((lead + wordsSec + tail) * RATE));
  for (let i = Math.round(lead * RATE); i < Math.round((lead + wordsSec) * RATE); i++) a[i] = 0.3 * Math.sin(i / 20);
  return { sampleRate: RATE, audio: a };
}
const seconds = (a) => a.length / RATE;

test('the silence Kokoro puts round every clip is cut, leaving a short natural gap', () => {
  const { audio } = clip(1.0);
  const out = trimClip(audio, RATE);
  const keep = (KEEP_LEAD_MS + KEEP_TAIL_MS) / 1000;
  assert.ok(Math.abs(seconds(out) - (1.0 + keep)) < 0.02, `1 s of words plus about ${keep} s, got ${seconds(out)}`);
  assert.ok(seconds(out) < seconds(audio) - 0.6, 'at least 0.6 s of dead air per clip is gone');
  assert.equal(out[0], 0, 'it starts quietly (a fade, no click)');
  assert.ok(Math.abs(out[out.length - 1]) < 0.05, 'and ends quietly');
  assert.equal(audio.length, Math.round(1.75 * RATE), 'the original is not changed');
  // nothing but quiet: left as it was
  const quiet = new Float32Array(1000);
  assert.equal(trimClip(quiet, RATE), quiet);
});

// An audio clock that only moves when the test says so.
function fakeAudio() {
  const ctx = {
    currentTime: 0, started: [], destination: {},
    createAnalyser: () => ({ fftSize: 0, connect() {}, getFloatTimeDomainData() {} }),
    createBuffer: (ch, len, sr) => ({ duration: len / sr, copyToChannel() {} }),
    createBufferSource() { const s = { connect() {}, start(at) { s.at = at; ctx.started.push(s); }, stop() { s.stopped = true; } }; return s; },
  };
  return ctx;
}
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test('sentences are synthesized one after another at once, and played back to back with no gap', async () => {
  const ctx = fakeAudio();
  const calls = [];
  const speaker = new Speaker(async (text) => { calls.push(text); return clip(1.0); }, { makeContext: () => ctx });
  speaker.feed('The first sentence is right here. The second sentence follows right behind it. The third one ends the whole reply. ');
  speaker.flush();
  await tick(30);
  assert.equal(calls.length, 3, 'all three were synthesized while nothing has finished playing');
  assert.equal(ctx.started.length, 3);
  const [a, b, c] = ctx.started;
  const len = 1.0 + (KEEP_LEAD_MS + KEEP_TAIL_MS) / 1000;
  assert.ok(Math.abs(b.at - (a.at + len)) < 0.005, 'the second starts exactly when the first ends');
  assert.ok(Math.abs(c.at - (b.at + len)) < 0.005, 'and the third behind the second');
  assert.ok(speaker.playing);
  speaker.stop();
});

test('a sentence that arrives while the last one plays is ready for the end of it', async () => {
  const ctx = fakeAudio();
  const speaker = new Speaker(async () => clip(1.0), { makeContext: () => ctx });
  speaker.feed('The first sentence comes alone. ');
  await tick(20);
  const first = ctx.started[0];
  ctx.currentTime = 0.4; // still speaking the first one
  speaker.feed('The second sentence arrives later. ');
  speaker.flush();
  await tick(20);
  const len = 1.0 + (KEEP_LEAD_MS + KEEP_TAIL_MS) / 1000;
  assert.equal(ctx.started.length, 2);
  assert.ok(Math.abs(ctx.started[1].at - (first.at + len)) < 0.005, 'it was synthesized during the first and starts right behind it');
  speaker.stop();
});

test('synthesis never overlaps itself, and it is idle only after the last clip has played', async () => {
  const ctx = fakeAudio();
  let running = 0;
  let most = 0;
  const speaker = new Speaker(async () => { running++; most = Math.max(most, running); await tick(8); running--; return clip(0.5); }, { makeContext: () => ctx });
  let idle = 0;
  speaker.onIdle = () => idle++;
  speaker.feed('This is the first sentence here. Another sentence follows right there. And this is the last one. ');
  speaker.flush();
  await tick(80);
  assert.equal(most, 1, 'one piece at a time');
  assert.equal(ctx.started.length, 3);
  assert.equal(idle, 0, 'still playing');
  for (const s of ctx.started) s.onended();
  await tick(60);
  assert.equal(idle, 1, 'idle once, after the last one ended');
  assert.equal(speaker.playing, false);
  speaker.stop();
});

test('stop cuts the speech at once, and the next reply does not wait behind the old one', async () => {
  const ctx = fakeAudio();
  let slow = true;
  const speaker = new Speaker(async (text) => { if (slow && /slow/.test(text)) await tick(200); return clip(0.5); }, { makeContext: () => ctx });
  speaker.feed('A first sentence plays now. ');
  await tick(20);
  speaker.feed('This one is slow to synthesize. ');
  speaker.stop();
  assert.ok(ctx.started[0].stopped, 'what was playing is stopped');
  assert.equal(speaker.playing, false);
  slow = false;
  const before = ctx.started.length;
  speaker.say('A new reply starts right away.');
  await tick(30);
  assert.equal(ctx.started.length, before + 1, 'the new reply played while the old synthesis was still running');
  speaker.stop();
});
