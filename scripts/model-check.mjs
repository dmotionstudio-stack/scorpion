// Checks whether a model is a good fit for Scorpion on this machine, using the
// real engine and agent code:
//   node scripts/model-check.mjs <model.gguf> [name]
// Prints one JSON line: load time plus two agent tests (calls the calculator
// correctly; writes a file in Build mode). For speed, use scripts/bench.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../src/main/store.js';
import * as engine from '../src/main/engine.js';
import * as agents from '../src/main/agents.js';
import { buildFunctions, buildSystemPrompt } from '../src/main/agent.js';

const [modelPath, name = path.basename(modelPath)] = process.argv.slice(2);
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-check-'));
const ws = path.join(data, 'ws');
fs.mkdirSync(ws);
store.initStore(data);
const base = store.updateSettings({ chatModel: modelPath, workspace: ws, memoryEnabled: false, autoApprove: true });
const agent = agents.getAgent('scorpion');

const t0 = Date.now();
const info = await engine.loadChatModel(modelPath, { contextSize: 8192, name });
const loadSec = (Date.now() - t0) / 1000;

async function turn(mode, text, threadId) {
  const settings = { ...base, mode };
  const tools = [];
  let streamed = '';
  let thinking = 0;
  const t = Date.now();
  await engine.runTurn({
    threadId, history: null, text, temperature: 0.2, maxTokens: 1500,
    systemPrompt: buildSystemPrompt(settings, { docNames: [], agent }),
    functions: buildFunctions({
      settings, agent, rag: { hasDocuments: () => false }, memory: null, threadId,
      streamedText: () => streamed, requestApproval: async () => true,
      emit: (e) => { if (e.type === 'tool') tools.push(e.name); },
    }),
    onText: (d) => { streamed += d; },
    onThought: (d) => { thinking += d.length; },
  });
  return { text: streamed, tools, sec: (Date.now() - t) / 1000, thinking };
}

let calc = { pass: false };
let file = { pass: false };
try {
  const r = await turn('chat', 'Use the calculator to compute 1234 * 5678 and tell me the result.', 'calc');
  calc = { pass: r.tools.includes('calculator') && /7,?006,?652/.test(r.text), sec: +r.sec.toFixed(1), thinking: r.thinking > 0 };
} catch (err) { calc = { pass: false, error: err.message.slice(0, 80) }; }
try {
  const r = await turn('build', 'Create a file named hello.txt whose entire content is exactly: scorpion', 'file');
  const f = path.join(ws, 'hello.txt');
  const content = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : null;
  file = { pass: content === 'scorpion', sec: +r.sec.toFixed(1), got: content === null ? 'no file' : content.slice(0, 30) };
} catch (err) { file = { pass: false, error: err.message.slice(0, 80) }; }

console.log(JSON.stringify({
  name, gb: +(fs.statSync(modelPath).size / 2 ** 30).toFixed(2),
  layers: `${info.gpuLayers}/${info.totalLayers}`, ctx: info.contextSize, loadSec: +loadSec.toFixed(1),
  calc, file,
}));
fs.rmSync(data, { recursive: true, force: true });
await engine.shutdown();
process.exit(0);
