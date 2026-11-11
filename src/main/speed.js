// How fast a model will answer on this computer, worked out from what the
// computer has: no model needs to be loaded to know. A model writes its answer
// one word at a time, and for each word the computer reads the model's whole
// working part from memory, so the speed is about (how fast memory is read)
// divided by (the model's size), less some losses. The memory speed is measured
// (a short copy of a big block); a graphics card with room for the model is
// much faster than the processor. Estimates, not promises: the Models page says
// "about". Plain functions, tested on their own (test/speed.test.js).

const GB = 1024 ** 3;

// How much a model may think before it answers, in tokens, for each Thinking level (the switch at
// the top of a chat): none for Off, a little for Quick, more for Normal, no limit for Deep.
export const THINK_BUDGET = { off: 0, low: 384, medium: 1536, high: undefined };

// The most a reply may write, in tokens: the answer (short when spoken, more room when building, never
// more than half the context) plus what the model may think first. The thinking comes on top: a model
// that thinks a lot (LFM3) used to spend the whole limit thinking and be cut off in the middle of its answer.
export function replyTokens({ spoken = false, mode = 'chat', contextSize = 8192, effort = null } = {}) {
  const think = THINK_BUDGET[effort] || 0;
  if (spoken) return 400 + think;
  const answer = Math.min(mode === 'build' ? 6144 : 3072, Math.floor(contextSize / 2));
  return Math.min(answer + think, Math.floor(contextSize * 0.75));
}

// Typical memory speed (GB/s) of a graphics card with room for the model: a
// laptop card is about 100, a desktop one 200 or more; Apple's unified memory
// about 100 on the base chips.
const GPU_GBS = 200;
const METAL_GBS = 100;
// What's lost to everything but reading the weights (about half in practice).
const EFFICIENCY = 0.7;
// Reading is shared between the cores: a processor with few of them can't
// keep up with its own memory.
const perCoreGBs = 6;

// The size that is read for each word. Models that use only part of themselves
// for each word (mixture of experts, like gpt-oss) read far less than their file.
export function readBytes(model) {
  return model.activeBytes > 0 ? model.activeBytes : model.bytes;
}

// Words (tokens) a second, about. hw: { gpu, dedicatedVram, sharedVram, ram, cores }; gbs: measured memory speed.
export function estimateTps(model, hw, gbs) {
  const bytes = readBytes(model);
  if (!bytes || !hw) return null;
  const need = model.bytes * 1.15 + 0.6 * GB; // the whole file has to fit, not only what's read
  let bandwidth;
  if (hw.dedicatedVram && need <= hw.dedicatedVram) bandwidth = GPU_GBS * 1e9;
  else if (hw.gpu === 'metal' && hw.sharedVram && need <= hw.sharedVram * 0.75) bandwidth = METAL_GBS * 1e9;
  else {
    // The processor (also integrated graphics, which share its memory).
    if (model.bytes * 1.05 + GB > (hw.ram || 0) * 0.9) return 0; // doesn't fit in memory
    // A copy reads and writes every byte, so the memory's speed is about twice what it measures.
    const mem = Math.max(2, Number(gbs) || 10) * 2e9;
    const cores = Math.max(1, Number(hw.cores) || 4);
    bandwidth = Math.min(mem, cores * perCoreGBs * 1e9);
    // Partly on a graphics card that is too small: a little help, not much.
    if (hw.dedicatedVram) bandwidth *= 1.15;
  }
  return Math.round((bandwidth * EFFICIENCY / bytes) * 10) / 10;
}

// What the number means to a person.
export const SPEED_LEVELS = [
  { min: 25, id: 'fast', label: 'Fast' },
  { min: 12, id: 'good', label: 'Good' },
  { min: 5, id: 'slow', label: 'Slow' },
  { min: 0.01, id: 'very-slow', label: 'Very slow' },
  { min: -1, id: 'too-big', label: "Won't fit" },
];
export const levelOf = (tps) => (tps == null ? null : SPEED_LEVELS.find((l) => tps >= l.min) || SPEED_LEVELS.at(-1));

// A model that thinks before it answers spends about half its time doing so,
// unless thinking is off: what the person waits for is slower than its speed.
export const effectiveTps = (tps, model, thinking = 'auto') => (tps && model.thinks && thinking !== 'off' ? tps * 0.5 : tps);

// How capable a model is, 1 to 3: its catalog tier, or by size for any other file.
export const tierOf = (m) => m.tier ?? (m.bytes < 1.5 * GB ? 1 : m.bytes < 4.5 * GB ? 2 : 3);

// Each model with its estimated speed, and the one to use: the smartest
// (catalog order: the order of preference, then the biggest) that still
// answers at a comfortable speed; none comfortable: the fastest one.
// models: [{ path, name, bytes, activeBytes?, thinks?, tier?, rank }], comfy: words a second wanted.
export function recommend(models, hw, gbs, { thinking = 'auto', comfy = 10 } = {}) {
  const rows = models.map((m) => {
    const tps = estimateTps(m, hw, gbs);
    const waits = effectiveTps(tps, m, thinking);
    return { ...m, tps, waits, level: levelOf(waits) };
  });
  const fits = rows.filter((r) => r.tps > 0);
  const comfortable = fits.filter((r) => r.waits >= comfy).sort((a, b) => tierOf(b) - tierOf(a) || (a.rank ?? 99) - (b.rank ?? 99) || b.bytes - a.bytes);
  const pick = comfortable[0] || [...fits].sort((a, b) => b.waits - a.waits)[0] || null;
  return { rows, pick };
}

// A reading that is too low to be a computer's memory (it was busy, or the measure was starved of
// the processor) is tried again after a moment; still too low: not trusted (null: the estimate then
// assumes a typical memory speed instead of a wrong one).
export const MIN_TRUSTED_GBS = 4;
export function measureMemoryTrusted({ tries = 4, pause = () => {}, measure = measureMemory } = {}) {
  let best = null;
  for (let i = 0; i < tries; i++) {
    const g = measure();
    if (g && (best === null || g > best)) best = g;
    if (best >= MIN_TRUSTED_GBS) return best;
    pause();
  }
  return best >= MIN_TRUSTED_GBS ? best : null;
}

// Memory speed in GB/s: copies a big block a few times and keeps the best.
// ~150 ms. Where this can't run, null (the estimate then assumes a typical one).
export function measureMemory({ size = 96 * 1024 * 1024, rounds = 4, now = () => performance.now() } = {}) {
  try {
    const a = Buffer.alloc(size, 1);
    const b = Buffer.alloc(size);
    let best = 0;
    for (let i = 0; i < rounds; i++) {
      const t = now();
      a.copy(b);
      const s = (now() - t) / 1000;
      if (s > 0) best = Math.max(best, size / s / 1e9);
    }
    return best ? Math.round(best * 10) / 10 : null;
  } catch { return null; }
}
