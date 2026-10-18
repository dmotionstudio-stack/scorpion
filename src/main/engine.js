// The only module that touches llama.cpp. Loads GGUF models in-process via
// node-llama-cpp's prebuilt binaries (Metal on macOS, CUDA/Vulkan/CPU on Windows),
// so inference needs no server, no port and no network.
import path from 'node:path';
import { getLlama, LlamaChatSession, LlamaLogLevel } from 'node-llama-cpp';

let llama = null;
const chat = { path: null, model: null, context: null, session: null, threadId: null, systemPrompt: null };
const embed = { path: null, model: null, context: null };

async function ensureLlama() {
  // build: 'never' — an installed app must never try to compile llama.cpp.
  llama ??= await getLlama({ build: 'never', logLevel: LlamaLogLevel.error });
  return llama;
}

export async function engineInfo() {
  const l = await ensureLlama();
  return {
    gpu: l.gpu || 'cpu',
    maxToolChars: chat.context ? Math.max(3000, chat.context.contextSize) : null,
    contextSize: chat.context?.contextSize ?? null,
    gpuLayers: chat.model ? chat.model.gpuLayers : null,
    totalLayers: chat.model ? chat.model.fileInsights.totalLayers : null,
    parallelHelpers: chat.context ? chat.context.totalSequences > 1 : null,
    chatModel: chat.path,
    chatModelName: chatModelName(),
    embedModel: embed.path,
  };
}

async function disposeChat() {
  try { chat.session?.dispose({ disposeSequence: true }); } catch { /* already disposed */ }
  await chat.context?.dispose().catch(() => {});
  await chat.model?.dispose().catch(() => {});
  Object.assign(chat, { path: null, model: null, context: null, session: null, threadId: null, systemPrompt: null });
}

export async function loadChatModel(modelPath, { contextSize = 8192, gpuLayers: requested = 'auto', name = null, onProgress } = {}) {
  if (chat.path === modelPath && chat.model && chat.requestedGpuLayers === requested) return engineInfo();
  await disposeChat();
  const l = await ensureLlama();
  // The automatic GPU-offload estimate can overshoot on shared-memory GPUs. If
  // it fails, fall back conservatively (generation needs memory beyond what
  // loading does), down to CPU-only. A number from Settings is tried first.
  let loadErr;
  const attempts = typeof requested === 'number' ? [requested, ...[8, 0].filter((n) => n < requested)] : [requested, 16, 8, 0];
  for (const gpuLayers of attempts) {
    try {
      chat.model = await l.loadModel({ modelPath, gpuLayers, onLoadProgress: (p) => onProgress?.(p) });
      break;
    } catch (err) { loadErr = err; }
  }
  if (!chat.model) throw loadErr;
  chat.name = name;
  chat.requestedGpuLayers = requested;
  // A second sequence lets a helper agent run while the main chat waits on it,
  // but each sequence costs a full context of memory. The main chat's context
  // matters more, so keep 2 sequences only if the main one still gets (almost)
  // the full size; otherwise helpers borrow a temporary context when needed.
  // node-llama-cpp's memory estimate can be off on shared-memory GPUs, so also
  // step down on allocation failure.
  try {
    const two = await chat.model.createContext({ sequences: 2, contextSize: { min: 2048, max: contextSize } });
    if (two.contextSize >= contextSize * 0.9) chat.context = two;
    else await two.dispose();
  } catch { /* fall through to a single sequence */ }
  for (let size = contextSize; !chat.context; size = Math.floor(size / 2)) {
    try {
      chat.context = await chat.model.createContext({ contextSize: { min: Math.min(2048, size), max: size } });
    } catch (err) {
      if (size <= 2048) { await disposeChat(); throw err; }
    }
  }
  chat.session = new LlamaChatSession({ contextSequence: chat.context.getSequence() });
  chat.path = modelPath;
  return engineInfo();
}

export async function unloadChatModel() {
  await disposeChat();
}

export function isChatReady() {
  return Boolean(chat.session);
}

// Ollama blobs are named by hash, so callers pass a friendly name when loading.
export function chatModelName() {
  return chat.path ? chat.name || path.basename(chat.path, '.gguf') : null;
}

/**
 * Run one user turn on a thread. `history` is the thread's saved node-llama-cpp
 * chat history (or null for a fresh thread). Returns the updated history.
 */
