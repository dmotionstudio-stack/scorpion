import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { updateIntervalMs, isCheckDue, UNITS, createAppUpdates } from '../src/main/app-updates.js';

const DAY = 24 * 3600_000;

test('how often to look: days, weeks or months, from the settings', () => {
  assert.equal(updateIntervalMs({ appUpdateEvery: 1, appUpdateUnit: 'days' }), DAY);
  assert.equal(updateIntervalMs({ appUpdateEvery: 3, appUpdateUnit: 'days' }), 3 * DAY);
  assert.equal(updateIntervalMs({ appUpdateEvery: 2, appUpdateUnit: 'weeks' }), 14 * DAY);
  assert.equal(updateIntervalMs({ appUpdateEvery: 1, appUpdateUnit: 'months' }), 30 * DAY);
  assert.equal(UNITS.months, 30 * DAY);
  // Anything odd is a day; the number is a whole number from 1 to 99.
  assert.equal(updateIntervalMs({}), DAY);
  assert.equal(updateIntervalMs({ appUpdateEvery: 0, appUpdateUnit: 'weeks' }), 7 * DAY);
  assert.equal(updateIntervalMs({ appUpdateEvery: 'x', appUpdateUnit: 'hours' }), DAY);
  assert.equal(updateIntervalMs({ appUpdateEvery: 2.6, appUpdateUnit: 'days' }), 3 * DAY);
  assert.equal(updateIntervalMs({ appUpdateEvery: 500, appUpdateUnit: 'days' }), 99 * DAY);
});

test('a look is due when none was made, the time has passed, or the clock was set back', () => {
  const now = 1_000 * DAY;
  assert.equal(isCheckDue(0, now, DAY), true);
  assert.equal(isCheckDue(now - DAY / 2, now, DAY), false);
  assert.equal(isCheckDue(now - DAY, now, DAY), true);
  assert.equal(isCheckDue(now - 6 * DAY, now, 7 * DAY), false);
  assert.equal(isCheckDue(now + DAY, now, DAY), true);
});

const RELEASE = { tag_name: 'v0.1.12', html_url: 'https://x/r', assets: [{ name: 'Scorpion-0.1.12-arm64.dmg', browser_download_url: 'https://x/arm.dmg' }] };
function mac(settings, over = {}) {
  const saved = [];
  const notices = [];
  const fetched = [];
  const u = createAppUpdates({
    version: '0.1.11', platform: 'darwin', arch: 'arm64', packaged: true, portable: false,
    getSettings: () => settings, saveSettings: (p) => { saved.push(p); Object.assign(settings, p); }, send: () => {}, openExternal: () => {},
    notify: (n) => notices.push(n), fetchJson: async () => { fetched.push(1); return RELEASE; }, ...over,
  });
  return { u, saved, notices, fetched };
}

test('a look is remembered, and a new version is announced once, unless notifications are off', async () => {
  const on = mac({});
  await on.u.check({ quiet: true });
  assert.equal(on.saved.length, 1);
  assert.ok(on.saved[0].appUpdateChecked > 0);
  assert.equal(on.notices.length, 1);
  assert.equal(on.notices[0].title, 'Scorpion 0.1.12 is out');
  await on.u.check({ quiet: true });
  assert.equal(on.notices.length, 1);

  const off = mac({ appUpdateNotify: false });
  await off.u.check({ quiet: true });
  assert.equal(off.notices.length, 0);
  assert.equal(off.u.view().available.version, '0.1.12'); // still found, just not announced
});

test('the schedule: it looks after the first two minutes only when a look is due, then asks again every half hour', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // Looked a moment ago, every 3 days: nothing yet.
  const recent = mac({ appUpdateEvery: 3, appUpdateUnit: 'days', appUpdateChecked: Date.now() - 1000 });
  recent.u.start();
  t.mock.timers.tick(2 * 60_000 + 10);
  await Promise.resolve();
  assert.equal(recent.fetched.length, 0);
  // Three days later it looks.
  recent.u.view();
  const stale = mac({ appUpdateEvery: 3, appUpdateUnit: 'days', appUpdateChecked: Date.now() - 4 * DAY });
  stale.u.start();
  t.mock.timers.tick(2 * 60_000 + 10);
  await new Promise((r) => setImmediate(r));
  assert.equal(stale.fetched.length, 1);
  // Turned off: never.
  const off = mac({ appUpdates: false, appUpdateChecked: 0 });
  off.u.start();
  t.mock.timers.tick(2 * 60_000 + 10);
  await new Promise((r) => setImmediate(r));
  assert.equal(off.fetched.length, 0);
  mock.timers.reset();
});
