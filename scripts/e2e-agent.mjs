// End-to-end check with a real local model, outside Electron:
//   node scripts/e2e-agent.mjs <chat.gguf> [embed.gguf]
// Verifies: model loads, the agent plans + writes a file through tools,
// a write is gated by approval, and document search returns the right passage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../src/main/store.js';
import * as engine from '../src/main/engine.js';
import * as rag from '../src/main/rag.js';
import { buildFunctions, buildSystemPrompt, withDocumentContext } from '../src/main/agent.js';

const [chatModel, embedModel] = process.argv.slice(2);
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-e2e-'));
const workspace = path.join(data, 'ws');
fs.mkdirSync(workspace);
store.initStore(data);
const settings = store.updateSettings({ chatModel, embedModel, workspace, autoApprove: false });

const t0 = Date.now();
const info = await engine.loadChatModel(chatModel, { contextSize: 8192 });
console.log(`loaded in ${Date.now() - t0} ms, gpu=${info.gpu}`);

const events = [];
let approvals = 0;
const searcher = rag.createSearcher(settings);
let streamed = '';
const turn = async (text, history) => { streamed = ''; return engine.runTurn({
  threadId: 't1',
  history,
  systemPrompt: buildSystemPrompt(settings, { docNames: rag.listDocuments().map((d) => d.name) }),
  text: await withDocumentContext(text, searcher),
  temperature: 0.2,
  functions: buildFunctions({
    settings, rag: searcher, signal: undefined, streamedText: () => streamed,
    emit: (e) => { events.push(e); if (e.type === 'tool') console.log(`  tool ${e.name}: ${e.summary}`); },
    requestApproval: async () => { approvals++; return true; },
  }),
  onText: (d) => { streamed += d; process.stdout.write(d); },
}); };

console.log('\n--- agent task ---');
let history = await turn('Create a file named hello.py in the workspace that prints "Hello from Scorpion", then run it with python or tell me it is created.', null);
const file = path.join(workspace, 'hello.py');
console.log(`\nhello.py exists: ${fs.existsSync(file)}; approvals requested: ${approvals}`);
if (fs.existsSync(file)) console.log(fs.readFileSync(file, 'utf8'));

let ragOk = null;
if (embedModel) {
  console.log('\n--- documents ---');
  const doc = path.join(data, 'handbook.md');
  fs.writeFileSync(doc, '# Office handbook\n\nThe office wifi password is purple-otter-42.\n\nLunch is served at 12:30 every weekday in the atrium.\n\nParking spots are on level B2.');
  await rag.addDocument(doc, settings);
  const hits = await searcher.search('when is lunch served?', 1);
  ragOk = hits[0]?.text.includes('12:30');
  console.log(`top hit has lunch time: ${ragOk}`);
  history = await turn('Using my documents, what time is lunch?', history);
  ragOk = ragOk && streamed.includes('12:30');
  console.log(`
answer mentions 12:30: ${streamed.includes('12:30')}`);
}

const wrote = events.some((e) => e.type === 'tool' && e.name === 'write_file');
console.log(`\n\nRESULT write_file_called=${wrote} file_created=${fs.existsSync(file)} gated=${approvals > 0} rag=${ragOk}`);
process.exit(wrote && fs.existsSync(file) && approvals > 0 && ragOk !== false ? 0 : 1);
