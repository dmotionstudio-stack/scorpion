import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { INTENTS, MAIN_CONTROLS, intentsFor, findIntent, rankIntents, matchSpoken } from '../src/shared/intents.js';
import * as win from '../src/main/windows-control.js';
import * as linux from '../src/main/linux-control.js';
import { INTENTS as WHEEL } from '../src/renderer/wheel-core.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('every entry is complete and points at something that exists', () => {
  const html = read('src/renderer/index.html');
  const ids = new Set();
  for (const it of INTENTS) {
    assert.ok(it.id && it.label && it.group && Array.isArray(it.keys), it.id);
    assert.ok(!ids.has(it.id), `${it.id} twice`);
    ids.add(it.id);
    const { view, ui, main, arg } = it.run;
    if (view) assert.ok(html.includes(`id="view-${view}"`), `no view "${view}"`);
    else if (ui) assert.ok(['newChat', 'talk', 'sidebar', 'welcome'].includes(ui), `palette.js has no "${ui}"`);
    else if (main === 'settings') {
      assert.ok(arg in win.SETTINGS_PAGES, `Windows has no settings page "${arg}"`);
      if (!it.only) assert.ok(arg in linux.SETTINGS_PAGES, `Scorpion OS has no settings page "${arg}"`);
    } else if (main === 'control') assert.ok(MAIN_CONTROLS.includes(arg) && win.ACTIONS.includes(arg), arg);
    else if (main === 'wheel') assert.ok(WHEEL.some((w) => w.id === arg), `the wheel has no "${arg}"`);
    else if (main === 'install') assert.ok(it.live && it.only === 'linux');
    else assert.fail(`${it.id} runs nothing`);
  }
});

test('the main process runs only safe controls', () => {
  for (const risky of ['restart', 'shutdown', 'sleep', 'empty_recycle_bin']) assert.ok(!MAIN_CONTROLS.includes(risky));
  assert.equal(findIntent('notifications', 'linux'), null); // Windows only
  assert.equal(findIntent('notifications', 'win32').run.arg, 'notifications');
  assert.ok(intentsFor('linux').length < intentsFor('win32').length);
});

test('typing finds the right entry first', () => {
  const list = intentsFor('win32');
  const first = (q) => rankIntents(q, list)[0]?.id;
  assert.equal(first('wifi'), 'wifi');
  assert.equal(first('btth'), 'bluetooth');
  assert.equal(first('lock'), 'lock');
  assert.equal(first('mod'), 'models');
  assert.equal(first('volume'), 'sound');
  assert.equal(first('new chat'), 'new-chat');
  assert.deepEqual(rankIntents('', list), list);
  assert.deepEqual(rankIntents('zzqx', list), []);
});

test('short spoken commands name an entry; anything longer goes to the model', () => {
  const list = intentsFor('linux');
  const said = (t) => matchSpoken(t, list)?.id ?? null;
  assert.equal(said('Open Wi-Fi settings'), 'wifi');
  assert.equal(said('lock the screen'), 'lock');
  assert.equal(said('dark mode please'), 'dark-mode');
  assert.equal(said('show me the models'), 'models');
  assert.equal(said('take a screenshot'), 'screenshot');
  assert.equal(said('start a new chat'), 'new-chat');
  assert.equal(said('what is the weather like in Paris today'), null);
  assert.equal(said('open my notifications'), null); // not on Scorpion OS
});
