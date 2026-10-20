// Long-term memory, in two layers (the same split Jan uses):
//  1. Saved memories — short facts the user or agent chose to keep ("Prefers
//     Python", "Project X ships in May"). All of them go in the system prompt.
//  2. Conversation recall — every past chat is keyword-indexed (BM25) so
//     relevant snippets from *other* chats can be brought back automatically.
// Both are plain local files; nothing leaves the computer.
import path from 'node:path';
import { paths, writeJson, readJson, newId, listThreads, getThread } from './store.js';

const MAX_MEMORIES = 200;
const MAX_IN_PROMPT = 60;
const memoryFile = () => path.join(paths.data, 'memory.json');

// ---------- saved memories ----------

export function listMemories() {
  return readJson(memoryFile(), []);
}

function saveMemories(list) {
  writeJson(memoryFile(), list);
}

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function addMemory(text, source = 'user') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!clean) throw new Error('Memory text is empty');
  const list = listMemories();
  const existing = list.find((m) => norm(m.text) === norm(clean));
  if (existing) return { memory: existing, duplicate: true };
  const memory = { id: newId(), text: clean, source, createdAt: Date.now() };
  list.push(memory);
  saveMemories(list.slice(-MAX_MEMORIES));
  return { memory, duplicate: false };
}

export function updateMemory(id, text) {
  const list = listMemories();
  const m = list.find((x) => x.id === id);
  if (!m) throw new Error('Memory not found');
  m.text = String(text).replace(/\s+/g, ' ').trim().slice(0, 500);
  saveMemories(list);
  return m;
}

export function deleteMemory(id) {
  saveMemories(listMemories().filter((m) => m.id !== id));
}

export function clearMemories() {
  saveMemories([]);
}

// Forget by id, or by the best word-overlap match for a description.
export function forgetMemory(query) {
  const list = listMemories();
  let target = list.find((m) => m.id === query);
  if (!target) {
    const q = new Set(tokenize(query));
    let best = 0;
    for (const m of list) {
      const words = tokenize(m.text);
      const overlap = words.filter((w) => q.has(w)).length / Math.max(q.size, 1);
      if (overlap > best) { best = overlap; target = m; }
    }
    if (best < 0.5) target = null;
  }
  if (!target) return null;
  deleteMemory(target.id);
  return target;
}

export function memoryPromptBlock() {
  const list = listMemories().slice(-MAX_IN_PROMPT);
  if (!list.length) return '';
  return `What you remember about the user from earlier conversations (use when relevant; don't recite it unprompted):\n${list.map((m) => `- ${m.text}`).join('\n')}`;
}

// ---------- conversation recall (BM25 over past chats) ----------

const STOP = new Set('a an and are as at be but by can do for from has have how i if in is it its me my no not of on or so that the their them then there these they this to was we what when where which who why will with you your yes ok okay please thanks thank'.split(' '));

export function tokenize(text) {
  return norm(text).split(' ').filter((w) => w.length > 1 && !STOP.has(w));
}

let index = null; // { docs: [{ threadId, title, role, text, tokens, tf }], df: Map, avgLen }

export function invalidateRecall() {
  index = null;
}

