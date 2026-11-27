import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOGGLES, TOGGLE_ACTIONS, parseToggle, toggleRisk, consentScript, radioScript, dndScript, windowsToggle, macToggle, linuxToggle, wifiDevice, macMajor } from '../src/main/toggles.js';
import * as win from '../src/main/windows-control.js';
import { INTENTS, MAIN_CONTROLS, intentsFor, matchSpoken } from '../src/shared/intents.js';

test('every switch has an on and an off, and they are system_control actions on every system', () => {
  assert.equal(TOGGLE_ACTIONS.length, Object.keys(TOGGLES).length * 2);
  for (const a of TOGGLE_ACTIONS) assert.ok(win.ACTIONS.includes(a), a);
  assert.deepEqual(parseToggle('camera_off'), { setting: 'camera', on: false });
  assert.deepEqual(parseToggle('airplane_mode_on'), { setting: 'airplane_mode', on: true });
  assert.deepEqual(parseToggle('do_not_disturb_off'), { setting: 'do_not_disturb', on: false });
  for (const bad of ['volume_up', 'camera', 'camera_maybe', 'toaster_on', '', null]) assert.equal(parseToggle(bad), null, String(bad));
});

test('what could cut the person off, or open a privacy door, asks first', () => {
  for (const a of ['camera_on', 'microphone_on', 'wifi_off', 'bluetooth_off', 'airplane_mode_on']) assert.equal(toggleRisk(a), 'ask', a);
  for (const a of ['camera_off', 'microphone_off', 'wifi_on', 'bluetooth_on', 'airplane_mode_off', 'do_not_disturb_on', 'night_light_off']) assert.equal(toggleRisk(a), 'none', a);
  assert.equal(win.actionRisk('wifi_off'), 'ask');
  assert.equal(win.actionRisk('camera_off'), 'none');
  assert.equal(win.actionRisk('shutdown'), 'always');
});

