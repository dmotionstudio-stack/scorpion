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
  // node-llama-cpp sizes the context to fit memory, but its estimate can be off
  // on shared-memory GPUs, so step down on allocation failure.
  for (let size = contextSize; ; size = Math.floor(size / 2)) {
    try {
      chat.context = await chat.model.createContext({ contextSize: { min: Math.min(2048, size), max: size } });
      break;
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
export async function runTurn({ threadId, history, systemPrompt, text, functions, temperature, signal, onText, onThought }) {
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
    await session.prompt(text, {
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
    });
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
