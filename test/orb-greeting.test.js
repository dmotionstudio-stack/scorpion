import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callGreeting } from '../src/renderer/orb-commands.js';

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
