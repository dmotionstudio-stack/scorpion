import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../src/main/store.js';
import * as agents from '../src/main/agents.js';
import * as scheduler from '../src/main/scheduler.js';
import { TOOLS, resolveInside as resolveInsideFn } from '../src/main/tools.js';
import { evaluate } from '../src/main/calc.js';
import { buildFunctions, buildSystemPrompt } from '../src/main/agent.js';
import { applyEvent, findTool } from '../src/shared/events.js';

store.initStore(fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-agents-')));
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-agents-ws-'));
const ctx = { workspace: ws };

test('calculator evaluates safely', () => {
  assert.equal(evaluate('2 + 3 * 4'), 14);
  assert.ok(Math.abs(evaluate('(1250 * 0.07) / 12') - 7.291666666666667) < 1e-12);
  assert.match(TOOLS.calculator.run({ expression: '0.1 + 0.2' }), /= 0.3$/);
  assert.equal(evaluate('2^3^2'), 512);
  assert.equal(evaluate('-sqrt(16) + max(1, 7, 3)'), 3);
  assert.equal(evaluate('1,250 * 2'), 2500);
  assert.throws(() => evaluate('process.exit()'), /Cannot parse|Unknown/);
  assert.throws(() => evaluate('2 +'), /Unexpected end/);
  assert.match(TOOLS.calculator.run({ expression: '10 / 4' }), /= 2\.5/);
});

test('read_spreadsheet summarizes CSV with quotes and numeric stats', async () => {
  fs.writeFileSync(path.join(ws, 'sales.csv'), 'region,amount,note\nNorth,100,"big, early"\nSouth,250,ok\nEast,"1,000",x\n');
  const out = await TOOLS.read_spreadsheet.run({ path: 'sales.csv', sheet: '' }, ctx);
  assert.match(out, /3 data rows × 3 columns/);
  assert.match(out, /big, early/);
  assert.match(out, /amount: count 3, sum 1350, mean 450/);
});

test('read_spreadsheet reads .xlsx', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const sh = wb.addWorksheet('Q1');
  sh.addRow(['item', 'qty']); sh.addRow(['apples', 3]); sh.addRow(['pears', 5]);
  wb.addWorksheet('Q2').addRow(['empty']);
  await wb.xlsx.writeFile(path.join(ws, 'stock.xlsx'));
  const out = await TOOLS.read_spreadsheet.run({ path: 'stock.xlsx', sheet: '' }, ctx);
  assert.match(out, /Sheets: Q1, Q2/);
  assert.match(out, /qty: count 2, sum 8/);
});

test('read_document and move_file', async () => {
  fs.writeFileSync(path.join(ws, 'notes.md'), '# Notes\nhello');
  assert.match(await TOOLS.read_document.run({ path: 'notes.md' }, ctx), /hello/);
  assert.match(TOOLS.move_file.run({ from: 'notes.md', to: 'archive/notes.md' }, ctx), /Moved/);
  assert.ok(fs.existsSync(path.join(ws, 'archive', 'notes.md')));
  fs.writeFileSync(path.join(ws, 'a.txt'), 'a');
  assert.throws(() => TOOLS.move_file.run({ from: 'a.txt', to: 'archive/notes.md' }, ctx), /already exists/);
  assert.throws(() => TOOLS.move_file.run({ from: 'a.txt', to: '../escape.txt' }, ctx), /outside the workspace/);
});

test('run_code runs JavaScript from the last code block', async () => {
  const args = TOOLS.run_code.prepare({ language: 'javascript' }, { lastCodeBlock: () => 'console.log([1,2,3].reduce((a,b)=>a+b))' });
  const out = await TOOLS.run_code.run(args, ctx);
  assert.match(out, /exit code 0\n6/);
  assert.throws(() => TOOLS.run_code.prepare({ language: 'javascript' }, { lastCodeBlock: () => null }), /No code block/);
});

