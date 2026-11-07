import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandOf, parseAgentCommand, suggestAgents } from '../src/renderer/agent-commands.js';
import { SETTINGS_GROUPS, groupOf } from '../src/renderer/settings-nav.js';
import { BUILTIN_AGENTS } from '../src/main/agents.js';

const agents = [...BUILTIN_AGENTS, { id: 'custom-9f2a', name: 'Tax Helper' }];

test('built-in agents are run by their id, your own by their name', () => {
  assert.equal(commandOf(agents.find((a) => a.id === 'coder')), 'coder');
  assert.equal(commandOf(agents.at(-1)), 'tax-helper');
});

test('"/coder fix this" picks Coder and keeps the rest as the message', () => {
  const r = parseAgentCommand('/coder  fix the failing test\nplease', agents);
  assert.equal(r.agent.id, 'coder');
  assert.equal(r.rest, 'fix the failing test\nplease');
});

test('a command alone has an empty message, and matching ignores case', () => {
  assert.deepEqual(parseAgentCommand('/Researcher', agents).rest, '');
  assert.equal(parseAgentCommand('/TAX-HELPER do my sums', agents).agent.id, 'custom-9f2a');
});

test('names with spaces work as a slug, and the id works too', () => {
  assert.equal(parseAgentCommand('/file-organizer tidy Downloads', agents).agent.id, 'organizer');
  assert.equal(parseAgentCommand('/organizer tidy Downloads', agents).agent.id, 'organizer');
});

test('anything that is not an agent command is left as ordinary text', () => {
  for (const t of ['hello', '/unknown do it', '/etc/hosts what is this', '/ coder', ' fix /coder', '']) {
    assert.equal(parseAgentCommand(t, agents), null, t);
  }
});

test('suggestions follow the half-typed command and close once a space is typed', () => {
  assert.equal(suggestAgents('/', agents).length, agents.length);
  assert.deepEqual(suggestAgents('/co', agents).map((a) => a.id), ['coder']);
  assert.deepEqual(suggestAgents('/Tax', agents).map((a) => a.id), ['custom-9f2a']);
  assert.deepEqual(suggestAgents('/zzz', agents), []);
  assert.equal(suggestAgents('/coder ', agents), null);
  assert.equal(suggestAgents('hello', agents), null);
});

test('every settings page is in exactly one group, and there are far fewer groups than pages', () => {
  const pages = SETTINGS_GROUPS.flatMap((g) => g.views.map(([v]) => v));
  assert.deepEqual([...pages].sort(), ['agents', 'connections', 'docs', 'memory', 'models', 'people', 'personality', 'schedules', 'settings', 'skills']);
  assert.equal(new Set(pages).size, pages.length);
  assert.ok(SETTINGS_GROUPS.length <= 4);
  assert.equal(groupOf('schedules').id, 'agents');
  assert.equal(groupOf('connections').id, 'models');
  assert.equal(groupOf('chat'), null);
});
