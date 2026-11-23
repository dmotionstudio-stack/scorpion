import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createMods, modSlug, checkSyntax } from '../src/main/mods.js';

const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-mods-'));
const put = (root, name, files) => { fs.mkdirSync(path.join(root, name), { recursive: true }); for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(root, name, f), text); };
const ok = () => null; // a syntax check that always passes (the real one starts a Node)

test('names are folder-safe', () => {
  assert.equal(modSlug('Dark Sidebar!'), 'dark-sidebar');
  assert.equal(modSlug('../../evil'), 'evil');
  assert.equal(modSlug(''), '');
});

test('a change is checked for syntax before it is applied', () => {
  const root = fresh();
  put(root, 'bad', { 'renderer.js': 'const x = ;' });
  put(root, 'good', { 'renderer.js': 'document.title = "hi";' });
  assert.match(checkSyntax(path.join(root, 'bad')), /renderer\.js/);
  assert.equal(checkSyntax(path.join(root, 'good')), null);
  put(root, 'badmain', { 'main.mjs': 'export default function ( {' });
  assert.match(checkSyntax(path.join(root, 'badmain')), /main\.mjs/);
  put(root, 'goodmain', { 'main.mjs': 'export default function (api) { api.log("hi"); }' });
  assert.equal(checkSyntax(path.join(root, 'goodmain')), null);
  const m = createMods(root);
  assert.throws(() => m.apply('bad'), /syntax error/);
  assert.throws(() => m.apply('nope'), /no mod folder/);
});

test('apply keeps the version before, and rollback goes back one version at a time', () => {
  const root = fresh();
  const m = createMods(root, { check: ok });
  put(root, 'tweak', { 'style.css': 'body{color:red}' });
  assert.deepEqual(m.apply('tweak'), { name: 'tweak', needsRestart: false, reload: true, versions: 0 });
  fs.writeFileSync(path.join(root, 'tweak', 'style.css'), 'body{color:blue}');
  assert.equal(m.apply('tweak').versions, 1);
  fs.writeFileSync(path.join(root, 'tweak', 'style.css'), 'body{color:green}');
  assert.equal(m.apply('tweak').versions, 2);
  m.rollback('tweak');
  assert.equal(fs.readFileSync(path.join(root, 'tweak', 'style.css'), 'utf8'), 'body{color:blue}');
  m.rollback('tweak');
  assert.equal(fs.readFileSync(path.join(root, 'tweak', 'style.css'), 'utf8'), 'body{color:red}');
  assert.throws(() => m.rollback('tweak'), /no earlier version/);
  assert.equal(m.list()[0].versions, 0);
});

test('the lists: what loads, what is turned off, and a mod that throws is turned off by itself', () => {
  const root = fresh();
  const m = createMods(root, { check: ok });
  put(root, 'one', { 'renderer.js': 'a()', 'style.css': 'x{}', 'mod.json': JSON.stringify({ description: 'First' }) });
  put(root, 'two', { 'main.mjs': 'export default () => {}' });
  m.apply('one'); m.apply('two');
  assert.deepEqual(m.payload().map((x) => x.name), ['one']);
  assert.deepEqual(m.mainEntries().map((x) => x.name), ['two']);
  assert.equal(m.list().find((x) => x.name === 'one').description, 'First');
  m.setEnabled('one', false);
  assert.deepEqual(m.payload(), []);
  m.setEnabled('one', true);
  m.recordError('two', 'boom');
  assert.deepEqual(m.mainEntries(), []);
  assert.equal(m.list().find((x) => x.name === 'two').error, 'boom');
  assert.equal(m.list().find((x) => x.name === 'two').enabled, false);
  m.apply('two'); // applying again clears the error and turns it on
  assert.equal(m.list().find((x) => x.name === 'two').error, null);
  assert.equal(m.mainEntries().length, 1);
});