test('custom agents can be saved, edited and deleted; built-ins are protected', () => {
  assert.ok(agents.listAgents().length >= 7);
  const a = agents.saveAgent({ name: 'Tutor', icon: '🎓', instructions: 'Teach.', tools: ['calculator'] });
  assert.match(a.id, /^custom-/);
  agents.saveAgent({ ...a, description: 'Math help' });
  assert.equal(agents.getAgent(a.id).description, 'Math help');
  assert.equal(agents.findAgentByName('tutor').id, a.id);
  assert.throws(() => agents.saveAgent({ id: 'coder', name: 'X' }), /Built-in/);
  agents.deleteAgent(a.id);
  assert.equal(agents.getAgent(a.id).id, 'scorpion'); // falls back to the general agent
});

test('each agent only gets its own tools; helpers cannot delegate', () => {
  const settings = { ...store.getSettings(), workspace: ws, memoryEnabled: true };
  const rag = { hasDocuments: () => false };
  const base = { settings, rag, memory: {}, emit() {}, requestApproval: async () => true, runHelper: async () => 'x' };
  const names = (agent, extra = {}) => Object.keys(buildFunctions({ ...base, agent, ...extra })).sort();

  const reviewer = names(agents.getAgent('reviewer'));
  assert.deepEqual(reviewer, ['ask_agent', 'calculator', 'list_files', 'read_document', 'read_file', 'run_code', 'search_files'].filter((n) => n !== 'ask_agent').sort());
  assert.ok(names(agents.getAgent('scorpion')).includes('ask_agent'));
  assert.ok(!names(agents.getAgent('coder'), { isHelper: true }).includes('ask_agent'));
  assert.ok(!names(agents.getAgent('researcher')).includes('write_file'));
  // Plan mode strips anything that changes files or runs programs.
  const planned = names(agents.getAgent('coder'), { settings: { ...settings, mode: 'plan' } });
  assert.ok(!planned.some((n) => ['write_file', 'edit_file', 'move_file', 'run_command', 'run_code'].includes(n)));
  // Without a workspace, file tools disappear but calculator/run_code stay.
  const noWs = names(agents.getAgent('analyst'), { settings: { ...settings, workspace: null } });
  assert.ok(noWs.includes('calculator') && noWs.includes('run_code') && !noWs.includes('read_spreadsheet'));
});

test('system prompts use agent instructions and list teammates', () => {
  const settings = { ...store.getSettings(), memoryEnabled: true };
  const p = buildSystemPrompt(settings, { docNames: [], agent: agents.getAgent('coder') });
  assert.match(p, /You are Coder/);
  assert.match(p, /Specialists: .*Reviewer/);
  const helper = buildSystemPrompt(settings, { docNames: [], agent: agents.getAgent('reviewer'), isHelper: true });
  assert.match(helper, /Another agent asked you/);
  assert.doesNotMatch(helper, /ask_agent|long-term memory/);
});

test('helper events nest inside the delegating tool card', () => {
  const blocks = [];
  applyEvent(blocks, { type: 'text', delta: 'Let me ask the reviewer. ' });
  applyEvent(blocks, { type: 'tool', id: 'p1', name: 'ask_agent', args: { agent: 'Reviewer' } });
  applyEvent(blocks, { type: 'tool', id: 'c1', name: 'read_file', parent: 'p1' });
  applyEvent(blocks, { type: 'tool-result', id: 'c1', ok: true, output: 'code', parent: 'p1' });
  applyEvent(blocks, { type: 'helper-text', delta: 'Looks ', parent: 'p1' });
  applyEvent(blocks, { type: 'helper-text', delta: 'good.', parent: 'p1' });
  applyEvent(blocks, { type: 'tool-result', id: 'p1', ok: true, output: 'Looks good.' });
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].status, 'ok');
  assert.deepEqual(blocks[1].children.map((c) => c.type), ['tool', 'text']);
  assert.equal(blocks[1].children[1].text, 'Looks good.');
  assert.equal(findTool(blocks, 'c1').status, 'ok');
});

