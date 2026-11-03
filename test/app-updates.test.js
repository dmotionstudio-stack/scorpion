import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNewer, pickDownload, appUpdateLine, createAppUpdates } from '../src/main/app-updates.js';

test('versions: numbers compared part by part', () => {
  assert.equal(isNewer('0.1.12', '0.1.9'), true);
  assert.equal(isNewer('v0.2.0', '0.1.12'), true);
  assert.equal(isNewer('0.1.11', '0.1.11'), false);
  assert.equal(isNewer('0.1.10', '0.1.11'), false);
  assert.equal(isNewer('1.0', '0.9.9'), true);
  assert.equal(isNewer('0.1.12-beta', '0.1.12'), false);
  assert.equal(isNewer('', '0.1.0'), false);
});

const RELEASE = {
  html_url: 'https://github.com/dmotionstudio-stack/scorpion/releases/tag/v0.1.12',
  assets: [
    { name: 'Scorpion-Setup-0.1.12.exe', browser_download_url: 'https://x/win.exe' },
    { name: 'Scorpion-Setup-0.1.12.exe.blockmap', browser_download_url: 'https://x/win.exe.blockmap' },
    { name: 'latest.yml', browser_download_url: 'https://x/latest.yml' },
    { name: 'Scorpion-0.1.12-arm64.dmg', browser_download_url: 'https://x/arm.dmg' },
    { name: 'Scorpion-0.1.12.dmg', browser_download_url: 'https://x/intel.dmg' },
  ],
};

test('the download for this computer', () => {
  assert.equal(pickDownload(RELEASE, { platform: 'darwin', arch: 'arm64' }), 'https://x/arm.dmg');
  assert.equal(pickDownload(RELEASE, { platform: 'darwin', arch: 'x64' }), 'https://x/intel.dmg');
  assert.equal(pickDownload(RELEASE, { platform: 'win32', arch: 'x64' }), 'https://x/win.exe');
  // Nothing that fits: the release's page.
  assert.equal(pickDownload({ ...RELEASE, assets: [] }, { platform: 'darwin', arch: 'arm64' }), RELEASE.html_url);
});

test("the state's line", () => {
  assert.equal(appUpdateLine({ supported: false }), '');
  assert.equal(appUpdateLine({ supported: true, current: '0.1.11' }), 'Scorpion 0.1.11');
  assert.equal(appUpdateLine({ supported: true, current: '0.1.11', lastCheck: 1 }), 'Scorpion 0.1.11 is the newest.');
  assert.equal(appUpdateLine({ supported: true, current: '0.1.11', available: { version: '0.1.12' } }), 'Scorpion 0.1.12 is out (you have 0.1.11).');
  assert.equal(appUpdateLine({ supported: true, current: '0.1.11', available: { version: '0.1.12' }, downloading: true, progress: 40 }), 'Downloading Scorpion 0.1.12… 40%');
  assert.equal(appUpdateLine({ supported: true, current: '0.1.11', available: { version: '0.1.12' }, ready: true }), 'Scorpion 0.1.12 is ready. It installs when Scorpion restarts.');
});

// macOS (and portable copies): the release from GitHub's API, a notice once, the download opened.
function mac(over = {}) {
  const sent = [];
  const opened = [];
  const notices = [];
  const u = createAppUpdates({
    version: '0.1.11', platform: 'darwin', arch: 'arm64', packaged: true, portable: false,
    getSettings: () => ({}), send: (c, p) => sent.push(p), openExternal: (url) => opened.push(url),
    notify: (n) => notices.push(n), fetchJson: async () => ({ ...RELEASE, tag_name: 'v0.1.12' }), ...over,
  });
  return { u, sent, opened, notices };
}

test('macOS: a newer release is found, said once, and its disk image opened', async () => {
  const { u, opened, notices } = mac();
  const v = await u.check({ quiet: true });
  assert.equal(v.supported, true);
  assert.equal(v.installs, false);
  assert.deepEqual(v.available, { version: '0.1.12', url: 'https://x/arm.dmg' });
  await u.check({ quiet: true });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].title, 'Scorpion 0.1.12 is out');
  u.download();
  assert.deepEqual(opened, ['https://x/arm.dmg']);
});

test('up to date, offline, and not where it applies', async () => {
  const same = await mac({ fetchJson: async () => ({ ...RELEASE, tag_name: 'v0.1.11' }) }).u.check();
  assert.equal(same.available, null);
  assert.equal(same.line, 'Scorpion 0.1.11 is the newest.');
  const offline = mac({ fetchJson: async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com'); } }).u;
  assert.equal((await offline.check({ quiet: true })).error, null); // a quiet check says nothing
  assert.match((await offline.check()).error, /Couldn't reach GitHub/);
  assert.equal(mac({ packaged: false }).u.view().supported, false); // running from the source
  assert.equal(mac({ platform: 'linux' }).u.view().supported, false); // Scorpion OS: with the system
  // A portable Windows copy points at the installer instead of installing.
  const portable = mac({ platform: 'win32', arch: 'x64', portable: true }).u;
  assert.equal(portable.view().installs, false);
  assert.equal((await portable.check()).available.url, 'https://x/win.exe');
});
