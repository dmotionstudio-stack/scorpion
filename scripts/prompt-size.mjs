// Measures how many tokens every new chat must read before the model can
// answer: the system prompt plus the tool descriptions, per mode.
//   node scripts/prompt-size.mjs <model.gguf>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getLlama, resolveChatWrapper, LlamaLogLevel } from 'node-llama-cpp';
import * as store from '../src/main/store.js';
import * as agents from '../src/main/agents.js';
import { buildFunctions, buildSystemPrompt } from '../src/main/agent.js';

const [modelPath] = process.argv.slice(2);
store.initStore(fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-size-')));
const llama = await getLlama({ build: 'never', gpu: false, logLevel: LlamaLogLevel.error });
const model = await llama.loadModel({ modelPath, vocabOnly: true });
const wrapper = resolveChatWrapper({ bosString: model.tokens.bosString, filename: model.filename, fileInfo: model.fileInfo, tokenizer: model.tokenizer });

const base = { ...store.getSettings(), workspace: os.tmpdir(), memoryEnabled: true };
const agent = agents.getAgent('scorpion');
const rows = [];
for (const mode of ['chat', 'plan', 'build']) {
  const settings = { ...base, mode };
  const system = buildSystemPrompt(settings, { docNames: [], memoryBlock: '', agent });
  const functions = buildFunctions({ settings, agent, rag: { hasDocuments: () => false }, memory: {}, emit() {}, requestApproval: async () => true, runHelper: async () => '' });
  const { contextText } = wrapper.generateContextState({ chatHistory: [{ type: 'system', text: system }, { type: 'user', text: 'hi' }], availableFunctions: functions, documentFunctionParams: true });
  rows.push({ mode, tools: Object.keys(functions).length, systemPromptTokens: model.tokenize(system).length, totalTokensBeforeAnswer: contextText.tokenize(model.tokenizer).length });
}
console.table(rows);
process.exit(0);
