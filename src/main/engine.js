// The only module that touches llama.cpp. Loads GGUF models via
// node-llama-cpp's prebuilt binaries (Metal on macOS, CUDA/Vulkan/CPU on Windows
// and Linux), so inference needs no server, no port and no network. Used
// through engine-client.js, which on Linux runs it in its own process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getLlama, LlamaChatSession, LlamaLogLevel, HarmonyChatWrapper } from 'node-llama-cpp';
import { measureMemoryTrusted, THINK_BUDGET } from './speed.js';

let llama = null;
// Two model slots: "main" answers chats; "voice" is an optional fast model kept
// loaded beside it for spoken turns (voice and Interact), so talking stays
// quick even when the main model is a big one that runs on the processor.
// A slot is one loaded model. It has lanes: each lane is a chat's own place in it (its own sequence of the working memory, its own session
// and what that holds), so as many chats as there are lanes can be answered at the same time.
const newSlot = () => ({ path: null, model: null, context: null, lanes: [], waiters: [], harmony: false });
const slots = { main: newSlot(), voice: newSlot() };
const chat = slots.main;

// gpt-oss speaks the Harmony format, which carries a reasoning effort (how
// long it thinks). Sessions on it get the wrapper with the chosen effort.
const wrapperFor = (harmony, effort) => (harmony ? { chatWrapper: new HarmonyChatWrapper({ reasoningEffort: effort || 'medium' }) } : {});
const newSession = (slot, contextSequence, systemPrompt, effort = null) => new LlamaChatSession({ contextSequence, ...(systemPrompt ? { systemPrompt } : {}), ...wrapperFor(slot.harmony, effort) });
const newLane = (slot, sequence) => ({ sequence, session: newSession(slot, sequence), threadId: null, systemPrompt: null, effort: null, busy: false, usedAt: 0 });

// Changing the effort rebuilds the session on the same sequence: what was
// already read stays, and only the part from the change on is read again.
// The thinking level the person (or Auto) chose: 'off', 'low', 'medium' or 'high'. gpt-oss
// can't be told to skip thinking in its own format, so Off is its lowest effort plus a
// budget of no thinking at all (below); other models only get the budget.
const effortFor = (level) => (level === 'off' ? 'low' : level);
function setEffort(slot, lane, level) {
  const effort = effortFor(level);
  if (!slot.harmony || !effort || effort === (lane.effort || 'medium')) return;
  try { lane.session.dispose({ disposeSequence: false }); } catch { /* already gone */ }
  lane.effort = effort;
  lane.session = newSession(slot, lane.sequence, null, effort);
  lane.threadId = null;
}

export const usesReasoningEffort = (slot = 'main') => slots[slot].harmony;
const embed = { path: null, model: null, context: null };

// What llama.cpp complained about most recently (errors only), kept so that a
// model which won't load can be explained in words (explainLoadFailure).
const recentLog = [];
function keepLog(level, message) {
  const line = String(message).trim();
  if (!line) return;
  recentLog.push(line);
  if (recentLog.length > 60) recentLog.shift();
  console.error('[node-llama-cpp]', line);
}

