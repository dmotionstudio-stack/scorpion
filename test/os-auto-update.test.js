import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createUpdates } from '../src/main/updates.js';

const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const rootfs = path.join(root, 'os', 'rootfs');
const script = path.join(rootfs, 'usr', 'lib', 'scorpion-os', 'scorpion-update');
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;

// Runs scorpion-update as a normal user against a folder of its own (the script's test switch).
function update(dir, ...args) {
  const r = spawnSync('bash', [script.replace(/\\/g, '/'), ...args], { encoding: 'utf8', env: { ...process.env, SCORPION_UPDATE_TEST: '1', SCORPION_APT_CONF_DIR: dir.replace(/\\/g, '/') } });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

test('scorpion-update auto: what installs by itself', { skip: !hasBash && 'no bash here' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-auto-'));
  assert.equal(update(dir, 'auto', 'get').out, 'security', 'no file: Ubuntu\'s own default');
  assert.equal(update(dir, 'auto', 'all').out, 'all');
  const all = fs.readFileSync(path.join(dir, '52scorpion-auto-upgrades'), 'utf8');
  for (const origin of ['-security', '-updates', 'Scorpion:stable']) assert.ok(all.includes(origin), origin);
  assert.match(all, /Automatic-Reboot "false"/, 'it never restarts by itself');
  assert.match(all, /Unattended-Upgrade "1"/);
  assert.equal(update(dir, 'auto', 'get').out, 'all');
  update(dir, 'auto', 'security');
  const sec = fs.readFileSync(path.join(dir, '52scorpion-auto-upgrades'), 'utf8');
  assert.ok(sec.includes('-security') && !sec.includes('Scorpion:stable') && !sec.includes('-updates'), 'security only means only security');
  assert.equal(update(dir, 'auto', 'get').out, 'security');
  update(dir, 'auto', 'off');
  assert.match(fs.readFileSync(path.join(dir, '52scorpion-auto-upgrades'), 'utf8'), /Unattended-Upgrade "0"/);
  assert.equal(update(dir, 'auto', 'get').out, 'off');
  const bad = update(dir, 'auto', 'everything-and-more');
  assert.equal(bad.code, 3);
  assert.deepEqual(fs.readdirSync(dir), ['52scorpion-auto-upgrades'], 'no temporary files are left');
});

test('an installed Scorpion OS updates itself from the first start, and the live USB session does not', () => {
  const def = fs.readFileSync(path.join(rootfs, 'etc', 'apt', 'apt.conf.d', '52scorpion-auto-upgrades'), 'utf8');
  assert.match(def, /^\/\/ level: all$/m, 'everything, by default');
  assert.ok(def.includes('"Scorpion:stable"'));
  // Scorpion's repository really has that origin and suite
  assert.match(fs.readFileSync(path.join(root, 'os', 'apt', 'make-repo.sh'), 'utf8'), /Release::Origin=Scorpion[\s\S]*Release::Suite=stable/);
  for (const unit of ['apt-daily', 'apt-daily-upgrade']) {
    assert.match(fs.readFileSync(path.join(rootfs, 'usr', 'lib', 'systemd', 'system', `${unit}.service.d`, 'scorpion-live.conf'), 'utf8'), /ConditionKernelCommandLine=!boot=casper/, unit);
  }
  const sudoers = fs.readFileSync(path.join(rootfs, 'etc', 'sudoers.d', 'scorpion-update'), 'utf8');
  for (const level of ['get', 'off', 'security', 'all']) assert.ok(sudoers.includes(`scorpion-update auto ${level}`), level);
  assert.ok(!/auto \*|NOPASSWD: ALL/.test(sudoers), 'no wildcard: only these exact commands');
});

test('the manager shows and changes the level, and stays quiet about updates that install themselves', async () => {
  let level = 'all';
  let settings = {};
  const events = [];
  const sys = {
    updatesAvailable: () => true,
    checkUpdates: async () => ({ system: [{ name: 'firefox', from: '1', to: '2' }], apps: [] }),
    installUpdates: async () => false,
    autoUpdateLevel: async () => level,
    setAutoUpdateLevel: async (l) => { if (!['off', 'security', 'all'].includes(l)) throw new Error('Choose off, security or all.'); level = l; return l; },
    restartRequired: () => true,
  };
  const u = createUpdates({ sys, send: (ch, v) => events.push(v), getSettings: () => settings, updateSettings: (p) => { settings = { ...settings, ...p }; } });
  let v = await u.check({ quiet: true });
  assert.equal(v.auto, 'all');
  assert.equal(settings.updatesAnnounced, undefined, 'nothing to announce: it installs by itself');
  assert.equal(v.restartNeeded, true, 'a restart an automatic install asked for is shown');
  v = await u.setAuto('off');
  assert.equal(v.auto, 'off');
  assert.equal(level, 'off');
  v = await u.check({ quiet: true });
  assert.ok(settings.updatesAnnounced, 'with Nothing chosen the person is told');
  v = await u.setAuto('bogus');
  assert.match(v.error, /Choose off/);
});

// ---------- a clock that is hours behind (Windows on the same computer keeps the hardware clock in local time) ----------
import { isClockError, CLOCK_HELP } from '../src/main/linux-control.js';

// A folder of pretend system programs; each writes its call to a log.
function fakeSystem(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-fake-'));
  const log = path.join(dir, 'calls.log');
  for (const [name, body] of Object.entries(files)) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, `#!/bin/bash\necho "${name} $*" >> "${asBash(log)}"\n${body}\n`);
    fs.chmodSync(f, 0o755);
  }
  return { dir, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) };
}
const asBash = (p) => p.split(path.sep).join('/');
function runUpdate(args, { fake, efi, extra = {} }) {
  const r = spawnSync('bash', [asBash(script), ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${asBash(fake.dir)}:${process.env.PATH}`, SCORPION_UPDATE_TEST: '1', SCORPION_APT_CONF_DIR: asBash(os.tmpdir()), SCORPION_EFI_DIR: asBash(efi), SCORPION_CLOCK_WAIT: '2', ...extra } });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

test('a clock that is behind: apt\'s "not valid yet" becomes a clear answer, and the clock is put right', { skip: !hasBash && 'no bash here' }, () => {
  // the message from the report: the security repository's files are dated later than this computer's clock
  const fake = fakeSystem({ 'apt-get': 'case "$*" in *update*) echo "E: Release file for http://security.ubuntu.com/ubuntu/dists/noble-security/InRelease is not valid yet (invalid for another 5h 3min). Updates for this repository will not be applied." >&2; exit 100;; esac' });
  const noWindows = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-efi-'));
  const r = runUpdate(['check'], { fake, efi: noWindows });
  assert.equal(r.code, 4, 'its own exit code for a wrong clock');
  assert.match(r.err, /clock is wrong/);
  assert.ok(isClockError(r.err));
  assert.ok(isClockError('E: Release file for x is not valid yet (invalid for another 5h 3min)'));
  assert.ok(!isClockError('Temporary failure resolving archive.ubuntu.com'));
  assert.match(CLOCK_HELP, /Sync now/);
  // another failure is passed on as it was
  const other = fakeSystem({ 'apt-get': 'echo "E: Failed to fetch http://x  Temporary failure resolving" >&2; exit 100' });
  const o = runUpdate(['check'], { fake: other, efi: noWindows });
  assert.equal(o.code, 1);
  assert.match(o.err, /Temporary failure/);
});

test('scorpion-update clock: the internet\'s time first, and beside Windows the hardware clock in local time', { skip: !hasBash && 'no bash here' }, () => {
  const timedatectl = 'if [ "$1" = show ]; then echo yes; fi';
  // with Windows on the computer (its boot files are there)
  const withWin = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-efi-'));
  fs.mkdirSync(path.join(withWin, 'EFI', 'Microsoft', 'Boot'), { recursive: true });
  const a = fakeSystem({ timedatectl, systemctl: 'true', hwclock: 'true', 'os-prober': 'true' });
  const r = runUpdate(['clock'], { fake: a, efi: withWin });
  assert.equal(r.out, 'synced');
  const calls = a.calls();
  assert.ok(calls.indexOf('timedatectl set-ntp true') >= 0 && calls.indexOf('systemctl restart systemd-timesyncd.service') >= 0);
  const iNtp = calls.indexOf('timedatectl set-ntp true');
  const iLocal = calls.indexOf('timedatectl set-local-rtc 1');
  assert.ok(iLocal > iNtp, 'local time for the hardware clock comes after the system clock is true');
  assert.ok(calls.includes('hwclock --systohc'), 'and the hardware clock is written');
  // without Windows the hardware clock is left alone
  const noWin = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-efi-'));
  const b = fakeSystem({ timedatectl, systemctl: 'true', hwclock: 'true', 'os-prober': 'true' });
  assert.equal(runUpdate(['clock'], { fake: b, efi: noWin }).out, 'synced');
  assert.ok(!b.calls().some((c) => c.includes('set-local-rtc')));
  // no internet time yet: it says so
  const c = fakeSystem({ timedatectl: 'if [ "$1" = show ]; then echo no; fi', systemctl: 'true', hwclock: 'true', 'os-prober': 'true' });
  assert.equal(runUpdate(['clock'], { fake: c, efi: noWin }).out, 'not synced');
});

test('the installer keeps the clock right beside Windows from the first start', () => {
  const after = fs.readFileSync(path.join(rootfs, 'usr', 'lib', 'scorpion-os', 'after-install'), 'utf8');
  assert.match(after, /EFI\/Microsoft/);
  assert.match(after, /LOCAL/);
  assert.match(after, /systemctl enable systemd-timesyncd/);
  assert.match(fs.readFileSync(path.join(root, 'os', 'config', 'packages.list'), 'utf8'), /^systemd-timesyncd$/m);
  assert.ok(fs.readFileSync(path.join(rootfs, 'etc', 'sudoers.d', 'scorpion-update'), 'utf8').includes('scorpion-update clock'));
});
