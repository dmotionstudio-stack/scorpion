import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GENERAL_SECTIONS, SETTINGS_GROUPS } from '../src/renderer/settings-nav.js';

const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
// The General page: from its section to the next one.
const start = html.indexOf('id="view-settings"');
const page = html.slice(start, html.indexOf('</section>', start));
const fields = [...page.matchAll(/<div class="field[^"]*"([^>]*)>/g)].map((m) => ({ tag: m[0], sec: /data-sec="([^"]+)"/.exec(m[0])?.[1] }));

test('every field of General is in one of its tabs, and every tab has fields', () => {
  const ids = GENERAL_SECTIONS.map(([id]) => id);
  const top = fields.filter((f) => /data-sec=/.test(f.tag) || /^<div class="field/.test(f.tag));
  assert.ok(top.length >= 20, `found ${top.length} fields`);
  for (const f of top) if (f.sec) assert.ok(ids.includes(f.sec), `${f.tag} is in an unknown tab`);
  for (const id of ids) assert.ok(top.some((f) => f.sec === id), `the ${id} tab has no fields`);
  // A field without a tab would show on every tab, or on none.
  const without = top.filter((f) => !f.sec);
  assert.equal(without.length, 0, `fields without a tab: ${without.map((f) => f.tag).join(' ')}`);
});

test('the tabs are named and unique, and the other groups still list their pages', () => {
  const ids = GENERAL_SECTIONS.map(([id]) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(GENERAL_SECTIONS.map(([, label]) => label), ['Look', 'Desktop', 'Orb', 'Privacy', 'Chat', 'Voice and hands', 'System']);
  assert.deepEqual(SETTINGS_GROUPS.map((g) => g.label), ['General', 'Models', 'Agents', 'Knowledge']);
});

test('settings are kept without a Save button: custom instructions and the shortcut save themselves', () => {
  assert.ok(!page.includes('id="save-prompt"') && !page.includes('id="const-shortcut-save"'));
  assert.ok(page.includes('id="prompt-state"') && html.includes('id="save-flash"'));
});