function messageText(m) {
  if (m.role === 'user') return m.text || '';
  return (m.blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

function buildIndex() {
  const docs = [];
  for (const { id } of listThreads()) {
    const t = getThread(id);
    if (!t) continue;
    const msgs = t.messages || [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const text = messageText(m).trim();
      if (!text) continue;
      const tokens = tokenize(text);
      if (!tokens.length) continue;
      const tf = new Map();
      for (const w of tokens) tf.set(w, (tf.get(w) || 0) + 1);
      // Keep the reply to each question: "what did you suggest earlier?" matches
      // the question's words, but the answer is what the user actually wants.
      const reply = m.role === 'user' && msgs[i + 1]?.role === 'assistant' ? messageText(msgs[i + 1]).trim() : '';
      docs.push({ threadId: t.id, title: t.title, role: m.role, text, reply, len: tokens.length, tf, at: m.createdAt || t.updatedAt });
    }
  }
  const df = new Map();
  for (const d of docs) for (const w of d.tf.keys()) df.set(w, (df.get(w) || 0) + 1);
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / Math.max(docs.length, 1);
  index = { docs, df, avgLen };
}

/** Top-k past messages for a query, excluding the current thread. */
export function searchConversations(query, { k = 5, excludeThreadId = null } = {}) {
  if (!index) buildIndex();
  const terms = [...new Set(tokenize(query))];
  if (!terms.length || !index.docs.length) return [];
  const N = index.docs.length;
  const k1 = 1.2, b = 0.75;
  const scored = [];
  for (const d of index.docs) {
    if (d.threadId === excludeThreadId) continue;
    let score = 0;
    let matched = 0;
    for (const w of terms) {
      const f = d.tf.get(w);
      if (!f) continue;
      matched++;
      const idf = Math.log(1 + (N - index.df.get(w) + 0.5) / (index.df.get(w) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / index.avgLen)));
    }
    if (matched) scored.push({ ...d, score, matched, coverage: matched / terms.length });
  }
  return scored
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
    .map(({ threadId, title, role, text, reply, score, matched, coverage, at }) => ({ threadId, title, role, text: text.slice(0, 700), reply: (reply || '').slice(0, 900), score, matched, coverage, at }));
}

// Recall is only attached when most of the query's meaningful words match
// (raw BM25 scores shift with corpus size, so they make a poor threshold),
// which keeps unrelated chats from leaking noise into every answer.
const MIN_RECALL_COVERAGE = 0.6;

export function recallBlock(query, threadId) {
  const needed = Math.min(2, tokenize(query).length);
  const hits = searchConversations(query, { k: 3, excludeThreadId: threadId })
    .filter((h) => h.coverage >= MIN_RECALL_COVERAGE && h.matched >= needed);
  if (!hits.length) return '';
  return `From my earlier conversations with you (may be relevant):\n\n${hits
    .map((h) => `[chat "${h.title}" · ${h.role === 'user' ? 'you said' : 'I said'}]\n${h.text}${h.reply ? `\n[I replied]\n${h.reply}` : ''}`)
    .join('\n\n')}`;
}

// ---------- standing intents ----------
// "When X comes up, do Y": prospective memory, after OpenClaw's standing
// intents. Checked against each message the user sends; a match adds a note
// to that message so the agent acts on it in its reply.
const intentsFile = () => path.join(paths.data, 'intents.json');
const MAX_INTENTS = 50;

export function listIntents() {
  return readJson(intentsFile(), []);
}

export function addIntent({ when, then, once = false }) {
  const trigger = String(when || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const action = String(then || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!tokenize(trigger).length) throw new Error('Say what should trigger it (the words to watch for)');
  if (!action) throw new Error('Say what to do when it comes up');
  const list = listIntents();
  const existing = list.find((i) => norm(i.trigger) === norm(trigger) && norm(i.action) === norm(action));
  if (existing) return existing;
  const intent = { id: newId(), trigger, action, once: Boolean(once), createdAt: Date.now(), fired: 0 };
  writeJson(intentsFile(), [...list, intent].slice(-MAX_INTENTS));
  return intent;
}

export function cancelIntent(query) {
  const list = listIntents();
  const q = norm(query);
  const target = list.find((i) => i.id === query) || list.find((i) => norm(i.trigger) === q) || list.find((i) => q && norm(i.trigger).includes(q));
  if (!target) return null;
  writeJson(intentsFile(), list.filter((i) => i !== target));
  return target;
}

// A trigger matches when its phrase appears, or when every meaningful word of
// it does (in any order, any form of the word sharing its first 5 letters).
export function intentMatches(trigger, text) {
  const t = ` ${norm(text)} `;
  if (t.includes(` ${norm(trigger)} `)) return true;
  const words = tokenize(trigger);
  const have = tokenize(text);
  return words.length > 0 && words.every((w) => have.some((h) => h === w || (w.length >= 5 && h.length >= 5 && h.slice(0, 5) === w.slice(0, 5))));
}

// Matching intents for a message; one-time intents are used up.
export function fireIntents(text) {
  const list = listIntents();
  const hits = list.filter((i) => intentMatches(i.trigger, text));
  if (!hits.length) return [];
  for (const i of hits) { i.fired++; i.lastFired = Date.now(); }
  writeJson(intentsFile(), list.filter((i) => !(i.once && hits.includes(i))));
  return hits;
}

export function intentsNote(hits) {
  if (!hits.length) return '';
  return `(Scorpion note: the user asked you earlier to act when this comes up. ${hits.map((i) => `When "${i.trigger}" comes up: ${i.action}`).join(' ')} Do it in your reply.)`;
}
