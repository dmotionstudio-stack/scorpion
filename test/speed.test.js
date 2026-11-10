import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTps, effectiveTps, levelOf, recommend, readBytes, measureMemory, measureMemoryTrusted } from '../src/main/speed.js';

const GB = 1024 ** 3;
const laptop = { gpu: 'vulkan', dedicatedVram: 0, sharedVram: 0, ram: 16 * GB, cores: 8 };
const weak = { gpu: 'cpu', dedicatedVram: 0, sharedVram: 0, ram: 4 * GB, cores: 2 };
const gaming = { gpu: 'cuda', dedicatedVram: 8 * GB, sharedVram: 0, ram: 32 * GB, cores: 12 };
const qwen4 = { path: 'q4', name: 'Qwen3 4B', bytes: 2.5 * GB, tier: 2, rank: 0 };
const small = { path: 'q1', name: 'Qwen3 1.7B', bytes: 1.1 * GB, tier: 1, rank: 3 };
const oss = { path: 'oss', name: 'gpt-oss 20B', bytes: 12.1 * GB, activeBytes: 2.6 * GB, thinks: true, tier: 3, rank: 2 };

test('speed follows memory speed and model size, and a graphics card with room is much faster', () => {
  const cpu = estimateTps(qwen4, laptop, 20);
  assert.ok(cpu > 6 && cpu < 14, `a 4B model on a laptop processor: ${cpu}`);
  assert.ok(estimateTps(small, laptop, 20) > cpu * 2, 'a smaller model is faster');
  assert.ok(estimateTps(qwen4, gaming, 20) > cpu * 4, 'on the graphics card');
  assert.ok(estimateTps(qwen4, laptop, 8) < cpu, 'slower memory, slower answers');
  // Few cores can't use all the memory speed.
  assert.ok(estimateTps(qwen4, { ...laptop, cores: 2 }, 40) < estimateTps(qwen4, laptop, 40));
});

test('a model that does not fit says so; one that uses part of itself reads less', () => {
  assert.equal(estimateTps(oss, weak, 10), 0);
  assert.equal(estimateTps({ ...qwen4, bytes: 3 * GB }, weak, 10), 0, 'a 3 GB file on a 4 GB computer');
  assert.equal(readBytes(oss), 2.6 * GB);
  assert.equal(readBytes(qwen4), 2.5 * GB);
  assert.equal(estimateTps({}, laptop, 10), null);
  assert.equal(estimateTps(qwen4, null, 10), null);
});

test('words a second become words people use; thinking halves what is felt, off gives it back', () => {
  assert.deepEqual([40, 15, 6, 2, 0].map((t) => levelOf(t).id), ['fast', 'good', 'slow', 'very-slow', 'too-big']);
  assert.equal(levelOf(null), null);
  assert.equal(effectiveTps(20, oss, 'auto'), 10);
  assert.equal(effectiveTps(20, oss, 'off'), 20);
  assert.equal(effectiveTps(20, qwen4, 'auto'), 20);
});

test('the best model is the smartest one that is comfortable here, else the fastest one', () => {
  // A laptop: gpt-oss reads little but thinks, so with thinking it is not comfortable; Qwen3 4B is.
  const a = recommend([qwen4, small, oss], laptop, 20);
  assert.equal(a.rows.length, 3);
  assert.ok(a.pick, 'something is picked');
  const withThinking = recommend([qwen4, small, oss], laptop, 20, { thinking: 'auto' });
  const without = recommend([qwen4, small, oss], laptop, 20, { thinking: 'off' });
  assert.notEqual(withThinking.pick.path, 'oss');
  assert.equal(without.pick.path, 'oss', 'with thinking off the bigger one is comfortable and smarter');
  // A weak computer: only the small one fits and is picked even though it is slow.
  const w = recommend([qwen4, small, oss], { ...weak, ram: 5 * GB }, 8);
  assert.equal(w.pick.path, 'q1');
  assert.equal(w.rows.find((r) => r.path === 'oss').level.id, 'too-big');
  // Nothing fits: nothing picked.
  assert.equal(recommend([oss], weak, 8).pick, null);
  assert.equal(recommend([], laptop, 8).pick, null);
});

test('memory speed is measured and never throws', () => {
  const gbs = measureMemory({ size: 4 * 1024 * 1024, rounds: 2 });
  assert.ok(gbs === null || gbs > 0);
  assert.equal(measureMemory({ size: -1 }), null);
  let t = 0;
  assert.equal(measureMemory({ size: 1e9 / 4, rounds: 1, now: () => (t += 1000) }), 0.3, 'a copy of 250 MB in a second: 0.3 GB/s');
});

test('a memory reading too low to be real is tried again, then not trusted', () => {
  const seq = (...v) => { let i = 0; return () => v[Math.min(i++, v.length - 1)]; };
  assert.equal(measureMemoryTrusted({ measure: seq(0.6, 0.8, 14) }), 14, 'the computer was busy at first');
  assert.equal(measureMemoryTrusted({ measure: seq(18) }), 18);
  assert.equal(measureMemoryTrusted({ measure: seq(0.6, 0.7, 0.5, 0.9) }), null, 'never a believable reading: the estimate assumes a typical one');
  assert.equal(measureMemoryTrusted({ measure: seq(null, null, null, null) }), null);
});
