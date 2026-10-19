import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speakable, cleanTranscript, voiceStatus } from '../src/main/voice.js';
import { nextCut } from '../src/renderer/voice.js';

test('replies are read without Markdown or code', () => {
  assert.equal(speakable('## Result\n**Total:** `5,150` — see [the docs](https://x.y).'), 'Result Total: 5,150 — see the docs.');
  assert.equal(speakable('Run this:\n```js\nconsole.log(1)\n```\nDone.'), 'Run this: (code shown on screen) Done.');
  assert.equal(speakable('<think>hmm</think>Hello'), 'Hello');
  assert.equal(speakable('- one\n- two'), 'one two');
});

test('silence and noise transcripts count as nothing', () => {
  assert.equal(cleanTranscript(' [BLANK_AUDIO] '), '');
  assert.equal(cleanTranscript('(music)'), '');
  assert.equal(cleanTranscript(' ... '), '');
  assert.equal(cleanTranscript(' What time is it? '), 'What time is it?');
});

test('streamed replies are spoken in whole sentences', () => {
  const first = 'Hello there, this is the first sentence. And a second';
  assert.equal(first.slice(0, nextCut(first)), 'Hello there, this is the first sentence. ');
  assert.equal(nextCut('1. Item'), -1); // too short to speak alone
  assert.equal(nextCut('Code: ```js\nconst a = 1.5;\n'), -1); // wait for the block to close
  assert.equal(nextCut('Para one\n\nPara two'), 'Para one\n\n'.length);
});

test('voice is reported as not installed before the download', () => {
  const s = voiceStatus();
  assert.equal(s.installed, false);
  assert.ok(s.voices.some((v) => v.id === 'af_heart'));
  assert.ok(s.languages.includes('english'));
});

test('silent recordings are not sent to Whisper', async () => {
  const { loudness, transcribe } = await import('../src/main/voice.js');
  assert.equal(loudness(new Float32Array(16000)), 0);
  assert.ok(loudness(Float32Array.from({ length: 16000 }, (_, i) => Math.sin(i / 5) * 0.1)) > 0.05);
  // Voice must be installed before anything is transcribed.
  await assert.rejects(() => transcribe(new Float32Array(16000)), /not installed/);
});