// One loaded model serves every chat, scheduled run and helper, so main turns
// take turns. (Helpers run *inside* a main turn, on their own sequence, and
// don't take the lock.)
let queue = Promise.resolve();
function withLock(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export function runTurn(opts) {
  return withLock(() => runTurnUnlocked(opts));
}

function promptOptions({ functions, temperature, signal, onText, onThought, maxTokens = 3072 }) {
  return {
    functions,
    temperature,
    signal,
    stopOnAbortSignal: true,
    // Small models sometimes loop (e.g. endless whitespace after a tool call);
    // cap each response so a runaway can't fill the whole context.
    maxTokens,
    repeatPenalty: { lastTokens: 64, penalty: 1.1 },
    onFunctionCallParamsChunk: process.env.KENZO_DEBUG ? (c) => process.stdout.write(`{${c.paramsChunk}}`) : undefined,
    onResponseChunk(chunk) {
      if (chunk.type === 'segment' && chunk.segmentType === 'thought') onThought?.(chunk.text);
      else if (chunk.type !== 'segment') onText?.(chunk.text);
    },
  };
}

/** Run a helper agent on a fresh, separate session. Returns its final answer. */
export async function runHelperTurn({ systemPrompt, text, functions, temperature, signal, onText }) {
  if (!chat.model) throw new Error('No chat model loaded');
  // Prefer a spare sequence (runs without disturbing the main chat's cache).
  // Without one, borrow the main chat's own sequence: the main turn is paused
  // waiting for this helper anyway, and node-llama-cpp re-aligns a sequence to
  // the full chat history when generation resumes, so the main chat just
  // re-reads its history afterwards. Slower, but needs no extra memory.
  const spare = chat.context.sequencesLeft > 0;
  const sequence = spare ? chat.context.getSequence() : chat.session.sequence;
  const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt });
  try {
    return await session.prompt(text, promptOptions({ functions, temperature, signal, onText }));
  } finally {
    try { session.dispose({ disposeSequence: spare }); } catch { /* already gone */ }
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
// A long turn pauses (and compacts) once this segment alone has used a good
// share of the context, or when the context is nearly full. Measuring growth
// rather than total use matters: the system prompt and tool descriptions can
// fill half of a small context before the agent does anything.
const SEGMENT_GROWTH = 0.3;
const SEGMENT_FULL = 0.85;

async function runTurnUnlocked({ threadId, history, systemPrompt, text, functions, temperature, signal, onText, onThought, maxTokens, continuation }) {
  if (!chat.session) throw new Error('No chat model loaded. Pick one in Models.');
  const session = chat.session;

  // Switching threads (or changing the system prompt) means restoring that
  // thread's history into the single context sequence we keep loaded.
  const desired = history?.length ? structuredClone(history) : [{ type: 'system', text: systemPrompt }];
  if (desired[0]?.type === 'system') desired[0] = { type: 'system', text: systemPrompt };
  else desired.unshift({ type: 'system', text: systemPrompt });

  if (chat.threadId !== threadId || chat.systemPrompt !== systemPrompt) {
    session.setChatHistory(desired);
    chat.threadId = threadId;
    chat.systemPrompt = systemPrompt;
  }

  try {
    // Long agent runs (Build mode) can call many tools in one response, and a
    // single response can't be trimmed to fit the context. So after each tool
    // call, if the context is filling up, pause this response cleanly and
    // continue in a fresh one; older responses can then be dropped to make room.
    let prompt = text;
    let stalled = 0;
    let recoveries = 0;
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
        await session.prompt(prompt, promptOptions({ functions: watched, temperature, signal: segmentStop.signal, onText, onThought, maxTokens }));
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
        prompt = continuation?.() || 'Continue where you left off with the next unfinished step.';
        continue;
      }
      if (!pausedForRoom || signal?.aborted) break;
      // A segment that only managed a single tool call made no real progress;
      // twice in a row means the model is looping, so let it stop there.
      stalled = calls <= 1 ? stalled + 1 : 0;
      if (stalled >= 2) break;
      session.setChatHistory(compactHistory(session.getChatHistory()));
      onText?.('\n\n');
      prompt = continuation?.() || 'Continue where you left off with the next unfinished step. If everything is done and tested, give the final summary.';
    }
  } catch (err) {
    // Force a history reload next turn — the session may be mid-turn.
    chat.threadId = null;
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
  await disposeChat();
  await embed.context?.dispose().catch(() => {});
  await embed.model?.dispose().catch(() => {});
  await llama?.dispose?.().catch(() => {});
}
