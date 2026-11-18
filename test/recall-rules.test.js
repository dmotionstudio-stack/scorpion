import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wantsRecall, withConversationRecall } from '../src/main/agent.js';

test('past chats are attached only when they help: never in the middle of a chat unless the person points at the past', () => {
  // in a chat that already has turns, the chat itself is the context
  for (const t of ['continue', 'continue the website', 'yes, add the footer', 'and the colors?', 'make it blue']) assert.equal(wantsRecall(t, true), false, t);
  // unless the person looks back
  for (const t of ['what did we talk about last time?', 'as you said earlier, use red', 'in the other chat you wrote a script', 'continue where we left off']) assert.equal(wantsRecall(t, true), true, t);
  // a new chat: a question may use what was said before, a bare "continue" or "yes" has nothing to match
  assert.equal(wantsRecall('How do I rename photos by date?', false), true);
  for (const t of ['continue', 'Continue.', 'go on', 'yes', 'ok', 'thanks!']) assert.equal(wantsRecall(t, false), false, t);
  assert.equal(wantsRecall('continue where we left off on the budget', false), true);
});

test('the other chats are not looked up at all when the rule says no', () => {
  let asked = 0;
  const memory = { recallBlock: () => { asked++; return 'OLD CHAT TEXT'; } };
  assert.equal(withConversationRecall('continue', memory, 't1', { hasHistory: true }), 'continue');
  assert.equal(asked, 0);
  assert.match(withConversationRecall('what did we say last time?', memory, 't1', { hasHistory: true }), /OLD CHAT TEXT/);
  assert.equal(asked, 1);
});
