// Plan → Build → Chat with a real local model:
//   node scripts/e2e-modes.mjs <chat.gguf> [gpuLayers]
// Plan mode must produce a plan and change nothing; Build mode (same chat,
// continuing from the plan) must create a working program; Chat mode must not
// touch files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../src/main/store.js';
import * as engine from '../src/main/engine.js';
import * as agents from '../src/main/agents.js';
import { buildFunctions, buildSystemPrompt } from '../src/main/agent.js';
import { runCommand } from '../src/main/tools.js';

const [chatModel, gl] = process.argv.slice(2);
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-modes-'));
const ws = path.join(data, 'ws');
fs.mkdirSync(ws);
store.initStore(data);
const base = store.updateSettings({ chatModel, workspace: ws, memoryEnabled: false });
const info = await engine.loadChatModel(chatModel, { contextSize: 8192, gpuLayers: gl ? Number(gl) : 'auto' });
console.log(`gpu=${info.gpu} layers=${info.gpuLayers}/${info.totalLayers} ctx=${info.contextSize}`);

let history = null;
let plan = [];
let segments = 0;
const continuation = () => {
  segments++;
  console.log('  [— context filling up: continuing in a new segment —]');
  return `(Scorpion: continuing the same task.)\nPlan status:\n${plan.map((s) => `${s.status === 'done' ? '[done]' : '[todo]'} ${s.title}`).join('\n')}\nCarry on with the next unfinished step. When every step is done and tested, give the final summary.`;
};
async function turn(mode, text) {
  console.log(`\n=== ${mode.toUpperCase()} ===\nUSER: ${text}`);
  const settings = { ...base, mode };
  const agent = agents.getAgent('scorpion');
  const events = [];
  let streamed = '';
  const t0 = Date.now();
  history = await engine.runTurn({
    threadId: 'modes', history,
    systemPrompt: buildSystemPrompt(settings, { docNames: [], agent }),
    text, temperature: 0.3, maxTokens: Math.min(mode === 'build' ? 6144 : 3072, Math.floor(info.contextSize / 2)), continuation,
    functions: buildFunctions({
      settings, agent, rag: { hasDocuments: () => false }, memory: null, threadId: 'modes',
      streamedText: () => streamed, runHelper: engine.runHelperTurn, requestApproval: async () => true, maxToolChars: info.maxToolChars,
      emit: (e) => {
        events.push(e);
        if (e.type === 'plan') plan = e.steps;
        if (e.type === 'tool') console.log(`  [${e.name}: ${String(e.summary).slice(0, 90)}]`);
        if (e.type === 'tool-result' && !e.ok) console.log(`  [failed: ${e.output.slice(0, 120)}]`);
        if (e.type === 'plan') console.log(`  [plan: ${e.steps.map((s) => `${s.status === 'done' ? '✓' : '○'} ${s.title}`).join(' | ')}]`);
      },
    }),
    onText: (d) => { streamed += d; },
  });
  console.log(`SCORPION (${((Date.now() - t0) / 1000).toFixed(0)}s): ${streamed.trim().slice(-400)}`);
  return events;
}

const files = () => fs.readdirSync(ws);
process.on('unhandledRejection', (e) => { console.log(`ERROR: ${e?.message || e}`); process.exit(2); });
const planEvents = await turn('plan', 'Plan a tiny command-line JavaScript program todo.mjs: "node todo.mjs add <text>" saves an item to todos.json, and "node todo.mjs list" prints all items numbered.');
const planned = planEvents.some((e) => e.type === 'plan' && e.steps.length >= 2);
const planChangedNothing = files().length === 0;

const planNotDone = plan.length > 0 && plan.every((s) => s.status === 'pending');
// Same message the app's "Build this plan" button sends.
await turn('build', `Build the plan now. None of these steps are done yet:\n${plan.map((s, i) => `${i + 1}. ${s.title}`).join('\n')}\n\nWork through every step with your tools: write the files, run and test them, fix any errors, and mark each step done as you finish it.`);
let works = false;
if (fs.existsSync(path.join(ws, 'todo.mjs'))) {
  await runCommand('node todo.mjs add "buy milk"', ws);
  await runCommand('node todo.mjs add "walk dog"', ws);
  const { output } = await runCommand('node todo.mjs list', ws);
  console.log(`\nindependent check, "node todo.mjs list":\n${output}`);
  works = /buy milk/.test(output) && /walk dog/.test(output);
  if (!works) console.log(`\n--- todo.mjs as built ---\n${fs.readFileSync(path.join(ws, 'todo.mjs'), 'utf8')}\n--- todos.json ---\n${fs.existsSync(path.join(ws, 'todos.json')) ? fs.readFileSync(path.join(ws, 'todos.json'), 'utf8') : '(missing)'}`);
}

const before = files().join(',');
const chatEvents = await turn('chat', 'Thanks! In one sentence, what is a JSON file?');
const chatTouchedNothing = files().join(',') === before && !chatEvents.some((e) => e.type === 'tool' && e.name !== 'calculator');

console.log(`\nsegments used: ${segments}`);
console.log(`\nRESULT plan_made=${planned} plan_left_as_proposal=${planNotDone} plan_changed_nothing=${planChangedNothing} build_created=${fs.existsSync(path.join(ws, 'todo.mjs'))} program_works=${works} chat_no_tools=${chatTouchedNothing} files=[${files().join(', ')}]`);
process.exit(planned && planChangedNothing && works && chatTouchedNothing ? 0 : 1);
