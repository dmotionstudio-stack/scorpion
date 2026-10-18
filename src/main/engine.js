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
    contextSize: chat.context?.contextSize ?? null,
    parallelHelpers: chat.context ? chat.context.totalSequences > 1 : null,
    chatModel: chat.path,
    embedModel: embed.path,
  };
}

async function disposeChat() {
  try { chat.session?.dispose({ disposeSequence: true }); } catch { /* already disposed */ }
  await chat.context?.dispose().catch(() => {});
  await chat.model?.dispose().catch(() => {});
  Object.assign(chat, { path: null, model: null, context: null, session: null, threadId: null, systemPrompt: null });
}

export async function loadChatModel(modelPath, { contextSize = 8192, onProgress } = {}) {
  if (chat.path === modelPath && chat.model) return engineInfo();
  await disposeChat();
  const l = await ensureLlama();
  chat.model = await l.loadModel({
    modelPath,
    onLoadProgress: (p) => onProgress?.(p),
  });
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

export function chatModelName() {
  return chat.path ? path.basename(chat.path, '.gguf') : null;
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

function promptOptions({ functions, temperature, signal, onText, onThought }) {
  return {
    functions,
    temperature,
    signal,
    stopOnAbortSignal: true,
    // Small models sometimes loop (e.g. endless whitespace after a tool call);
    // cap each response so a runaway can't fill the whole context.
    maxTokens: 3072,
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

async function runTurnUnlocked({ threadId, history, systemPrompt, text, functions, temperature, signal, onText, onThought }) {
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
    await session.prompt(text, promptOptions({ functions, temperature, signal, onText, onThought }));
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