test('scheduler validates input and computes next run times', () => {
  assert.throws(() => scheduler.saveSchedule({ name: 'x', prompt: 'y', trigger: { type: 'daily', time: 'noon' } }), /08:30/);
  assert.throws(() => scheduler.saveSchedule({ name: 'x', prompt: 'y', trigger: { type: 'folder', folder: path.join(ws, 'nope') } }), /existing folder/);
  const s = scheduler.saveSchedule({ name: 'Digest', prompt: 'Summarize', trigger: { type: 'interval', minutes: 1 } });
  assert.equal(s.trigger.minutes, 5); // minimum interval
  assert.equal(scheduler.nextRunAt(s), s.createdAt + 5 * 60_000);

  const created = new Date(2026, 9, 18, 7, 0).getTime();
  const daily = { enabled: true, createdAt: created, lastRunAt: null, trigger: { type: 'daily', time: '08:30' } };
  assert.equal(scheduler.nextRunAt(daily, new Date(2026, 9, 18, 8, 0).getTime()), new Date(2026, 9, 18, 8, 30).getTime());
  // Past 08:30 and not yet run today → due now.
  assert.equal(scheduler.nextRunAt(daily, new Date(2026, 9, 18, 9, 0).getTime()), new Date(2026, 9, 18, 8, 30).getTime());
  // Already ran today → tomorrow.
  const ran = { ...daily, lastRunAt: new Date(2026, 9, 18, 8, 31).getTime() };
  assert.equal(scheduler.nextRunAt(ran, new Date(2026, 9, 18, 9, 0).getTime()), new Date(2026, 9, 19, 8, 30).getTime());
  assert.equal(scheduler.nextRunAt({ ...daily, enabled: false }), null);
  scheduler.deleteSchedule(s.id);
  assert.equal(scheduler.listSchedules().length, 0);
});

test('JSON files with a byte-order mark still load', () => {
  fs.writeFileSync(path.join(store.paths.data, 'agents.json'), '﻿[{"id":"custom-bom","name":"Bom","tools":["*"]}]');
  assert.equal(agents.getAgent('custom-bom').name, 'Bom');
});

