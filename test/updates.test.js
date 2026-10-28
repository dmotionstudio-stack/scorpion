import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updatesSummary, updatesKey, createUpdates } from '../src/main/updates.js';
import { parseUpdates, parseFlatpakUpdates } from '../src/main/linux-control.js';
import { checkedWhen, updatesLine, snapshotLabel } from '../src/renderer/settings-system.js';

test('what scorpion-update and flatpak say', () => {
  assert.deepEqual(parseUpdates('firefox\t131.0\t132.0\nlibc6\t2.39-0ubuntu8\t2.39-0ubuntu8.3\n\nbroken line'), [
    { name: 'firefox', from: '131.0', to: '132.0' },
    { name: 'libc6', from: '2.39-0ubuntu8', to: '2.39-0ubuntu8.3' },
  ]);
  assert.deepEqual(parseFlatpakUpdates('com.spotify.Client\tSpotify\norg.gimp.GIMP\tGNU Image Manipulation Program\n'), [
    { id: 'com.spotify.Client', name: 'Spotify' },
    { id: 'org.gimp.GIMP', name: 'GNU Image Manipulation Program' },
  ]);
});

test('the words for a set of updates', () => {
  assert.equal(updatesSummary({ system: [{}, {}, {}], apps: [{}] }), '3 system updates and 1 app');
  assert.equal(updatesSummary({ system: [{}], apps: [] }), '1 system update');
  assert.equal(updatesSummary({ system: [], apps: [] }), null);
  assert.equal(updatesKey({ system: [{ name: 'b', to: '2' }, { name: 'a', to: '1' }], apps: [{ id: 'x.y' }] }), 'a=1,b=2,x.y');
});

test('the manager: checks, remembers what it announced, installs with progress', async () => {
  const events = [];
  let settings = {};
  const found = { system: [{ name: 'firefox', from: '131', to: '132' }], apps: [] };
  const sys = {
    updatesAvailable: () => true,
    checkUpdates: async () => found,
    installUpdates: async (onProgress) => { onProgress(45, 'Unpacking firefox'); onProgress(100, 'Done'); return true; },
  };
  const u = createUpdates({ sys, send: (ch, v) => events.push([ch, v]), getSettings: () => settings, updateSettings: (p) => { settings = { ...settings, ...p }; } });
  const v = await u.check();
  assert.equal(v.summary, '1 system update');
  assert.ok(v.lastCheck);
  assert.equal(settings.updatesAnnounced, undefined); // a check you asked for isn't announced
  const done = await u.install();
  assert.equal(done.restartNeeded, true);
  assert.equal(done.summary, null);
  assert.ok(events.some(([ch, e]) => ch === 'sys:updates' && e.installing && e.progress === 45 && e.step === 'Unpacking firefox'));
  assert.ok(events.every(([ch]) => ch === 'sys:updates'));
});

test('a failed check says why', async () => {
  const sys = { updatesAvailable: () => true, checkUpdates: async () => { throw new Error('No internet connection.'); } };
  const u = createUpdates({ sys, send: () => {} });
  const v = await u.check();
  assert.equal(v.error, 'No internet connection.');
  assert.equal(updatesLine(v), 'No internet connection.');
  assert.deepEqual(createUpdates({ sys: { updatesAvailable: () => false }, send: () => {} }).view().supported, false);
});

test('what Settings → This computer says', () => {
  const now = new Date(2026, 9, 27, 15, 0).getTime();
  assert.match(checkedWhen(new Date(2026, 9, 27, 10, 42).getTime(), now), /^Checked 10:42/);
  assert.match(checkedWhen(new Date(2026, 9, 26, 9, 5).getTime(), now), /^Checked yesterday, 9:05/);
  assert.equal(checkedWhen(null, now), '');
  assert.equal(updatesLine({ installing: true, progress: 40, step: 'Setting up firefox' }), 'Installing… 40% · Setting up firefox');
  assert.equal(updatesLine({ checking: true }), 'Looking for updates…');
  assert.equal(updatesLine({ summary: '2 system updates' }), '2 system updates ready');
  assert.equal(updatesLine({ restartNeeded: true }), 'Updates installed. Restart to finish.');
  assert.equal(updatesLine({}), 'Not checked yet');
  const s = snapshotLabel({ id: '20261026-083040', date: '2026-10-26T08:30:40-04:00', reason: 'Before installing or removing packages' });
  assert.equal(s.reason, 'Before installing or removing packages');
  assert.match(s.at, /Oct 26/);
  assert.equal(snapshotLabel({ id: '20261026-083040', date: '' }).at, '20261026-083040');
});

test('the settings keep what updates and accessibility store', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const store = await import('../src/main/store.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-store-'));
  store.initStore(dir);
  store.updateSettings({ updatesAnnounced: 'firefox=132', access: { bigText: true, screenReader: false, keyboard: false } });
  assert.equal(store.getSettings().updatesAnnounced, 'firefox=132');
  assert.equal(store.getSettings().access.bigText, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
