// Smarter long-term memory, after OpenClaw's compaction and "dreaming":
//  - Summaries: when a chat's history grows past a share of the context, the
//    older turns are summarized into one entry and the recent turns are kept
//    as they are. The full conversation stays in the chat on disk; only what
//    the model re-reads gets shorter.
//  - Dreaming: once a day, while the computer is idle, Scorpion reads what the
//    user said recently and keeps the lasting facts as memories, with a diary
//    of what it added so the user can review it.
import path from 'node:path';
import { paths, readJson, writeJson, listThreads, getThread } from './store.js';

// ---------- summaries ----------
const SUMMARY_AT = 0.6; // of the context
const KEEP_TURNS = 4; // recent user turns kept word for word
const SUMMARY_MARK = '(Summary of the earlier part of this chat';

export const estimateTokens = (history) => Math.ceil(JSON.stringify(history || []).length / 3.5);

export function needsSummary(history, contextSize) {
  return Boolean(history?.length) && estimateTokens(history) > (contextSize || 8192) * SUMMARY_AT;
}

// Where the kept part starts: at the KEEP_TURNS-th user turn from the end.
// Splitting only at user turns keeps each tool call with its result.
export function summaryCut(history, keep = KEEP_TURNS) {
  const users = history.map((item, i) => (item.type === 'user' ? i : -1)).filter((i) => i > 0);
  if (users.length <= keep) return -1;
  return users[users.length - keep];
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
export function historyToText(items) {
  const lines = [];
  for (const item of items) {
    if (item.type === 'user') lines.push(`User: ${clip(String(item.text), 1500)}`);
    if (item.type !== 'model') continue;
    for (const part of item.response || []) {
      if (typeof part === 'string') { if (part.trim()) lines.push(`Scorpion: ${clip(part.trim(), 1500)}`); continue; }
      if (part?.type === 'functionCall') {
        const result = typeof part.result === 'string' ? part.result : JSON.stringify(part.result ?? '');
        lines.push(`[Scorpion used ${part.name} ${clip(JSON.stringify(part.params ?? {}), 160)} → ${clip(result.replace(/\s+/g, ' '), 200)}]`);
      }
    }
  }
  return lines.join('\n');
}

export const SUMMARY_SYSTEM = 'You summarize conversations between a user and their assistant, Scorpion. Keep every fact, name, number, file path, decision, preference and open task. Drop greetings and repetition. Write compact bullet points in the language of the conversation.';

export function summaryRequest(older) {
  return `Summarize this earlier part of a conversation so it can continue without it. Include: what the user wants, what was decided or done (files created or changed, results), important details (names, numbers, paths), and anything still to do.\n\n${historyToText(older)}`;
}

export function applySummary(history, cut, summary) {
  return [
    history[0],
    { type: 'user', text: `${SUMMARY_MARK}; the full messages are still saved)\n${String(summary).trim()}` },
    { type: 'model', response: ['Understood. I have the summary of our earlier conversation.'] },
    ...history.slice(cut),
  ];
}

// Returns the shorter history, or the same one when no summary is needed.
// `complete` runs one plain model call: ({ systemPrompt, text }) => string.
export async function summarizeIfLong(history, contextSize, complete) {
  if (!needsSummary(history, contextSize)) return history;
  const cut = summaryCut(history);
  if (cut < 2) return history;
  const summary = await complete({ systemPrompt: SUMMARY_SYSTEM, text: summaryRequest(history.slice(1, cut)), maxTokens: 700 });
  if (!String(summary || '').trim()) return history;
  return applySummary(history, cut, summary);
}

// ---------- dreaming ----------
const dreamFile = () => path.join(paths.data, 'dreams.json');
const MAX_FACTS = 5;
const SECRET = /\b(password|passcode|api[ _-]?key|secret|token|pin|credit card|ssn)\b/i;

export const dreamState = () => readJson(dreamFile(), { last: 0, diary: [] });

export function dreamDue(settings, { now = Date.now(), last = 0, idleSeconds = 0, busy = false } = {}) {
  return Boolean(settings.memoryEnabled && settings.dreamingEnabled !== false) && !busy
    && now - last >= 20 * 3600_000 && idleSeconds >= 15 * 60;
}

// What the user said since the last dream (Scorpion's own check-ins and
// scheduled runs are left out).
export function recentUserMessages(since, { skipThreads = [] } = {}) {
  const out = [];
  for (const { id, updatedAt } of listThreads()) {
    if (updatedAt < since || skipThreads.includes(id)) continue;
    const t = getThread(id);
    if (!t || /^Scheduled: /.test(t.title)) continue;
    for (const m of t.messages || []) {
      if (m.role === 'user' && (m.createdAt || 0) >= since && m.text?.trim() && !/^(Scheduled|Check-in)\b/.test(m.text)) out.push(clip(m.text.replace(/\s+/g, ' ').trim(), 300));
    }
  }
  return out.slice(-40);
}

export const DREAM_SYSTEM = 'You keep the long-term memory of an assistant. You only write facts the user clearly stated about themselves, their life, work, people, preferences, routines and decisions.';

export function dreamRequest(memories, messages) {
  return `Memories you already have:\n${memories.length ? memories.map((m) => `- ${m}`).join('\n') : '(none)'}\n\nWhat the user said recently:\n${messages.map((m) => `- ${m}`).join('\n')}\n\nList up to ${MAX_FACTS} NEW lasting facts about the user that these messages clearly state and the memories don't already have. Only things that will still be true next month; no one-off requests or questions. Write each as one full sentence starting with "The user", one per line starting with "- ". If there are none, reply NONE.`;
}

export function parseDreamFacts(text, existing = []) {
  const known = new Set(existing.map((m) => m.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()));
  return String(text || '').split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => /^the user\b/i.test(l) && l.length >= 12 && l.length <= 300 && !SECRET.test(l))
    .filter((l) => !known.has(l.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()))
    .slice(0, MAX_FACTS);
}

// One dream: returns the diary entry. `memory` is the memory module.
export async function dream({ memory, complete, skipThreads = [], now = Date.now() }) {
  const state = dreamState();
  const since = state.last || now - 3 * 86400_000;
  const messages = recentUserMessages(since, { skipThreads });
  const entry = { at: now, read: messages.length, added: [] };
  if (messages.length >= 2) {
    const existing = memory.listMemories().map((m) => m.text);
    const reply = await complete({ systemPrompt: DREAM_SYSTEM, text: dreamRequest(existing.slice(-60), messages), maxTokens: 400 });
    for (const fact of parseDreamFacts(reply, existing)) {
      const { memory: m, duplicate } = memory.addMemory(fact, 'dream');
      if (!duplicate) entry.added.push({ id: m.id, text: m.text });
    }
  }
  writeJson(dreamFile(), { last: now, diary: [entry, ...state.diary].slice(0, 30) });
  return entry;
}
