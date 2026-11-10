import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhen, clockCommand, parseAuto, clockError, createClock } from '../src/main/clock.js';

test('a date and a time from the fields, or a plain reason why not', () => {
  assert.deepEqual(parseWhen({ date: '2026-11-09', time: '14:05' }), { year: 2026, month: 11, day: 9, hour: 14, minute: 5 });
  assert.deepEqual(parseWhen({ date: '2028-02-29', time: '00:00:30' }), { year: 2028, month: 2, day: 29, hour: 0, minute: 0 });
  for (const bad of [{}, { date: '2026-11-09' }, { time: '10:00' }, { date: '2026-02-30', time: '10:00' }, { date: '2026-11-09', time: '25:00' }, { date: '1999-01-01', time: '10:00' }, { date: "2026-11-09'; rm -rf /", time: '10:00' }, { date: '2026-11-09', time: '10:00; reboot' }]) {
    assert.throws(() => parseWhen(bad), /Choose a date and a time|isn't one the clock can be set to/);
  }
});

test('Windows: every change goes through the permission prompt, and setting by hand turns automatic time off', () => {
  const when = parseWhen({ date: '2026-03-04', time: '07:08' });
  const set = clockCommand('win32', 'set', { when });
  assert.equal(set.elevated, true);
  assert.match(set.script, /-Name Type -Value 'NoSync'/);
  assert.match(set.script, /Set-Date -Date \(Get-Date -Year 2026 -Month 3 -Day 4 -Hour 7 -Minute 8 -Second 0\)/);
  assert.match(clockCommand('win32', 'auto', { on: true }).script, /-Value 'NTP'.*w32tm \/resync/);
  assert.match(clockCommand('win32', 'auto', { on: false }).script, /-Value 'NoSync'/);
  assert.doesNotMatch(clockCommand('win32', 'auto', { on: false }).script, /resync/);
  assert.match(clockCommand('win32', 'sync').script, /Start-Service w32time.*w32tm \/resync \/force/);
  assert.equal(clockCommand('win32', 'nonsense'), null);
});

test('Scorpion OS and macOS: the system asks for the password', () => {
  const when = parseWhen({ date: '2026-03-04', time: '07:08' });
  assert.deepEqual(clockCommand('linux', 'auto', { on: true }), { file: 'timedatectl', args: ['set-ntp', 'true'] });
  assert.deepEqual(clockCommand('linux', 'auto', { on: false }), { file: 'timedatectl', args: ['set-ntp', 'false'] });
  assert.deepEqual(clockCommand('linux', 'set', { when }), { file: 'pkexec', args: ['sh', '-c', "timedatectl set-ntp false && timedatectl set-time '2026-03-04 07:08:00'"] });
  assert.equal(clockCommand('linux', 'sync').file, 'pkexec');
  const mac = clockCommand('darwin', 'set', { when });
  assert.equal(mac.file, '/usr/bin/osascript');
  assert.match(mac.args[1], /-setusingnetworktime off; \/bin\/date 030407082026\.00" with administrator privileges$/);
  assert.match(clockCommand('darwin', 'sync').args[1], /sntp -sS time\.apple\.com/);
  assert.equal(clockCommand('freebsd', 'sync'), null);
});

test('how the clock is set now is read from what the system prints', () => {
  assert.equal(parseAuto('win32', '    Type    REG_SZ    NTP'), true);
  assert.equal(parseAuto('win32', '    Type    REG_SZ    NT5DS'), true);
  assert.equal(parseAuto('win32', '    Type    REG_SZ    NoSync'), false);
  assert.equal(parseAuto('win32', ''), null);
  assert.equal(parseAuto('linux', 'yes\n'), true);
  assert.equal(parseAuto('linux', 'no'), false);
  assert.equal(parseAuto('darwin', 'Network Time: On'), true);
  assert.equal(parseAuto('darwin', 'Network Time: Off'), false);
  assert.equal(parseAuto('darwin', 'You need administrator access to run this tool'), null);
});

test('a change runs once, then says how the clock is set; a refusal is said plainly', async () => {
  const calls = [];
  let type = 'NTP';
  const clock = createClock({
    platform: 'win32',
    exec: async (file, args) => { calls.push([file, ...args.slice(0, 1)]); return `    Type    REG_SZ    ${type}`; },
    elevate: async (script) => { calls.push(['elevated', script]); if (/NoSync/.test(script)) type = 'NoSync'; },
  });
  assert.equal((await clock.status()).auto, true);
  const after = await clock.setManual({ date: '2026-03-04', time: '07:08' });
  assert.equal(after.auto, false);
  assert.match(after.done, /Automatic time is off/);
  assert.equal(calls.filter((c) => c[0] === 'elevated').length, 1);
  await assert.rejects(clock.setManual({ date: 'soon', time: 'later' }), /Choose a date and a time/);
  assert.equal(calls.filter((c) => c[0] === 'elevated').length, 1, 'nothing ran for a date that makes no sense');
  const refused = createClock({ platform: 'win32', exec: async () => '', elevate: async () => { throw new Error('The operation was canceled by the user.'); } });
  await assert.rejects(refused.syncNow(), /Windows needs your OK/);
  const offline = createClock({ platform: 'linux', exec: async (f) => { if (f === 'pkexec') throw new Error('Request dismissed'); return 'no'; } });
  await assert.rejects(offline.syncNow(), /needs your password/);
  await assert.rejects(createClock({ platform: 'freebsd' }).syncNow(), /can't be changed from Scorpion/);
  assert.equal(clockError('win32', new Error('The computer did not resync because no time data was available.')).includes('on the internet'), true);
});
