// How a model handles spoken conversation in other languages:
//   node scripts/lang-check.mjs <chat.gguf> [gpuLayers]
// For French, Spanish and Haitian Creole it measures time to the first words
// and writing speed, and prints the reply, using Scorpion's own spoken-turn
// instructions. Judge the language quality by reading the replies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../src/main/store.js';
import * as engine from '../src/main/engine.js';
import * as agents from '../src/main/agents.js';
import { buildFunctions, buildSystemPrompt } from '../src/main/agent.js';

const [modelPath, gl] = process.argv.slice(2);
store.initStore(fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-lang-')));
const info = await engine.loadChatModel(modelPath, { contextSize: 8192, gpuLayers: gl === undefined ? 'auto' : Number(gl) });
console.log(`${path.basename(modelPath)}: ${info.gpu}, ${info.gpuLayers}/${info.totalLayers} layers on GPU`);

const turns = [
  ['fr', 'Salut ! Comment tu vas aujourd’hui ? Raconte-moi quelque chose d’intéressant sur la mer.'],
  ['es', 'Hola, ¿qué me recomiendas para dormir mejor por la noche?'],
  ['ht', 'Bonjou! Kijan ou ye? Ki sa ou ka di m sou Ayiti?'],
];
for (const [lang, text] of turns) {
  const settings = { ...store.getSettings(), mode: 'chat', voiceLanguage: lang, memoryEnabled: false };
  const agent = agents.getAgent('scorpion');
  let out = '';
  let first = 0;
  let chunks = 0;
  const t0 = performance.now();
  await engine.runTurn({
    threadId: `lang-${lang}`, history: null, temperature: 0.6, maxTokens: 400,
    systemPrompt: buildSystemPrompt(settings, { docNames: [], agent, spoken: true }),
    text,
    functions: buildFunctions({ settings, agent, rag: { hasDocuments: () => false }, emit() {}, requestApproval: async () => true, streamedText: () => out }),
    onText: (d) => { if (!first && d.trim()) first = performance.now(); out += d; chunks++; },
  });
  const secs = (performance.now() - t0) / 1000;
  const reply = out.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  console.log(`\n[${lang}] first words ${first ? ((first - t0) / 1000).toFixed(1) : '-'}s, total ${secs.toFixed(1)}s, ~${Math.round(chunks / secs)} chunks/s`);
  console.log(`  YOU: ${text}\n  AI : ${reply.replace(/\s+/g, ' ').slice(0, 400)}`);
}
await engine.shutdown?.();
process.exit(0);