test('models can be uninstalled and partial downloads are cleaned up', async () => {
  const models = await import('../src/main/models.js');
  const lib = store.paths.models;
  fs.mkdirSync(lib, { recursive: true });
  const file = path.join(lib, 'hf_unsloth_Qwen3-4B-Instruct-2507-Q4_K_M.gguf');
  fs.writeFileSync(file, 'GGUF');
  fs.writeFileSync(`${file}.ipull`, 'partial');
  fs.writeFileSync(path.join(lib, 'other.gguf.ipull'), 'partial');
  const list = models.listLocalModels({ resourcesPath: '', appRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-noapp-')) });
  const item = models.CATALOG.find((c) => c.id === 'qwen3-4b');
  assert.equal(models.findInstalled(item, list)?.path, file);
  assert.equal(models.cleanPartialDownloads(), 2);
  assert.ok(fs.existsSync(file)); // complete models are never touched by cleanup
  models.uninstallModel(file);
  assert.ok(!fs.existsSync(file));
  assert.equal(models.findInstalled(item, models.listLocalModels({ resourcesPath: '', appRoot: os.tmpdir() })), null);
  assert.throws(() => models.uninstallModel(path.join(os.tmpdir(), 'elsewhere.gguf')), /Scorpion library/);
});
test('chat, plan and build modes offer the right tools and instructions', () => {
  const settings = { ...store.getSettings(), workspace: ws, memoryEnabled: true };
  const rag = { hasDocuments: () => false };
  const base = { rag, memory: {}, emit() {}, requestApproval: async () => true, runHelper: async () => 'x', agent: agents.getAgent('scorpion') };
  const tools = (mode) => Object.keys(buildFunctions({ ...base, settings: { ...settings, mode } }));

  const chat = tools('chat');
  assert.ok(chat.includes('calculator') && chat.includes('remember'));
  assert.ok(!chat.some((n) => ['write_file', 'read_file', 'run_command', 'run_code', 'ask_agent', 'update_plan'].includes(n)));

  const plan = tools('plan');
  assert.ok(plan.includes('read_file') && plan.includes('update_plan') && plan.includes('ask_agent'));
  assert.ok(!plan.some((n) => ['write_file', 'edit_file', 'move_file', 'run_command', 'run_code'].includes(n)));

  const build = tools('build');
  assert.ok(['write_file', 'run_command', 'run_code', 'update_plan', 'ask_agent'].every((n) => build.includes(n)));

  const prompt = (mode) => buildSystemPrompt({ ...settings, mode }, { docNames: [] });
  assert.match(prompt('chat'), /CHAT MODE/);
  assert.doesNotMatch(prompt('chat'), /ask_agent/);
  assert.match(prompt('plan'), /PLAN MODE/);
  assert.match(prompt('build'), /BUILD MODE/);
});

test('compaction trims old tool output but keeps recent calls and the latest reply', async () => {
  const { compactHistory } = await import('../src/main/engine.js');
  const call = (i, size) => ({ type: 'functionCall', name: 'read_file', params: { path: `f${i}` }, result: 'x'.repeat(size) });
  const history = [
    { type: 'system', text: 'sys' },
    { type: 'user', text: 'build it' },
    { type: 'model', response: ['y'.repeat(5000), call(1, 9000), call(2, 9000), call(3, 9000), call(4, 9000), 'last words'] },
    { type: 'user', text: 'continue' },
    { type: 'model', response: ['z'.repeat(5000)] },
  ];
  const out = compactHistory(history);
  const calls = out[2].response.filter((p) => typeof p === 'object');
  assert.ok(calls[0].result.length < 300 && /trimmed/.test(calls[0].result));
  assert.equal(calls[3].result.length, 9000); // recent calls stay intact
  assert.ok(out[2].response[0].length < 1300); // old long text trimmed
  assert.equal(out[4].response[0].length, 5000); // latest model reply untouched
  assert.equal(history[2].response[1].result.length, 9000); // input not mutated
});

test('a code block feeds only one write, and JSON blocks cannot become programs', async () => {
  const { TOOLS: T } = await import('../src/main/tools.js');
  let text = 'Here is the data:\n```json\n[]\n```\n';
  const written = [];
  const settings = { ...store.getSettings(), workspace: ws, mode: 'build', autoApprove: true };
  const fns = buildFunctions({ settings, agent: agents.getAgent('coder'), rag: { hasDocuments: () => false }, emit() {}, requestApproval: async () => true, streamedText: () => text });
  assert.match(await fns.write_file.handler({ path: 'data/todos.json' }), /Created/);
  written.push(fs.readFileSync(path.join(ws, 'data/todos.json'), 'utf8'));
  // No new block: must not reuse the JSON block for the program.
  assert.match(await fns.write_file.handler({ path: 'data/todo.mjs' }), /no new ``` code block/);
  assert.ok(!fs.existsSync(path.join(ws, 'data/todo.mjs')));
  text += 'And the program:\n```js\nconsole.log("ok")\n```\n';
  assert.match(await fns.write_file.handler({ path: 'data/todo.mjs' }), /Created/);
  assert.equal(fs.readFileSync(path.join(ws, 'data/todo.mjs'), 'utf8'), 'console.log("ok")\n');
  assert.deepEqual(written, ['[]\n']);
  assert.throws(() => T.write_file.prepare({ path: 'x.mjs' }, { lastCodeBlock: () => '[]', lastCodeLang: () => 'json' }), /is JSON/);
});

test('hard compaction keeps only the latest call in full', async () => {
  const { compactHistory } = await import('../src/main/engine.js');
  const call = (i) => ({ type: 'functionCall', name: 'run_command', params: { command: `c${i}` }, result: 'r'.repeat(5000) });
  const out = compactHistory([{ type: 'user', text: 'go' }, { type: 'model', response: [call(1), call(2), call(3)] }, { type: 'user', text: 'more' }, { type: 'model', response: ['done'] }], { hard: true });
  const [a, b, c] = out[1].response;
  assert.ok(a.result.length < 200 && b.result.length < 200);
  assert.equal(c.result.length, 5000);
});

test('hard compaction also trims the most recent long reply', async () => {
  const { compactHistory } = await import('../src/main/engine.js');
  const out = compactHistory([{ type: 'user', text: 'plan it' }, { type: 'model', response: ['p'.repeat(6000)] }], { hard: true });
  assert.ok(out[1].response[0].length < 500);
  const soft = compactHistory([{ type: 'user', text: 'plan it' }, { type: 'model', response: ['p'.repeat(6000)] }]);
  assert.equal(soft[1].response[0].length, 6000);
});

test('model fit labels match what was measured on a 4 GB GPU / 32 GB RAM laptop', async () => {
  const { modelFit } = await import('../src/main/engine.js');
  const GB = 1024 ** 3;
  const hw = { dedicatedVram: 4 * GB, sharedVram: 16 * GB, ram: 32 * GB };
  assert.equal(modelFit(2.33 * GB, hw), 'fast'); // Qwen3 4B Q4: 37/37 layers on GPU, 44 tok/s
  assert.equal(modelFit(4.3 * GB, hw), 'slow'); // tev1:4b Q8: 16/34 layers, 5.5 tok/s
  assert.equal(modelFit(16.8 * GB, hw), 'too-big');
  assert.equal(modelFit(1.5 * GB, { dedicatedVram: 0, sharedVram: 8 * GB, ram: 16 * GB }), 'ok');
  assert.equal(modelFit(2.3 * GB, { dedicatedVram: 0, sharedVram: 0, ram: 8 * GB }), 'slow');
});

test('first start picks the best model that fits this PC, not the first file found', async () => {
  const { pickDefaultChatModel } = await import('../src/main/models.js');
  const { modelFit } = await import('../src/main/engine.js');
  const GB = 1024 ** 3;
  const hw = { dedicatedVram: 4 * GB, sharedVram: 16 * GB, ram: 32 * GB };
  const fit = (b) => modelFit(b, hw);
  const installed = [
    { name: 'gemma4:12b', kind: 'chat', bytes: 6.9 * GB },
    { name: 'pplx-decider:latest', kind: 'chat', bytes: 15.4 * GB },
    { name: 'qwen3.5:4b', kind: 'chat', bytes: 2.5 * GB },
    { name: 'qwen3.8:27b', kind: 'chat', bytes: 15.7 * GB },
    { name: 'tev1:4b', kind: 'chat', bytes: 4.3 * GB },
    { name: 'nomic-embed', kind: 'embedding', bytes: 0.14 * GB },
  ];
  assert.equal(pickDefaultChatModel(installed, fit).name, 'qwen3.5:4b');
  // A recommended catalog model wins among those that fit.
  const withCatalog = [...installed, { name: 'Qwen3-4B-Instruct-2507-Q4_K_M', kind: 'chat', bytes: 2.3 * GB }];
  assert.equal(pickDefaultChatModel(withCatalog, fit).name, 'Qwen3-4B-Instruct-2507-Q4_K_M');
  // Nothing fits the GPU (CPU-only PC): smallest usable model.
  const cpu = (b) => modelFit(b, { dedicatedVram: 0, sharedVram: 0, ram: 16 * GB });
  assert.equal(pickDefaultChatModel(installed, cpu).name, 'qwen3.5:4b');
  assert.equal(pickDefaultChatModel([], fit), null);
});

test('a damaged model file gives a clear, actionable error', async () => {
  const engine = await import('../src/main/engine.js');
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-bad-')), 'broken.gguf');
  fs.writeFileSync(bad, 'GGUF');
  await assert.rejects(engine.loadChatModel(bad, { name: 'Broken model', gpuLayers: 0 }), /Broken model could not be loaded.*download it again/);
});

test('every catalog entry is well formed and fast models carry a tested skill', async () => {
  const { CATALOG } = await import('../src/main/models.js');
  const ids = new Set();
  for (const c of CATALOG) {
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`); ids.add(c.id);
    assert.match(c.uri, /^hf:[^/]+\/[^/]+\/[^/]+\.gguf$/, c.id);
    assert.match(c.size, /^[\d.]+ (GB|MB)$/, c.id);
    if (c.skill) assert.ok(['agent', 'tools', 'chat'].includes(c.skill), c.id);
  }
  assert.equal(CATALOG[0].skill, 'agent'); // the default pick must handle Build mode
  for (const id of ['gemma3-4b', 'qwen3-1.7b', 'llama3.2-1b', 'gemma3-1b', 'qwen2.5-0.5b', 'qwen2.5-coder-1.5b']) assert.ok(ids.has(id), id);
});

test('tool calls written as text are recognised so the task does not stall', async () => {
  const { parseTextToolCalls, lastModelText } = await import('../src/main/engine.js');
  const fns = { update_plan: {}, write_file: {} };
  const text = `I'll plan first.\n<tool_call>\n{\n  "name": "update_plan",\n  "arguments": {\n    "steps": [{ "title": "Write index.html", "status": "pending" }]\n  }\n}\n</tool_call>\n<tool_call>{"name": "rm_rf", "arguments": {}}</tool_call>\n<tool_call>{"name": "write_file", "arguments": "{\\"path\\": \\"a.txt\\"}"}</tool_call>\n<tool_call>{broken</tool_call>`;
  const calls = parseTextToolCalls(text, fns);
  assert.deepEqual(calls.map((c) => c.name), ['update_plan', 'write_file']); // unknown tools and broken JSON are ignored
  assert.equal(calls[0].params.steps[0].title, 'Write index.html');
  assert.equal(calls[1].params.path, 'a.txt');
  assert.equal(lastModelText([{ type: 'user', text: 'x' }, { type: 'model', response: ['a', { type: 'functionCall' }, 'b'] }]), 'ab');
});

test('files outside the workspace need the user to allow their folder', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-outside-'));
  fs.writeFileSync(path.join(outside, 'notes.txt'), 'secret plans');
  const asked = [];
  let answer = null;
  const settings = { ...store.getSettings(), workspace: ws, mode: 'build', autoApprove: true };
  const make = () => buildFunctions({
    settings, agent: agents.getAgent('scorpion'), rag: { hasDocuments: () => false }, emit() {}, requestApproval: async () => true,
    requestFolderAccess: async (req) => { asked.push(req); return answer; },
  });
  // Denied: nothing is read, and the model is told not to retry.
  let fns = make();
  assert.match(await fns.read_file.handler({ path: path.join(outside, 'notes.txt'), startLine: 1 }), /did not allow access/);
  assert.equal(asked[0].folder, fs.realpathSync(outside));
  // Allowed: the read goes through, and later calls in the turn don't ask again.
  answer = { folder: fs.realpathSync(outside) };
  fns = make();
  assert.match(await fns.read_file.handler({ path: path.join(outside, 'notes.txt'), startLine: 1 }), /secret plans/);
  assert.match(await fns.list_files.handler({ path: outside, depth: 1 }), /notes\.txt/);
  assert.equal(asked.length, 2);
  // Paths inside the workspace never ask.
  fs.writeFileSync(path.join(ws, 'inside.txt'), 'hi');
  assert.match(await fns.read_file.handler({ path: 'inside.txt', startLine: 1 }), /hi/);
  assert.equal(asked.length, 2);
});

