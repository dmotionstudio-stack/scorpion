import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floatBounds, ORB, BUBBLE } from '../src/main/float-orb.js';
import { callGreeting } from '../src/renderer/orb-commands.js';

const work = { x: 0, y: 0, width: 1920, height: 1040 };

test('the floating orb is small and stays inside the screen', () => {
  assert.ok(ORB <= 80);
  const b = floatBounds({ x: 5000, y: -50 }, work, false);
  assert.deepEqual([b.width, b.height], [ORB, ORB]);
  assert.equal(b.x, work.width - ORB);
  assert.equal(b.y, 0);
});

test('with words showing the window grows toward the middle and the orb stays put', () => {
  const left = floatBounds({ x: 100, y: 300 }, work, true);
  assert.equal(left.side, 'left');
  assert.equal(left.x, 100); // the orb is on the left of the window
  assert.equal(left.width, ORB + BUBBLE);
  assert.equal(left.orbX, 100);
  const right = floatBounds({ x: 1800, y: 300 }, work, true);
  assert.equal(right.side, 'right');
  assert.equal(right.x + right.width - ORB, 1800); // the orb is on the right of the window
  assert.equal(right.orbX, 1800);
  assert.equal(right.y, 300);
  // the small and the grown window put the orb in the same place
  const small = floatBounds({ x: 1800, y: 300 }, work, false);
  assert.equal(small.x, right.orbX);
});

test('it works on a screen that does not start at 0,0', () => {
  const second = { x: -1920, y: 100, width: 1920, height: 1000 };
  const b = floatBounds({ x: -2500, y: 5000 }, second, true);
  assert.ok(b.x >= second.x && b.x + b.width <= second.x + second.width);
  assert.equal(b.y, second.y + second.height - ORB);
});

test('called by name, Scorpion greets: by the time of day in English, shortly in other languages', () => {
  const first = () => 0;
  assert.equal(callGreeting({ hour: 8, lang: 'en', pick: first }), 'Good morning. How can I help?');
  assert.equal(callGreeting({ hour: 14, lang: 'en-US', pick: first }), 'Good afternoon. How can I help?');
  assert.equal(callGreeting({ hour: 21, lang: 'en', pick: first }), 'Good evening. How can I help?');
  assert.equal(callGreeting({ hour: 2, lang: 'en', pick: first }), 'Good evening. How can I help?');
  assert.match(callGreeting({ lang: 'fr', pick: first }), /écoute/);
  assert.equal(callGreeting({ lang: 'sw', pick: first }), 'Yes?'); // no line for it: a plain "Yes?"
  for (let i = 0; i < 20; i++) assert.ok(callGreeting({ lang: 'en' }).length > 2); // any pick works, never empty
  assert.ok(callGreeting({ lang: 'en', pick: () => 0.9999 }).length > 2);
});
