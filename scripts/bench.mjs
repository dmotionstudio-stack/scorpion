// Speed benchmark for one backend/model combination:
//   node scripts/bench.mjs <model.gguf> <cuda|vulkan|cpu|auto> [gpuLayers|auto] [contextSize]
// Prints load time, prompt processing and generation speed (tokens/second).
import path from 'node:path';
import { getLlama, LlamaChatSession, LlamaLogLevel } from 'node-llama-cpp';

const [modelPath, backend = 'auto', layersArg = 'auto', ctxArg = '4096', faArg = 'off'] = process.argv.slice(2);
const gpu = backend === 'cpu' ? false : backend === 'auto' ? 'auto' : backend;
const t0 = Date.now();
const llama = await getLlama({ build: 'never', gpu, logLevel: LlamaLogLevel.error });
const devices = llama.gpu ? await llama.getGpuDeviceNames().catch(() => []) : [];
const model = await llama.loadModel({ modelPath, gpuLayers: layersArg === 'auto' ? 'auto' : Number(layersArg) });
const context = await model.createContext({ contextSize: Number(ctxArg), flashAttention: faArg === 'fa' });
const loadMs = Date.now() - t0;
const session = new LlamaChatSession({ contextSequence: context.getSequence() });

// Prompt processing: a ~600-token prompt, like a system prompt with tools.
const longPrompt = 'Summarize in one word: ' + 'The quick brown fox jumps over the lazy dog. '.repeat(60);
let t = Date.now();
await session.prompt(longPrompt, { maxTokens: 1 });
const promptTokens = model.tokenize(longPrompt).length;
const ppMs = Date.now() - t;

// Generation speed.
let generated = 0;
t = Date.now();
let thinking = 0;
await session.prompt('Write a 200-word story about a lighthouse keeper.', { maxTokens: 128, temperature: 0, onResponseChunk: (c) => { const n = model.tokenize(c.text).length; generated += n; if (c.type === 'segment') thinking += n; } });
const genMs = Date.now() - t;

console.log(JSON.stringify({
  model: path.basename(modelPath).slice(-40),
  backend: llama.gpu || 'cpu',
  devices,
  gpuLayers: `${model.gpuLayers}/${model.fileInsights.totalLayers}`,
  context: context.contextSize,
  flashAttention: faArg === 'fa',
  loadSec: +(loadMs / 1000).toFixed(1),
  promptTokPerSec: Math.round(promptTokens / (ppMs / 1000)),
  genTokPerSec: +(generated / (genMs / 1000)).toFixed(1),
  thinkingTokens: thinking,
}));
process.exit(0);
