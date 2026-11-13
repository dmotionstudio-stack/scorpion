import test from 'node:test';
import assert from 'node:assert/strict';
import { instantCommand } from '../src/renderer/orb-commands.js';

const at = new Date(2026, 10, 13, 15, 42); // Friday 13 November 2026, 3:42 PM

test('the time and the date are answered at once', () => {
  assert.equal(instantCommand('What time is it?', { now: at }).say, "It's 3:42 PM.");
  assert.equal(instantCommand("what's the time", { now: at }).say, "It's 3:42 PM.");
  assert.equal(instantCommand('Hey Scorpion, what time is it please', { now: at }).say, "It's 3:42 PM.");
  assert.equal(instantCommand("What's the date today?", { now: at }).say, 'Today is Friday, November 13.');
  assert.equal(instantCommand('what day is it', { now: at }).say, 'Today is Friday, November 13.');
});

test('the volume is changed at once', () => {
  assert.equal(instantCommand('Turn the volume up', { now: at }).volume, 'up');
  assert.equal(instantCommand('louder please', { now: at }).volume, 'up');
  assert.equal(instantCommand('volume down', { now: at }).volume, 'down');
  assert.equal(instantCommand('quieter', { now: at }).volume, 'down');
  assert.equal(instantCommand('mute', { now: at }).volume, 'mute');
  assert.equal(instantCommand('unmute the sound', { now: at }).say, 'Sound on.');
});

test('anything else goes to the model, and other languages are never guessed at', () => {
  assert.equal(instantCommand('What time does the train to Boston leave?', { now: at }), null);
  assert.equal(instantCommand('Tell me a story about the volume of a sphere', { now: at }), null);
  assert.equal(instantCommand('', { now: at }), null);
  assert.equal(instantCommand('what time is it', { now: at, lang: 'fr' }), null);
});

test('a transcript started at a pause is reused only when nothing but quiet came after it', async () => {
  const { canReuse } = await import('../src/renderer/voice.js');
  assert.equal(canReuse(32000, 32000 + 16000 * 0.5), true, 'half a second of quiet more: same speech');
  assert.equal(canReuse(32000, 32000 + 16000 * 2), false, 'two more seconds: you carried on talking');
  assert.equal(canReuse(0, 32000), false, 'no snapshot');
  assert.equal(canReuse(32000, 16000), false, 'shorter than the snapshot is not the same audio');
});

test('open an app, take a screenshot, change the theme, read the battery: at once', async () => {
  const { parseAction, bestApp } = await import('../src/renderer/orb-commands.js');
  assert.deepEqual(parseAction('Open Safari'), { open: 'safari' });
  assert.deepEqual(parseAction('hey scorpion, launch the calculator app please'), { open: 'calculator' });
  assert.equal(parseAction('open the pod bay doors and the airlock and the big window'), null, 'a long sentence is for the model');
  assert.equal(parseAction('take a screenshot').intent, 'screenshot');
  assert.equal(parseAction('turn on dark mode').intent, 'dark-mode');
  assert.equal(parseAction('switch to light theme').intent, 'light-mode');
  assert.deepEqual(parseAction("what's my battery level"), { battery: true });
  assert.equal(parseAction('open Safari', { lang: 'fr' }), null);
  assert.equal(parseAction('what is the capital of France'), null);
  const apps = [{ name: 'Calculator', id: 'c' }, { name: 'Google Chrome', id: 'g' }, { name: 'Chromium', id: 'x' }, { name: 'Microsoft Word', id: 'w' }, { name: 'WordPad', id: 'p' }];
  assert.equal(bestApp('calculator', apps).id, 'c');
  assert.equal(bestApp('chrome', apps).id, 'g', 'a word of the name');
  assert.equal(bestApp('word', apps).id, 'p', 'starts with it');
  assert.equal(bestApp('zzzz', apps), null);
  assert.equal(bestApp('a', apps), null, 'too short to guess');
});
