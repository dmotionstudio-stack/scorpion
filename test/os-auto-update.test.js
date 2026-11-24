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