test('Windows: the scripts say what they do', () => {
  assert.match(consentScript('webcam', false), /ConsentStore\\webcam'.*'Deny'/);
  assert.match(consentScript('microphone', true), /ConsentStore\\microphone\\NonPackaged.*'Allow'/);
  const wifiOff = radioScript(['WiFi'], false);
  assert.match(wifiOff, /\$kinds = @\('WiFi'\)/);
  assert.match(wifiOff, /SetStateAsync\('Off'\)/);
  assert.match(radioScript(['WiFi', 'Bluetooth'], true), /SetStateAsync\('On'\)/);
  assert.match(dndScript(true), /NOC_GLOBAL_SETTING_TOASTS_ENABLED -Type DWord -Value 0/);
  assert.match(dndScript(false), /-Value 1/);
});

test('Windows: each switch does its own thing, and says what happened', async () => {
  const ran = [];
  const opened = [];
  const deps = { runPs: async (s) => { ran.push(s); return /ConsentStore/.test(s) ? (/'Deny'/.test(s) ? 'Deny' : 'Allow') : 'done'; }, openSettings: async (p) => { opened.push(p); } };
  assert.match(await windowsToggle('camera', false, deps), /^Camera access is off\./);
  assert.match(ran.at(-1), /webcam/);
  assert.match(await windowsToggle('microphone', true, deps), /^Microphone is on\./);
  assert.equal(await windowsToggle('wifi', false, deps), 'Wi-Fi is off.');
  assert.match(ran.at(-1), /'WiFi'.*SetStateAsync\('Off'\)/);
  assert.equal(await windowsToggle('bluetooth', true, deps), 'Bluetooth is on.');
  // Airplane mode on = every radio off; off = every radio on.
  assert.equal(await windowsToggle('airplane_mode', true, deps), 'Airplane mode is on.');
  assert.match(ran.at(-1), /SetStateAsync\('Off'\)/);
  assert.equal(await windowsToggle('airplane_mode', false, deps), 'Airplane mode is off.');
  assert.match(ran.at(-1), /SetStateAsync\('On'\)/);
  assert.match(await windowsToggle('do_not_disturb', true, deps), /^Do not disturb is on\./);
  // Night light has no switch to flip: its page opens and the answer says so.
  assert.match(await windowsToggle('night_light', true, deps), /can't be switched from outside the system settings.*page is open/);
  assert.deepEqual(opened, ['nightlight']);
  // A PC with no Wi-Fi says so; a registry that did not change is an error.
  assert.match(await windowsToggle('wifi', true, { ...deps, runPs: async () => 'none' }), /no Wi-Fi to switch/);
  await assert.rejects(() => windowsToggle('camera', false, { ...deps, runPs: async () => 'Allow' }), /did not change/);
});

test('Mac: Wi-Fi by its device, the microphone by its input level, the rest by the Settings page', async () => {
  const calls = [];
  const deps = (over = {}) => ({
    run: async (cmd, args) => { calls.push([cmd, ...args]); return cmd === 'networksetup' && args[0] === '-listallhardwareports' ? 'Hardware Port: Ethernet\nDevice: en5\n\nHardware Port: Wi-Fi\nDevice: en1\n' : ''; },
    osa: async (lines) => { calls.push(['osascript', ...lines]); return ''; },
    openSettings: async (p) => { calls.push(['open', p]); }, release: '23.4.0', ...over,
  });
  assert.equal(wifiDevice('Hardware Port: Wi-Fi\nDevice: en1\n'), 'en1');
  assert.equal(macMajor('23.4.0'), 23);
  assert.equal(await macToggle('wifi', false, deps()), 'Wi-Fi is off.');
  assert.deepEqual(calls.at(-1), ['networksetup', '-setairportpower', 'en1', 'off']);
  assert.match(await macToggle('microphone', false, deps()), /^Microphone is off\./);
  assert.deepEqual(calls.at(-1), ['osascript', 'set volume input volume 0']);
  assert.match(await macToggle('camera', false, deps()), /Privacy & Security.*page is open/);
  assert.deepEqual(calls.at(-1), ['open', 'camera']);
  assert.match(await macToggle('airplane_mode', true, deps()), /no airplane mode/);
  assert.match(await macToggle('night_light', true, deps()), /Night Shift/);
  assert.deepEqual(calls.at(-1), ['open', 'display']);
  // Focus on a new macOS is the system's own; on an older one the setting is written.
  assert.match(await macToggle('do_not_disturb', true, deps()), /macOS 13 and newer/);
  assert.equal(await macToggle('do_not_disturb', true, deps({ release: '21.6.0' })), 'Do not disturb is on.');
  assert.ok(calls.some((c) => c[0] === 'defaults' && c.includes('true')));
  // Bluetooth through blueutil when the Mac has it; without it, the page.
  assert.equal(await macToggle('bluetooth', true, deps()), 'Bluetooth is on.');
  assert.deepEqual(calls.filter((c) => c[0] === 'blueutil').at(-1), ['blueutil', '--power', '1']);
  const none = deps({ run: async () => { throw new Error('spawn blueutil ENOENT'); } });
  assert.match(await macToggle('bluetooth', true, none), /blueutil/);
});

test('Scorpion OS: the system tools, and what has no switch says so', async () => {
  const calls = [];
  const deps = { run: async (cmd, args) => { calls.push([cmd, ...args]); return ''; }, openSettings: async (p) => { calls.push(['open', p]); } };
  assert.equal(await linuxToggle('wifi', true, deps), 'Wi-Fi is on.');
  assert.deepEqual(calls.at(-1), ['nmcli', 'radio', 'wifi', 'on']);
  assert.equal(await linuxToggle('bluetooth', false, deps), 'Bluetooth is off.');
  assert.deepEqual(calls.at(-1), ['bluetoothctl', 'power', 'off']);
  assert.equal(await linuxToggle('airplane_mode', true, deps), 'Airplane mode is on.');
  assert.deepEqual(calls.at(-1), ['rfkill', 'block', 'all']);
  assert.equal(await linuxToggle('microphone', false, deps), 'Microphone is off.');
  assert.deepEqual(calls.at(-1), ['wpctl', 'set-mute', '@DEFAULT_AUDIO_SOURCE@', '1']);
  assert.equal(await linuxToggle('do_not_disturb', true, deps), 'Do not disturb is on.');
  assert.deepEqual(calls.at(-1), ['makoctl', 'mode', '-a', 'do-not-disturb']);
  assert.match(await linuxToggle('camera', false, deps), /no switch for the camera/);
});

test('spoken and typed: "turn off the camera" switches it, and the Settings pages still open by their names', () => {
  const list = intentsFor('win32');
  const said = (t) => matchSpoken(t, list)?.id ?? null;
  assert.equal(said('turn off the camera'), 'camera-off');
  assert.equal(said('Turn on Bluetooth'), 'bluetooth-on');
  assert.equal(said('wifi off'), 'wifi-off');
  assert.equal(said('disable the microphone please'), 'microphone-off');
  assert.equal(said('airplane mode on'), 'airplane-mode-on');
  assert.equal(said('turn on do not disturb'), 'do-not-disturb-on');
  assert.equal(said('night light off'), 'night-light-off');
  assert.equal(said('bluetooth'), 'bluetooth'); // the page
  assert.equal(said('open Wi-Fi settings'), 'wifi');
  for (const a of TOGGLE_ACTIONS) assert.ok(MAIN_CONTROLS.includes(a), a);
  assert.ok(INTENTS.filter((i) => i.run?.arg && TOGGLE_ACTIONS.includes(i.run.arg)).length === TOGGLE_ACTIONS.length);
  // Restart, shut down and the rest still are not run from a word.
  for (const risky of ['restart', 'shutdown', 'sleep', 'empty_recycle_bin']) assert.ok(!MAIN_CONTROLS.includes(risky));
});
