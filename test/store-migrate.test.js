import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../src/main/store.js';

// Settings written by an older Scorpion are brought up to date once, when read.
test('older settings are brought up to date, once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-settings-'));
  store.initStore(dir);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'smoke', taskbar: { layout: 'gravity', autoHide: true, show: { clock: false } }, wheel: { size: 'small' } }));
  const s = store.getSettings();
  assert.equal(s.settingsVersion, store.SETTINGS_VERSION);
  assert.equal(s.taskbar.layout, 'orbit', 'the removed taskbar falls back to the edge rail');
  assert.equal(s.taskbar.autoHide, true, 'what was set is kept');
  assert.equal(s.taskbar.show.clock, false);
  assert.equal(s.taskbar.show.mail, true, 'what was missing is filled in');
  assert.deepEqual(s.wheel, { size: 'small', button: 'normal', recent: true, frosted: true });
  // Saved at the new version: the steps don't run again.
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(onDisk.settingsVersion, store.SETTINGS_VERSION);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a first start writes nothing; settings from a newer Scorpion are left alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-settings-'));
  store.initStore(dir);
  assert.equal(store.getSettings().settingsVersion, store.SETTINGS_VERSION);
  assert.equal(fs.existsSync(path.join(dir, 'settings.json')), false);
  const newer = { settingsVersion: store.SETTINGS_VERSION + 5, taskbar: { layout: 'gravity' } };
  assert.deepEqual(store.migrateSettings(newer), newer);
  fs.rmSync(dir, { recursive: true, force: true });
});