// Why a model file wouldn't load, from llama.cpp's own error lines, for the
// person who picked it. Never "damaged, download it again" unless that is what
// llama.cpp said: a file built for a different engine version is not damaged.
export function explainLoadFailure(lines, name) {
  const text = lines.join('\n');
  const first = lines.find((l) => /error|fail|wrong|missing|unknown|unsupported|expected/i.test(l) && !/failed to load model$/i.test(l)) || lines[0] || '';
  const detail = first.replace(/^llama_[a-z_]+: (error loading model: )?/i, '').replace(/^error loading model( hyperparameters)?: /i, '').slice(0, 160);
  const arch = /unknown model architecture: '([^']+)'/i.exec(text)?.[1];
  if (arch) return `${name} is a "${arch}" model, a kind this version of Scorpion's engine doesn't know yet. A newer Scorpion may run it.`;
  if (/failed to create context|failed to initialize the context|compute (pp )?buffers/i.test(text)) return `${name} loads, but there isn't enough memory left for its working space at this context size. Lower the context size in Settings → General → System, or pick a smaller model.`;
  if (/failed to allocate|memory allocation of size|out of memory|ErrorOutOfDeviceMemory|ErrorOutOfHostMemory|cudaMalloc|bad_alloc/i.test(text)) return `${name} needs more memory than this computer can give it. Pick a smaller model, or a smaller version (quantization) of it.`;
  if (/hyperparameters|key [\w.]+ (has wrong|not found|is missing)|wrong array length/i.test(text)) return `${name} was made for a different version of the engine, so Scorpion can't read its settings (${detail}). The file is not damaged. Look for another upload or quantization of the same model; the plain text-only version often works.`;
  if (/wrong number of tensors|missing tensor|tensor '[^']*' (not found|has wrong)|done_getting_tensors|tensor.*(not found|missing)/i.test(text)) return `${name} has parts the engine doesn't expect (${detail}). Models with a vision or extra prediction part built into the file often do this. Look for the text-only version.`;
  // (A cut-off file can also make the loader itself fail on a missing header: "Cannot read properties of undefined".)
  if (/invalid magic|invalid gguf|not a gguf|gguf magic|unsupported gguf version|reading 'architecture'|cannot read propert|file is too short|failed to read|data is not within file bounds|unexpectedly reached end|corrupt|incomplete/i.test(text)) return `${name} could not be loaded. The file looks damaged or incomplete: uninstall it in Models and download it again.`;
  return `${name} could not be loaded${detail ? `: ${detail}` : '.'} If the file is fine it may need a newer Scorpion; another upload or quantization of the same model may work.`;
}

async function ensureLlama() {
  // build: 'never' — an installed app must never try to compile llama.cpp.
  llama ??= await getLlama({ build: 'never', logLevel: LlamaLogLevel.error, logger: keepLog });
  return llama;
}

// A pure-CPU llama.cpp. With zero layers on the GPU, the GPU build still routes
// work through the graphics driver; the CPU build measured 3x faster writing
// for a 17 GB model on a 4 GB card (13 vs 4 tokens/s).
// Apple Silicon has no CPU-only prebuilt, so there it falls back to the Metal
// build with zero layers offloaded.
let cpuLlama = null;
async function ensureCpuLlama() {
  cpuLlama ??= await getLlama({ build: 'never', gpu: false, logLevel: LlamaLogLevel.error, logger: keepLog })
    .catch(() => ensureLlama());
  return cpuLlama;
}

// Models far bigger than the graphics card gain nothing from a partial
// offload (measured: 8 of 49 layers ran slower than none), so they go
// straight to the CPU build. Metal shares all of the Mac's memory with the
// CPU at full speed, so there the GPU is always the better choice.
function prefersCpu(bytes, hw) {
  if (hw?.gpu === 'metal') return false;
  return !hw?.dedicatedVram || bytes > hw.dedicatedVram * 1.5;
}

// What this computer has, for "fits on this PC" hints. Dedicated video memory
// is what makes a model fast; shared (unified) memory on integrated graphics
// helps, but runs much closer to CPU speed.
let hardware = null;
export async function hardwareInfo() {
  if (hardware) return hardware;
  const l = await ensureLlama();
  const vram = l.gpu ? await l.getVramState().catch(() => null) : null;
  const total = vram?.total ?? 0;
  const unified = vram?.unifiedSize ?? 0;
  hardware = {
    gpu: l.gpu || 'cpu',
    dedicatedVram: Math.max(0, total - unified),
    sharedVram: unified,
    ram: os.totalmem(),
    cores: os.cpus().length || 1,
    cpu: os.cpus()[0]?.model?.replace(/s+/g, ' ').trim() || '',
    // How fast this computer reads its memory (GB/s, measured once): what decides how fast a model answers (speed.js).
    memGBs: measureMemoryTrusted({ pause: () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150) }),
  };
  return hardware;
}

// Rough fit for a model file: ~15% over its size for weights plus ~0.6 GB for
// an 8k context and buffers. Matches what was measured on a 4 GB RTX 3050 Ti.
export function modelFit(bytes, hw) {
  if (!hw || !bytes) return null;
  const need = bytes * 1.15 + 0.6 * 1024 ** 3;
  if (hw.dedicatedVram && need <= hw.dedicatedVram) return 'fast';
  // Apple Silicon's unified memory runs models at GPU speed.
  if (hw.gpu === 'metal' && hw.sharedVram && need <= hw.sharedVram * 0.75) return 'fast';
  if (!hw.dedicatedVram && hw.sharedVram && need <= hw.sharedVram * 0.5) return 'ok';
  if (bytes * 1.2 + 1024 ** 3 <= hw.ram * 0.6) return 'slow';
  return 'too-big';
}

export async function engineInfo() {
  const l = await ensureLlama();
  return {
    // The backend the loaded model actually runs on (pure-CPU build or the GPU one).
    gpu: chat.model ? chat.backend : (l.gpu || 'cpu'),
    maxToolChars: chat.context ? Math.max(3000, chat.context.contextSize) : null,
    contextSize: chat.context?.contextSize ?? null,
    flashAttention: chat.context ? chat.context.flashAttention : null,
    gpuLayers: chat.model ? chat.model.gpuLayers : null,
    totalLayers: chat.model ? chat.model.fileInsights.totalLayers : null,
    parallelHelpers: chat.context ? chat.context.totalSequences > 1 : null,
    // How many chats the loaded model can answer at the same time (each has its own working memory).
    parallelChats: chat.lanes.length || null,
    chatModel: chat.path,
    voiceModel: slots.voice.path,
    chatModelName: chatModelName(),
    embedModel: embed.path,
  };
}

async function disposeChat(chat = slots.main) {
  for (const lane of chat.lanes) { try { lane.session.dispose({ disposeSequence: true }); } catch { /* already disposed */ } }
  chat.waiters.splice(0).forEach((wake) => wake());
  // (A time limit: after a failed allocation on a small card, disposing can wait for ever, and the next model must still be able to load.)
  const within = (p) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((done) => setTimeout(done, 8000))]);
  await within(chat.context?.dispose());
  await within(chat.model?.dispose());
  Object.assign(chat, newSlot());
}

// One load or unload at a time in each slot: two that overlap (the model
// loading at start-up, and a switch to another) would leave one model's
// details recorded under the other's name.
const queues = { main: Promise.resolve(), voice: Promise.resolve() };
function inQueue(slot, job) {
  const p = queues[slot].then(job, job);
  queues[slot] = p.catch(() => {});
  return p;
}
export function loadChatModel(modelPath, options = {}) {
  return inQueue(options.slot || 'main', () => loadChatModelNow(modelPath, options));
}

// The working memory (context) for a model that is loaded, as big as fits:
// the size asked for, then half of it, down to 2048. Throws when even that
// doesn't fit (loadChatModelNow then tries fewer layers on the graphics card).
const noFit = new Set();
async function makeContext(chat, hw, contextSize, parallel = 1) {
  // A second sequence lets a helper agent run while the main chat waits on it,
  // but each sequence costs a full context of memory. The main chat's context
  // matters more, so keep 2 sequences only if the main one still gets (almost)
  // the full size; otherwise helpers borrow the main sequence when needed.
  // node-llama-cpp's memory estimate can be off on shared-memory GPUs, so also
  // step down on allocation failure.
  // Flash attention measured 15-20% faster prompt reading and ~7% faster
  // generation here, with less memory; it's dropped if a context won't build.
  let fa = chat.model.flashAttentionSupported && !process.env.SCORPION_NO_FLASH_ATTENTION;
  // Several chats at once: one sequence for each, as many as the memory left allows (up to what Settings asks). Each sequence costs a
  // full context, so the estimate is checked against what is free before anything is allocated (a failed attempt costs seconds).
  if (parallel > 1) {
    const vram = chat.llama?.gpu ? await chat.llama.getVramState().catch(() => null) : null;
    for (let s = parallel; s >= 2 && !chat.context; s--) {
      const key = `${chat.path || chat.model.filePath}|${chat.model.gpuLayers}|${contextSize}|${s}`;
      if (noFit.has(key)) continue; // it did not fit before: not tried again (a failed try costs seconds)
      try {
        const need = await chat.model.fileInsights.estimateContextResourceRequirementsV2({ contextSize, modelGpuLayers: chat.model.gpuLayers, sequences: s, flashAttention: fa });
        // (The estimate leaves out the compute buffers, about 0.5 GB per sequence: keep room for them, because a failed allocation can leave the card in a state that makes unloading hang.)
        const gpuOk = !need.gpuVram || (vram && need.gpuVram + s * 700 * 1024 ** 2 <= vram.free);
        const ramOk = !need.cpuRam || need.cpuRam <= os.freemem() * 0.7;
        if (!gpuOk || !ramOk) continue;
        // The full size, once: a range makes it retry smaller sizes, each a failed allocation.
        chat.context = await chat.model.createContext({ sequences: s, contextSize, flashAttention: fa });
      } catch { noFit.add(key); /* fewer sequences */ }
    }
  }
  for (let size = contextSize; !chat.context; size = Math.floor(size / 2)) {
    try {
      chat.context = await chat.model.createContext({ contextSize: { min: Math.min(2048, size), max: size }, flashAttention: fa });
    } catch (err) {
      if (fa) { fa = false; size *= 2; continue; } // retry this size without flash attention
      if (size <= 2048) throw err;
    }
  }
}

async function loadChatModelNow(modelPath, { contextSize = 8192, gpuLayers: requested = 'auto', name = null, onProgress, slot = 'main', parallel = 1 } = {}) {
  const chat = slots[slot];
  const lanesWanted = slot === 'main' ? Math.max(1, Math.min(4, Math.round(Number(parallel)) || 1)) : 1;
  if (chat.path === modelPath && chat.model && chat.requestedGpuLayers === requested && chat.lanesWanted === lanesWanted) return engineInfo();
  await disposeChat(chat);
  // The automatic GPU-offload estimate can overshoot on shared-memory GPUs. If
  // it fails, fall back conservatively (generation needs memory beyond what
  // loading does), down to CPU-only. A number from Settings is tried first.
  // "CPU only" (0 layers) always uses the pure-CPU build, which is faster.
  const hw = await hardwareInfo();
  const bytes = fs.statSync(modelPath).size;
  let loadErr;
  const attempts = requested === 0 || (requested === 'auto' && prefersCpu(bytes, hw)) ? [0]
    : typeof requested === 'number' ? [requested, ...[8, 0].filter((n) => n < requested)]
    : [requested, 16, 8, 0];
  for (const gpuLayers of attempts) {
    recentLog.length = 0;
    try {
      const l = gpuLayers === 0 ? await ensureCpuLlama() : await ensureLlama();
      chat.model = await l.loadModel({ modelPath, gpuLayers, onLoadProgress: (p) => onProgress?.(p) });
      chat.llama = l;
      chat.backend = gpuLayers === 0 ? 'cpu' : (l.gpu || 'cpu');
      // The model fitting isn't enough: its working memory (the context) has to fit
      // in what the card has left too. If it doesn't, this split is given up, and
      // the next one (fewer layers on the card) is tried from a clean start.
      await makeContext(chat, hw, contextSize, lanesWanted);
      break;
    } catch (err) {
      loadErr = err;
      await disposeChat(chat);
    }
  }
  if (!chat.model) {
    // Even CPU-only failed, so the file itself is the problem. Say why in words
    // (a cut-off download, a file made for another engine version...) instead of
    // llama.cpp's internal error.
    // (The loader's own error counts too: a file it rejects before llama.cpp sees it leaves nothing in the log.)
    const err = new Error(explainLoadFailure([...recentLog.splice(0), ...(loadErr?.message ? [loadErr.message] : [])], name || path.basename(modelPath).replace(/\.gguf$/i, '')));
    err.cause = loadErr;
    throw err;
  }
  chat.name = name;
  chat.requestedGpuLayers = requested;
  chat.lanesWanted = lanesWanted;
  chat.harmony = chat.model.fileInfo?.metadata?.general?.architecture === 'gpt-oss';
  chat.lanes = Array.from({ length: chat.context.totalSequences }, () => newLane(chat, chat.context.getSequence()));
  chat.path = modelPath;
  return engineInfo();
}

// Whether a model file can be used: { ok: true } or { ok: false, reason }. It
// is loaded for real on the CPU with nothing on the graphics card: the weights
// are memory-mapped, not read, so it takes a few seconds and little memory (a
// vocabulary-only load is quicker but skips the model-specific settings, which
// is where a file made for another engine version gives itself away).
export async function checkModelFile(modelPath) {
  const l = await ensureCpuLlama();
  recentLog.length = 0;
  try {
    const model = await l.loadModel({ modelPath, gpuLayers: 0, useMmap: true });
    await model.dispose();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: explainLoadFailure([...recentLog.splice(0), ...(err?.message ? [err.message] : [])], path.basename(modelPath).replace(/\.gguf$/i, '')) };
  }
}

export function unloadChatModel(slot = 'main') {
  return inQueue(slot, () => disposeChat(slots[slot]));
}

export function isChatReady(slot = 'main') {
  return slots[slot].lanes.length > 0;
}

// A chat answered elsewhere (another model source) changed its history:
// make the next local turn reload it instead of trusting the loaded context.
export function forgetLoadedThread() {
  for (const slot of Object.values(slots)) for (const lane of slot.lanes) lane.threadId = null;
}

// Callers pass the display name shown in the model list when loading.
export function chatModelName(slot = 'main') {
  const chat = slots[slot];
  return chat.path ? chat.name || path.basename(chat.path, '.gguf') : null;
}

/**
 * Run one user turn on a thread. `history` is the thread's saved node-llama-cpp
 * chat history (or null for a fresh thread). Returns the updated history.
 */
// One loaded model serves every chat, scheduled run and helper. A turn takes a lane: the one that already holds its chat (nothing to re-read),
// else one with nothing in it, else the one used longest ago. When every lane is busy the turn waits for one (onQueued tells the person), and
// a chat is never in two lanes. (Helpers run *inside* a main turn, on its lane's sequence, and don't take a lane.)
async function acquireLane(slotName, threadId, onQueued) {
  const chat = slots[slotName];
  let told = false;
  for (;;) {
    if (!chat.lanes.length) throw new Error('No chat model loaded. Pick one in Models.');
    if (!(threadId && chat.lanes.some((l) => l.busy && l.threadId === threadId))) {
      const free = chat.lanes.filter((l) => !l.busy);
      const lane = free.find((l) => threadId && l.threadId === threadId) || free.find((l) => l.threadId === '(warm)') || free.find((l) => !l.threadId) || free.sort((a, b) => a.usedAt - b.usedAt)[0];
      if (lane) { lane.busy = true; lane.usedAt = Date.now(); return lane; }
    }
    if (!told) { told = true; try { onQueued?.(chat.lanes.length); } catch { /* only a message */ } }
    await new Promise((wake) => chat.waiters.push(wake));
  }
}
function releaseLane(chat, lane) {
  lane.busy = false;
  lane.usedAt = Date.now();
  chat.waiters.splice(0).forEach((wake) => wake());
}

export async function runTurn(opts) {
  const slot = opts.slot || 'main';
  const lane = await acquireLane(slot, opts.threadId, opts.onQueued);
  try {
    return await runTurnUnlocked({ ...opts, lane });
  } finally {
    releaseLane(slots[slot], lane);
  }
}

// Warm-up: read a new chat's system prompt and tool list ahead of time, so the
// first message only has to read itself (on a big model on the processor that
// is most of the wait). Only while nothing else is loaded in the slot: after
// a chat ran, its prompt is already there and reused.
export async function warmUp({ systemPrompt, functions, effort = null, slot = 'main' }) {
  const chat = slots[slot];
  const lane = chat.lanes.find((l) => !l.busy && !l.threadId);
  if (!lane) return false;
  lane.busy = true;
  try {
    setEffort(chat, lane, effort);
    lane.session.setChatHistory([{ type: 'system', text: systemPrompt }]);
    await lane.session.preloadPrompt('', { functions });
    lane.threadId = '(warm)';
    lane.systemPrompt = systemPrompt;
    return true;
  } finally {
    releaseLane(chat, lane);
  }
}

function promptOptions({ functions, temperature, signal, onText, onThought, maxTokens = 3072, effort = null }) {
  const thoughtTokens = THINK_BUDGET[effort];
  return {
    functions,
    // How much a model may think before it answers (none for Off): thinking is most of the wait on a slow computer.
    ...(thoughtTokens !== undefined ? { budgets: { thoughtTokens } } : {}),
    temperature,
    signal,
    stopOnAbortSignal: true,
    // Small models sometimes loop (e.g. endless whitespace after a tool call);
    // cap each response so a runaway can't fill the whole context.
    maxTokens,
    repeatPenalty: { lastTokens: 64, penalty: 1.1 },
    onFunctionCallParamsChunk: process.env.SCORPION_DEBUG ? (c) => process.stdout.write(`{${c.paramsChunk}}`) : undefined,
    onResponseChunk(chunk) {
      if (chunk.type === 'segment' && chunk.segmentType === 'thought') onThought?.(chunk.text);
      else if (chunk.type !== 'segment') onText?.(chunk.text);
    },
  };
}

/** Run a helper agent on a fresh, separate session. Returns its final answer. */
export async function runHelperTurn({ systemPrompt, text, functions, temperature, signal, onText, slot = 'main', threadId = null }) {
  const chat = slots[slot];
  if (!chat.model) throw new Error('No chat model loaded');
  // The lane of the turn that asked for this helper (it is paused, waiting for the answer).
  const parent = chat.lanes.find((l) => l.busy && l.threadId === threadId) || chat.lanes.find((l) => l.busy) || chat.lanes[0];
  // Prefer a spare sequence (runs without disturbing the main chat's cache).
  // Without one, borrow the main chat's own sequence: the main turn is paused
  // waiting for this helper anyway, and node-llama-cpp re-aligns a sequence to
  // the full chat history when generation resumes, so the main chat just
  // re-reads its history afterwards. Slower, but needs no extra memory.
  const spare = chat.context.sequencesLeft > 0;
  const sequence = spare ? chat.context.getSequence() : parent.sequence;
  const session = newSession(chat, sequence, systemPrompt, parent.effort);
  try {
    return await session.prompt(text, promptOptions({ functions, temperature, signal, onText }));
  } finally {
    try { session.dispose({ disposeSequence: spare }); } catch { /* already gone */ }
  }
}

// One plain completion with no tools and no chat history, used for summaries
// and memory consolidation. Takes the same lock as chat turns, so it never
// runs in the middle of one. Borrowing the main sequence means the next chat
// turn reloads its history first.
export async function complete({ systemPrompt, text, maxTokens = 700, temperature = 0.2, signal, slot = 'main' }) {
  const chat = slots[slot];
  if (!chat.model) throw new Error('No chat model loaded');
  const lane = await acquireLane(slot, null);
  try {
    const session = newSession(chat, lane.sequence, systemPrompt, lane.effort);
    try {
      return await session.prompt(text, { maxTokens, temperature, signal, stopOnAbortSignal: true });
    } finally {
      try { session.dispose({ disposeSequence: false }); } catch { /* already gone */ }
      lane.threadId = null; // the sequence was borrowed: the lane's chat is read again next time
    }
  } finally {
    releaseLane(chat, lane);
  }
}

// Compaction: shrink everything except the most recent tool results, so a
// long agent run frees real room before it continues. Calls stay in history
// (the model still sees what it did); only their bulky outputs are trimmed.
const KEEP_RECENT_CALLS = 3;
const OLD_RESULT_CHARS = 240;
const OLD_TEXT_CHARS = 1200;
export function compactHistory(history, { hard = false } = {}) {
  const keep = hard ? 1 : KEEP_RECENT_CALLS;
  const resultChars = hard ? 120 : OLD_RESULT_CHARS;
  const textChars = hard ? 400 : OLD_TEXT_CHARS;
  const out = structuredClone(history);
  const calls = [];
  for (const item of out) {
    if (item.type !== 'model') continue;
    for (const part of item.response) if (part && typeof part === 'object' && part.type === 'functionCall') calls.push(part);
  }
  for (const call of calls.slice(0, Math.max(0, calls.length - keep))) {
    const text = typeof call.result === 'string' ? call.result : JSON.stringify(call.result ?? '');
    if (text.length > resultChars) call.result = `${text.slice(0, resultChars)}… [older output trimmed to save memory]`;
  }
  const lastModel = out.findLastIndex((i) => i.type === 'model');
  out.forEach((item, idx) => {
    if (idx === lastModel && !hard) return;
    if (item.type === 'model') {
      item.response = item.response.map((p) => (typeof p === 'string' && p.length > textChars ? `${p.slice(0, textChars)}… [trimmed]` : p));
    } else if (item.type === 'user' && item.text.length > textChars * 2) {
      item.text = `${item.text.slice(0, textChars * 2)}… [trimmed]`;
    }
  });
  return out;
}

const MAX_SEGMENTS = 8;
const MAX_TEXT_TOOL_RESCUES = 6;

// Text of the model's most recent reply in a chat history.
export function lastModelText(history) {
  const item = [...history].reverse().find((i) => i.type === 'model');
  return item ? item.response.filter((p) => typeof p === 'string').join('') : '';
}

// Tool calls the model wrote as text, in the <tool_call>{"name", "arguments"}
// format these models use. Only tools that are actually available are kept.
export function parseTextToolCalls(text, functions) {
  const calls = [];
  for (const m of String(text).matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) {
    let call;
    try { call = JSON.parse(m[1]); } catch { continue; }
    const name = call?.name;
    let params = call?.arguments ?? call?.parameters ?? {};
    if (typeof params === 'string') { try { params = JSON.parse(params); } catch { continue; } }
    if (name && functions[name] && params && typeof params === 'object') calls.push({ name, params });
  }
  return calls;
}
// A long turn pauses (and compacts) once this segment alone has used a good
// share of the context, or when the context is nearly full. Measuring growth
// rather than total use matters: the system prompt and tool descriptions can
// fill half of a small context before the agent does anything.
const SEGMENT_GROWTH = 0.3;
const SEGMENT_FULL = 0.85;

async function runTurnUnlocked({ threadId, history, systemPrompt, text, functions, temperature, signal, onText, onThought, maxTokens, continuation, slot = 'main', effort = null, lane }) {
  const chat = slots[slot];
  if (!lane?.session) throw new Error('No chat model loaded. Pick one in Models.');
  setEffort(chat, lane, effort);
  const session = lane.session;

  // Switching threads (or changing the system prompt) means restoring that
  // thread's history into the single context sequence we keep loaded.
  const desired = history?.length ? structuredClone(history) : [{ type: 'system', text: systemPrompt }];
  if (desired[0]?.type === 'system') desired[0] = { type: 'system', text: systemPrompt };
  else desired.unshift({ type: 'system', text: systemPrompt });

  if (lane.threadId !== threadId || lane.systemPrompt !== systemPrompt) {
    session.setChatHistory(desired);
    lane.threadId = threadId;
    lane.systemPrompt = systemPrompt;
  }

  try {
    // Long agent runs (Build mode) can call many tools in one response, and a
    // single response can't be trimmed to fit the context. So after each tool
    // call, if the context is filling up, pause this response cleanly and
    // continue in a fresh one; older responses can then be dropped to make room.
    let prompt = text;
    let stalled = 0;
    let recoveries = 0;
    let textToolRescues = 0;
    for (let segment = 0; segment < MAX_SEGMENTS; segment++) {
      const segmentStop = new AbortController();
      const relay = () => segmentStop.abort();
      signal?.addEventListener('abort', relay, { once: true });
      let pausedForRoom = false;
      let calls = 0;
      let baseline = null;
      const watched = functions && Object.fromEntries(Object.entries(functions).map(([name, fn]) => [name, {
        ...fn,
        async handler(params) {
          const result = await fn.handler(params);
          calls++;
          const used = session.sequence.nextTokenIndex;
          const size = chat.context.contextSize;
          baseline ??= used;
          if (used - baseline > size * SEGMENT_GROWTH || used > size * SEGMENT_FULL) {
            pausedForRoom = true;
            segmentStop.abort();
          }
          return result;
        },
      }]));
      let overflowed = false;
      try {
        await session.prompt(prompt, promptOptions({ functions: watched, temperature, signal: segmentStop.signal, onText, onThought, maxTokens, effort }));
      } catch (err) {
        // A reply outgrew the context before any tool call let us pause.
        // Compact hard and continue (at most twice); files already written stay
        // on disk and the plan status is carried into the continuation.
        if (!functions || recoveries >= 2 || !/context shift|context size|too long/i.test(err?.message || '')) throw err;
        recoveries++;
        overflowed = true;
      } finally {
        signal?.removeEventListener('abort', relay);
      }
      if (overflowed) {
        session.setChatHistory(compactHistory(session.getChatHistory(), { hard: true }));
        onText?.('\n\n');
        prompt = (await continuation?.()) || 'Continue where you left off with the next unfinished step.';
        continue;
      }
      if (signal?.aborted) break;
      // write_file was called before its code block: save the block the model
      // wrote afterwards, then let it carry on (e.g. run what it just wrote).
      if (!pausedForRoom && functions?.flushPending) {
        const saved = await functions.flushPending();
        if (saved) {
          onText?.('\n\n');
          prompt = `(Scorpion saved the code block you wrote after calling write_file: ${saved})\nContinue the task. If everything is done, give a short summary.`;
          continue;
        }
      }
      // Small models sometimes write a tool call as plain text (e.g. pretty-
      // printed JSON the call detector doesn't recognise), and the task stalls.
      // Run such calls ourselves and continue with their results.
      if (!pausedForRoom && functions && textToolRescues < MAX_TEXT_TOOL_RESCUES) {
        const calls = parseTextToolCalls(lastModelText(session.getChatHistory()), functions);
        if (calls.length) {
          textToolRescues++;
          const results = [];
          for (const { name, params } of calls) {
            let result;
            try { result = await functions[name].handler(params); } catch (err) { result = `Error: ${err.message}`; }
            results.push(`- ${name}: ${typeof result === 'string' ? result : JSON.stringify(result)}`);
          }
          onText?.('\n\n');
          prompt = `(Scorpion ran the tool call${calls.length > 1 ? 's' : ''} you wrote as text.)\nResults:\n${results.join('\n')}\nContinue the task. Call tools directly instead of writing them as text.`;
          continue;
        }
      }
      if (!pausedForRoom) break;
      // A segment that only managed a single tool call made no real progress;
      // twice in a row means the model is looping, so let it stop there.
      stalled = calls <= 1 ? stalled + 1 : 0;
      if (stalled >= 2) break;
      session.setChatHistory(compactHistory(session.getChatHistory()));
      onText?.('\n\n');
      prompt = (await continuation?.()) || 'Continue where you left off with the next unfinished step. If everything is done and tested, give the final summary.';
    }
  } catch (err) {
    // Force a history reload next turn — the session may be mid-turn.
    lane.threadId = null;
    throw err;
  }
  return session.getChatHistory();
}

// ---------- embeddings (for document search) ----------

export async function loadEmbedModel(modelPath) {
  if (embed.path === modelPath && embed.context) return;
  await embed.context?.dispose().catch(() => {});
  await embed.model?.dispose().catch(() => {});
  const l = await ensureLlama();
  // Embedding models are small and fast on CPU; keeping them off the GPU leaves
  // all video memory for the chat model (matters on integrated GPUs).
  embed.model = await l.loadModel({ modelPath, gpuLayers: 0 });
  embed.context = await embed.model.createEmbeddingContext({ contextSize: { max: 2048 } });
  embed.path = modelPath;
}

export function embedModelName() {
  return embed.path ? path.basename(embed.path) : null;
}

export async function embedText(text) {
  if (!embed.context) throw new Error('No embedding model loaded');
  const e = await embed.context.getEmbeddingFor(text);
  return e.vector;
}

export async function shutdown() {
  await disposeChat(slots.voice);
  await disposeChat(slots.main);
  await embed.context?.dispose().catch(() => {});
  await embed.model?.dispose().catch(() => {});
  await llama?.dispose?.().catch(() => {});
}
