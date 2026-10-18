// Cross-chat memory check with a real local model:
//   node scripts/e2e-memory.mjs <chat.gguf>
// Chat A shares facts → chat B (fresh history) must know them; then forget one;
// then chat C must recall a detail that only exists in chat A's transcript.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../src/main/store.js';
import * as engine from '../src/main/engine.js';
import * as memory from '../src/main/memory.js';
import { buildFunctions, buildSystemPrompt, withConversationRecall } from '../src/main/agent.js';

const [chatModel] = process.argv.slice(2);
store.initStore(fs.mkdtempSync(path.join(os.tmpdir(), 'kenzo-mem-e2e-')));
const settings = store.updateSettings({ chatModel, memoryEnabled: true, recallEnabled: true });
await engine.loadChatModel(chatModel, { contextSize: 8192 });

const noRag = { hasDocuments: () => false };
const tools = [];

// Mirrors main.js chatSend: persist the transcript so recall can index it.
async function say(thread, text) {
  console.log(`\n[${thread.title}] USER: ${text}\nKENZO: `);
  let streamed = '';
  const blocks = [];
  thread.history = await engine.runTurn({
    threadId: thread.id,
    history: thread.history,
    systemPrompt: buildSystemPrompt(settings, { docNames: [], memoryBlock: memory.memoryPromptBlock() }),
    text: withConversationRecall(text, memory, thread.id),
    temperature: 0.2,
    functions: buildFunctions({
      settings, rag: noRag, memory, threadId: thread.id, streamedText: () => streamed,
      emit: (e) => { if (e.type === 'tool') { tools.push(e.name); console.log(`  [tool ${e.name}: ${e.summary}]`); } },
      requestApproval: async () => true,
    }),
    onText: (d) => { streamed += d; process.stdout.write(d); },
  });
  blocks.push({ type: 'text', text: streamed });
  thread.messages.push({ role: 'user', text }, { role: 'assistant', blocks });
  store.saveThread(thread);
  memory.invalidateRecall();
  return streamed;
}

const a = Object.assign(store.createThread(), { title: 'Intro' });
await say(a, "Hi! I'm Sam. I work as a nurse on night shifts, and I'm learning Spanish.");
await say(a, 'Suggest three names for my new orange kitten.');
const kittenNames = (a.messages.at(-1).blocks[0].text.match(/\*\*([A-Z][a-z]+)\*\*|^\s*\d+\.\s+\**([A-Z][a-z]+)/gm) || [])
  .map((s) => s.replace(/[^A-Za-z]/g, '').replace(/^\d+/, ''));
console.log(`\n\nmemories after chat A: ${JSON.stringify(memory.listMemories().map((m) => m.text))}`);

const b = Object.assign(store.createThread(), { title: 'Fresh chat' });
const who = await say(b, "What's my name, and what language am I learning?");
console.log(`
memories now: ${JSON.stringify(memory.listMemories().map((m) => m.text))}`);
const knowsName = /sam/i.test(who);
const knowsLang = /spanish/i.test(who);

await say(b, "Please forget that I'm learning Spanish, I stopped.");
const forgot = !memory.listMemories().some((m) => /spanish/i.test(m.text));
const keptOthers = memory.listMemories().some((m) => /nurse/i.test(m.text));
console.log(`memories after forget: ${JSON.stringify(memory.listMemories().map((m) => m.text))}`);

const c = Object.assign(store.createThread(), { title: 'Later' });
const recall = await say(c, 'Which names did you suggest for my orange kitten earlier?');
const recalled = kittenNames.some((n) => n.length > 2 && recall.includes(n));

console.log(`\n\nkitten names from chat A: ${kittenNames.join(', ')}`);
console.log(`RESULT remember_called=${tools.includes('remember')} knows_name=${knowsName} knows_language=${knowsLang} forgot=${forgot} kept_other_facts=${keptOthers} recalled_other_chat=${recalled}`);
process.exit(tools.includes('remember') && knowsName && knowsLang && forgot && keptOthers && recalled ? 0 : 1);
