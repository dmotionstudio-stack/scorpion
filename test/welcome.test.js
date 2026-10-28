import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spokenChoice, HAND_LESSONS } from '../src/renderer/welcome.js';

test('the welcome understands spoken answers', () => {
  assert.equal(spokenChoice('Yes please'), 'yes');
  assert.equal(spokenChoice('yeah, sure!'), 'yes');
  assert.equal(spokenChoice('No.'), 'no');
  assert.equal(spokenChoice("don't"), 'no');
  assert.equal(spokenChoice('text only'), 'no');
  assert.equal(spokenChoice('skip it'), 'skip');
  assert.equal(spokenChoice('maybe later'), 'skip');
  assert.equal(spokenChoice('next'), 'next');
  assert.equal(spokenChoice('I am ready'), 'next');
  assert.equal(spokenChoice('the weather is nice'), null);
  assert.equal(spokenChoice(''), null);
});

test('each hand lesson is completed by its gesture', () => {
  const lesson = Object.fromEntries(HAND_LESSONS.map((l) => [l.id, l.done]));
  assert.equal(lesson.show({ hands: 1 }), true);
  assert.equal(lesson.show({ hands: 0 }), false);
  assert.equal(lesson.point({ hands: 1, pose: 'point' }), true);
  assert.equal(lesson.point({ hands: 1, pose: 'open' }), false);
  assert.equal(lesson.pinch({ tap: { x: 0.5, y: 0.5 } }), true);
  assert.equal(lesson.pinch({}), false);
  assert.equal(lesson.scroll({ scroll: -1 }), true);
  assert.equal(lesson.scroll({ pose: 'two' }), true);
});

test('the accessibility step understands its three switches', () => {
  assert.equal(spokenChoice('Bigger text please'), 'bigText');
  assert.equal(spokenChoice('make it bigger'), 'bigText');
  assert.equal(spokenChoice('the screen reader'), 'screenReader');
  assert.equal(spokenChoice('read the screen'), 'screenReader');
  assert.equal(spokenChoice('a keyboard on the screen'), 'keyboard');
  assert.equal(spokenChoice('next'), 'next');
});