test('with no workspace, the agent asks the user to choose one', async () => {
  const chosen = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-chosen-'));
  const settings = { ...store.getSettings(), workspace: null, mode: 'build', autoApprove: true };
  const base = { settings, agent: agents.getAgent('scorpion'), rag: { hasDocuments: () => false }, emit() {}, requestApproval: async () => true };
  // Without a way to ask (scheduled runs), file tools stay hidden.
  assert.ok(!('read_file' in buildFunctions(base)));
  const fns = buildFunctions({ ...base, requestFolderAccess: async ({ folder }) => (folder === null ? { workspace: chosen } : null) });
  assert.match(await fns.list_files.handler({ path: '.', depth: 1 }), /empty folder/);
  assert.equal(settings.workspace, chosen);
  assert.match(buildSystemPrompt({ ...settings, workspace: null }, { docNames: [], canAskForFolders: true }), /asks the user to choose a folder/);
});

test('allowed folders cover their subfolders and new files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-allowed-'));
  fs.mkdirSync(path.join(root, 'sub'));
  assert.equal(resolveInsideFn(ws, path.join(root, 'sub', 'new.txt'), [root]), path.join(fs.realpathSync(root), 'sub', 'new.txt'));
  try { resolveInsideFn(ws, path.join(root, 'missing', 'deep', 'x.txt')); assert.fail('should need access'); } catch (err) {
    assert.equal(err.folder, fs.realpathSync(root)); // nearest existing folder
  }
});