test('safe mode: two unhealthy starts in a row, then mods off and the mods put back as at the last healthy start', () => {
  const root = fresh();
  // a healthy start with a mod in place
  let m = createMods(root, { check: ok });
  put(root, 'stable', { 'style.css': 'a{}' });
  m.apply('stable');
  assert.deepEqual(m.boot(), { safe: false, recovered: [] });
  m.markHealthy(); // .good now holds "stable" as it is
  // the agent changes it and adds a new mod, and the next starts never become healthy
  fs.writeFileSync(path.join(root, 'stable', 'style.css'), 'broken{');
  put(root, 'newbie', { 'renderer.js': 'throw new Error("at start")' });
  m = createMods(root, { check: ok });
  assert.equal(m.boot().safe, false); // first start after the change: pending
  m = createMods(root, { check: ok });
  assert.equal(m.boot().safe, false); // second start: one failed start before it
  m = createMods(root, { check: ok });
  const third = m.boot(); // two failed starts in a row: this one is safe
  assert.equal(third.safe, true);
  assert.deepEqual(m.payload(), [], 'no mod loads in safe mode');
  assert.deepEqual(m.mainEntries(), []);
  assert.ok(third.recovered.some((r) => /stable.*put back/.test(r)));
  assert.ok(third.recovered.some((r) => /newbie.*moved aside/.test(r)));
  assert.equal(fs.readFileSync(path.join(root, 'stable', 'style.css'), 'utf8'), 'a{}');
  assert.ok(!fs.existsSync(path.join(root, 'newbie')), 'the new mod is gone from the mods');
  const aside = fs.readdirSync(path.join(root, '.quarantine'));
  assert.equal(aside.length, 1);
  assert.ok(fs.existsSync(path.join(root, '.quarantine', aside[0], 'newbie', 'renderer.js')), 'moved aside, not deleted');
  assert.match(m.notice().reason, /2 times in a row/);
  m.markHealthy(); // the safe start itself was fine: the next start loads mods again
  m = createMods(root, { check: ok });
  assert.equal(m.boot().safe, false);
  assert.deepEqual(m.payload().map((x) => x.name), ['stable']);
  m.dismissNotice();
  assert.equal(m.notice(), null);
});

test('a healthy start resets the count, and the person can ask for safe mode', () => {
  const root = fresh();
  let m = createMods(root, { check: ok });
  put(root, 'a', { 'style.css': 'a{}' });
  m.apply('a');
  m.boot();
  m = createMods(root, { check: ok });
  m.boot(); // an unhealthy start before this one
  m.markHealthy();
  m = createMods(root, { check: ok });
  assert.equal(m.boot().safe, false);
  m = createMods(root, { check: ok });
  assert.equal(m.boot({ forceSafe: true }).safe, true);
  assert.deepEqual(m.payload(), []);
});

test("a mod's renderer.js is served as a guarded script, and not at all when off or in safe mode", () => {
  const root = fresh();
  const m = createMods(root, { check: ok });
  put(root, 'tint', { 'renderer.js': 'document.title = "x";' });
  m.apply('tint');
  const code = m.script('tint');
  assert.match(code, /document\.title = "x";/);
  assert.match(code, /catch \(err\)[\s\S]*modsError/, 'a throw turns the mod off');
  assert.match(code, /name: "tint"/);
  new vm.Script(code); // it is valid JavaScript as a whole
  assert.equal(m.script('missing'), null);
  m.setEnabled('tint', false);
  assert.equal(m.script('tint'), null);
  m.setEnabled('tint', true);
  m.boot({ forceSafe: true });
  assert.equal(m.script('tint'), null, 'safe mode serves nothing');
});

test('the agent tools reach the mods through the services, and apply and rollback ask first', async () => {
  const { TOOLS } = await import('../src/main/tools.js');
  const { buildFunctions } = await import('../src/main/agent.js');
  const store = await import('../src/main/store.js');
  const agents = await import('../src/main/agents.js');
  store.initStore(fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-modtools-')));
  const calls = [];
  const asked = [];
  const services = { modsList: () => 'No mods yet.', modsApply: ({ name }) => { calls.push(['apply', name]); return `Applied ${name}`; }, modsRollback: ({ name }) => { calls.push(['rollback', name]); return 'rolled'; }, modsEnable: ({ name, enabled }) => { calls.push(['enable', name, enabled]); return 'ok'; } };
  const fns = buildFunctions({
    settings: { ...store.getSettings(), mode: 'build', workspace: os.tmpdir(), autoApprove: false }, agent: agents.getAgent('selfdev'), rag: { hasDocuments: () => false },
    emit() {}, streamedText: () => '', requestApproval: async (i) => { asked.push(i.name); return true; }, services,
  });
  for (const n of ['mod_list', 'mod_apply', 'mod_rollback', 'mod_enable']) assert.ok(n in fns, n);
  assert.equal(await fns.mod_list.handler({}), 'No mods yet.');
  assert.deepEqual(asked, [], 'listing asks nothing');
  assert.equal(await fns.mod_apply.handler({ name: 'tint' }), 'Applied tint');
  await fns.mod_rollback.handler({ name: 'tint' });
  await fns.mod_enable.handler({ name: 'tint', enabled: false });
  assert.deepEqual(asked, ['mod_apply', 'mod_rollback', 'mod_enable']);
  assert.deepEqual(calls, [['apply', 'tint'], ['rollback', 'tint'], ['enable', 'tint', false]]);
  assert.ok(TOOLS.mod_apply.describeAction({ name: 'tint' }).includes('tint'));
});
