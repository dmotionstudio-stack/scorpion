import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../src/main/store.js';
import * as memory from '../src/main/memory.js';
import { TOOLS } from '../src/main/tools.js';

store.initStore(fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-mem-')));

test('add, dedupe, update, forget and delete memories', () => {
  const a = memory.addMemory('The user prefers TypeScript over JavaScript.');
  assert.equal(a.duplicate, false);
  assert.equal(memory.addMemory('the user prefers typescript over javascript').duplicate, true);
  memory.addMemory('The user is planning a trip to Lisbon in May.');
  assert.equal(memory.listMemories().length, 2);
  memory.updateMemory(a.memory.id, 'The user prefers Rust.');
  assert.match(memory.memoryPromptBlock(), /- The user prefers Rust\./);
  assert.match(memory.forgetMemory('trip to Lisbon').text, /Lisbon/);
  assert.equal(memory.forgetMemory('something unrelated entirely'), null);
  memory.deleteMemory(a.memory.id);
  assert.equal(memory.listMemories().length, 0);
  assert.equal(memory.memoryPromptBlock(), '');
});

test('remember tool refuses secrets', () => {
  const ctx = { memory };
  assert.match(TOOLS.remember.run({ facts: ['My wifi password is hunter2'] }, ctx), /Not saved/);
  assert.match(TOOLS.remember.run({ facts: ['The user has a dog named Biscuit.', 'The user lives in Oslo.'] }, ctx), /Remembered/);
  assert.match(TOOLS.forget.run({ memory: 'dog named Biscuit' }, ctx), /Forgot/);
});

test('conversation recall finds other chats and skips the current one', () => {
  const t1 = store.createThread();
  t1.title = 'Pizza night';
  t1.messages.push(
    { role: 'user', text: 'Give me a sourdough pizza dough recipe with basil' },
    { role: 'assistant', blocks: [{ type: 'text', text: 'Sourdough pizza dough: 500g flour, 350g water, 100g starter, 10g salt. Top with fresh basil.' }] },
  );
  store.saveThread(t1);
  const t2 = store.createThread();
  t2.messages.push({ role: 'user', text: 'Tell me about quantum computers' });
  store.saveThread(t2);
  memory.invalidateRecall();

  const hits = memory.searchConversations('what was that sourdough pizza recipe?');
  assert.equal(hits[0].threadId, t1.id);
  assert.equal(memory.searchConversations('sourdough pizza', { excludeThreadId: t1.id }).length, 0);
  assert.match(memory.recallBlock('what was that sourdough pizza dough recipe?', t2.id), /Pizza night/);
  assert.equal(memory.recallBlock('how do quantum computers work', t2.id), '');
  assert.match(TOOLS.search_past_chats.run({ query: 'pizza dough' }, { memory, threadId: t2.id }), /Pizza night/);
});

test('data from the old Kenzo folder moves to Scorpion once, with model paths updated', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-migrate-'));
  const oldDir = path.join(base, 'Kenzo');
  const newDir = path.join(base, 'Scorpion');
  fs.mkdirSync(path.join(oldDir, 'models'), { recursive: true });
  fs.mkdirSync(path.join(oldDir, 'threads'));
  fs.writeFileSync(path.join(oldDir, 'models', 'm.gguf'), 'x');
  fs.writeFileSync(path.join(oldDir, 'threads', 't.json'), '{}');
  const ollama = path.join(base, 'ollama', 'blob');
  fs.writeFileSync(path.join(oldDir, 'settings.json'), JSON.stringify({ chatModel: path.join(oldDir, 'models', 'm.gguf'), embedModel: ollama }));
  assert.equal(store.migrateFromKenzo(newDir, oldDir), true);
  const s = JSON.parse(fs.readFileSync(path.join(newDir, 'settings.json'), 'utf8'));
  assert.equal(s.chatModel, path.join(newDir, 'models', 'm.gguf'));
  assert.equal(s.embedModel, ollama); // paths outside the old folder are untouched
  assert.ok(fs.existsSync(path.join(newDir, 'threads', 't.json')));
  assert.equal(store.migrateFromKenzo(newDir, oldDir), false); // only once
});
