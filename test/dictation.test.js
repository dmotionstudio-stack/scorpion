import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dictationSteps, createDictation } from '../src/main/dictation.js';

test('a sentence is typed as said, with a space after the one before', () => {
  assert.deepEqual(dictationSteps('Hello there.'), { text: 'Hello there.', stop: false, undo: false });
  assert.equal(dictationSteps('How are you?', { after: 'Hello there.' }).text, ' How are you?');
  assert.equal(dictationSteps('Next line.', { after: 'Done.\n' }).text, 'Next line.');
  assert.equal(dictationSteps(', and more', { after: 'One' }).text, ', and more');
});

test('"new line" and "new paragraph" become line breaks', () => {
  assert.equal(dictationSteps('Dear Sam, new line. Thanks for the notes.').text, 'Dear Sam\nThanks for the notes.');
  assert.equal(dictationSteps('First part. New paragraph. Second part.').text, 'First part.\n\nSecond part.');
  assert.equal(dictationSteps('New line.', { after: 'Hi.' }).text, '\n');
});

test('"stop typing" finishes, keeping what came before it', () => {
  assert.deepEqual(dictationSteps('Stop typing.'), { text: '', stop: true, undo: false });
  assert.deepEqual(dictationSteps('See you tomorrow. Stop typing!'), { text: 'See you tomorrow.', stop: true, undo: false });
  assert.equal(dictationSteps('End dictation').stop, true);
  assert.equal(dictationSteps('Please stop typing errors in the report.').stop, false); // only at the end
});

test('"delete that" takes back the last sentence typed', async () => {
  const calls = [];
  const d = createDictation({ BrowserWindow: null, screen: null, call: async (...a) => calls.push(a), url: '', theme: () => 'classic' });
  await d.heard('Hello there.');
  await d.heard('Wrong words.');
  assert.deepEqual(await d.heard('Delete that.'), { stop: false });
  assert.deepEqual(calls.map((c) => c[0]), ['type', 'type', 'erase']);
  assert.equal(Buffer.from(calls[0][1], 'base64').toString('utf8'), 'Hello there.');
  assert.equal(Buffer.from(calls[1][1], 'base64').toString('utf8'), ' Wrong words.');
  assert.equal(calls[2][1], ' Wrong words.'.length);
  assert.deepEqual(await d.heard('Bonjour à tous 👋. Stop typing.'), { stop: true });
  assert.equal(Buffer.from(calls[3][1], 'base64').toString('utf8'), ' Bonjour à tous 👋.');
});
