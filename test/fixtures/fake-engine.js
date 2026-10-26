// A stand-in for engine.js in the engine-process tests: the same kind of
// calls (tools, streamed text, continuation, flushPending, abort), no model.
let loaded = null;
let forgotten = 0;

export const isChatReady = (slot = 'main') => slot === 'main' && Boolean(loaded);
export const chatModelName = (slot = 'main') => (slot === 'main' ? loaded : null);
export const usesReasoningEffort = () => false;
export const embedModelName = () => null;
export const forgetLoadedThread = () => { forgotten++; };

export async function loadChatModel(file, { name, onProgress } = {}) {
  onProgress?.(0.5);
  onProgress?.(1);
  loaded = name || file;
  return { chatModel: file };
}

export async function runTurn({ text, functions, onText, continuation }) {
  onText?.('Hel');
  onText?.('lo');
  const tool = await functions.read_file.handler({ path: text });
  const saved = functions.flushPending ? await functions.flushPending() : null;
  const next = await continuation?.();
  return [{ type: 'model', response: [`tool=${tool} saved=${saved} next=${next} forgotten=${forgotten}`] }];
}

export function complete({ signal }) {
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve('stopped'), { once: true }));
}

export async function embedText(text) {
  if (text === 'bad') throw new Error('No embedding model loaded');
  return [1, 2, 3];
}

export async function engineInfo() {
  process.exit(7); // the engine crashing
}

export async function shutdown() {}
