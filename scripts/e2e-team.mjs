// Multi-agent check with a real local model:
//   node scripts/e2e-team.mjs <chat.gguf>
// 1. Data Analyst reads a CSV and computes exact totals.
// 2. Kenzo writes code, then delegates a review to the Reviewer agent.
// 3. A scheduled, read-only folder agent reports on files and can't change them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../src/main/store.js';
import * as engine from '../src/main/engine.js';
import * as agents from '../src/main/agents.js';
import * as scheduler from '../src/main/scheduler.js';
import { buildFunctions, buildSystemPrompt } from '../src/main/agent.js';

const [chatModel] = process.argv.slice(2);
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kenzo-team-'));
const ws = path.join(data, 'ws');
fs.mkdirSync(ws);
store.initStore(data);
const settings = store.updateSettings({ chatModel, workspace: ws, memoryEnabled: false });
const info = await engine.loadChatModel(chatModel, { contextSize: 8192 });
console.log(`gpu=${info.gpu} context=${info.contextSize} parallelHelpers=${info.parallelHelpers}`);

const noRag = { hasDocuments: () => false };
async function turn(label, agentId, text, { workspace = ws, approve = async () => true } = {}) {
  console.log(`\n=== ${label} (${agentId}) ===\nUSER: ${text}`);
  const agent = agents.getAgent(agentId);
  const s = { ...settings, workspace };
  const events = [];
  let streamed = '';
  const t0 = Date.now();
  await engine.runTurn({
    threadId: `${label}-${Date.now()}`,
    history: null,
    systemPrompt: buildSystemPrompt(s, { docNames: [], agent }),
    text,
    temperature: agent.temperature ?? 0.3,
    functions: buildFunctions({
      settings: s, agent, rag: noRag, memory: null, threadId: label, streamedText: () => streamed,
      runHelper: engine.runHelperTurn, requestApproval: approve,
      emit: (e) => {
        events.push(e);
        if (e.type === 'tool') console.log(`  ${e.parent ? '    ↳ ' : ''}[tool ${e.name}: ${String(e.summary).slice(0, 100)}]`);
        if (e.type === 'tool-result' && !e.ok) console.log(`  ${e.parent ? '    ↳ ' : ''}[failed: ${e.output.slice(0, 120)}]`);
      },
    }),
    onText: (d) => { streamed += d; },
  });
  console.log(`KENZO (${((Date.now() - t0) / 1000).toFixed(0)}s): ${streamed.trim().slice(0, 700)}`);
  return { text: streamed, events };
}

// 1. Data analyst
fs.writeFileSync(path.join(ws, 'sales.csv'), 'region,month,amount\nNorth,Jan,1200\nNorth,Feb,1350\nSouth,Jan,980\nSouth,Feb,1105\nEast,Jan,1500\nEast,Feb,1420\n');
const a = await turn('analyst', 'analyst', 'Using sales.csv, what is the total amount for each region and the grand total?');
const usedSheet = a.events.some((e) => e.type === 'tool' && e.name === 'read_spreadsheet');
const analystOk = /7,?555/.test(a.text) && /2,?550/.test(a.text) && /2,?085/.test(a.text) && /2,?920/.test(a.text);

// 2. Delegation
const b = await turn('delegate', 'kenzo', 'Write a JavaScript function isPrime(n) and save it to prime.js. Then ask the Reviewer agent to review prime.js for bugs, and tell me what it said.');
const delegated = b.events.some((e) => e.type === 'tool' && e.name === 'ask_agent');
const helperWorked = b.events.some((e) => e.parent && (e.type === 'tool' || e.type === 'helper-text'));
const reviewResult = b.events.find((e) => e.type === 'tool-result' && !e.parent && b.events.some((t) => t.type === 'tool' && t.id === e.id && t.name === 'ask_agent'));
console.log(`\nReviewer said: ${reviewResult?.output?.slice(0, 400)}`);

// 3. Scheduled folder agent (read-only): runs via the real scheduler.
const inbox = path.join(data, 'inbox');
fs.mkdirSync(inbox);
fs.writeFileSync(path.join(inbox, 'meeting.txt'), 'Team meeting moved to Thursday 3pm. Bring the Q3 budget draft.');
let denied = 0;
const sched = scheduler.saveSchedule({ name: 'Inbox digest', agentId: 'researcher', prompt: 'List the files in this folder and summarize each in one line. Then save the summary to digest.md.', trigger: { type: 'folder', folder: inbox }, allowChanges: false });
let scheduledText = '';
scheduler.startScheduler(async (s, reason) => {
  const r = await turn('scheduled', s.agentId, `[Scheduled task "${s.name}" · trigger: ${reason}]\n${s.prompt}\n\nThis runs unattended: do the task, then reply with a short report. You may not change files or run commands in this run.`,
    { workspace: s.trigger.folder, approve: async () => { denied++; return s.allowChanges; } });
  scheduledText = r.text;
  return { threadId: 'x', text: r.text };
});
await scheduler.runNow(sched.id, 'Run manually');
scheduler.stopScheduler();
const scheduledOk = /thursday/i.test(scheduledText);
const stayedReadOnly = !fs.existsSync(path.join(inbox, 'digest.md'));
const status = scheduler.listSchedules()[0].lastStatus;

console.log(`\nRESULT analyst_used_spreadsheet=${usedSheet} analyst_numbers_correct=${analystOk} delegated=${delegated} helper_worked=${helperWorked} scheduled_summary=${scheduledOk} scheduled_read_only=${stayedReadOnly} schedule_status=${status}`);
process.exit(usedSheet && analystOk && delegated && helperWorked && scheduledOk && stayedReadOnly && status === 'ok' ? 0 : 1);
