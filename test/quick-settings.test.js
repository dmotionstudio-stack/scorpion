import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSinks, parseBtShow, parseNmDevices, parseBatteryTime, parseLiveCmdline, parseSavedWifi } from '../src/main/linux-control.js';
import { wifiSub, btSub, batteryLine, bars, needsPassword } from '../src/renderer/quick-core.js';
import { intentsFor, findIntent } from '../src/shared/intents.js';

const WPCTL = `PipeWire 'pipewire-0' [1.0.5, tester@scorpion-vm, cookie:123]
 └─ Clients:
        33. WirePlumber                         [1.0.5, tester@scorpion-vm, pid:1022]

Audio
 ├─ Devices:
 │      42. Built-in Audio                      [alsa]
 │
 ├─ Sinks:
 │  *   46. Built-in Audio Analog Stereo        [vol: 0.40]
 │      47. HDMI / DisplayPort 1 Output         [vol: 1.00 MUTED]
 │
 ├─ Sources:
 │  *   48. Built-in Audio Analog Stereo        [vol: 1.00]
 │
 └─ Streams:

Video
 ├─ Devices:
 ├─ Sinks:
 │      70. Not audio                           [vol: 1.00]

Settings
 └─ Default Configured Devices:
         0. Audio/Sink    alsa_output.pci-0000_00_1f.3.analog-stereo
`;

test('sound outputs come from the Audio block of wpctl status', () => {
  assert.deepEqual(parseSinks(WPCTL), [
    { id: 46, name: 'Built-in Audio Analog Stereo', active: true },
    { id: 47, name: 'HDMI / DisplayPort 1 Output', active: false },
  ]);
  assert.deepEqual(parseSinks(''), []);
});

test('Bluetooth, network devices, battery time, live session, saved networks', () => {
  assert.deepEqual(parseBtShow('No default controller available'), { adapter: false, on: false });
  assert.deepEqual(parseBtShow('Controller 00:1A:7D:DA:71:13 (public)\n\tName: scorpion-vm\n\tPowered: yes\n'), { adapter: true, on: true });
  assert.deepEqual(parseBtShow('Controller 00:1A:7D:DA:71:13 (public)\n\tPowered: no\n'), { adapter: true, on: false });

  assert.deepEqual(parseNmDevices('ethernet:connected:Wired connection 1\nloopback:connected (externally):lo'), { wifiAdapter: false, wifi: null, wired: 'Wired connection 1' });
  assert.deepEqual(parseNmDevices('wifi:connected:Home\\:5G\nethernet:unavailable:'), { wifiAdapter: true, wifi: 'Home:5G', wired: null });

  assert.equal(parseBatteryTime('  state: discharging\n  time to empty:       3.2 hours\n'), '3 h 12 min left');
  assert.equal(parseBatteryTime('  time to full:        45.0 minutes'), 'Full in 45 min');
  assert.equal(parseBatteryTime('  time to empty:       2.0 hours'), '2 h left');
  assert.equal(parseBatteryTime(''), null);

  assert.equal(parseLiveCmdline('BOOT_IMAGE=/casper/vmlinuz boot=casper quiet splash ---'), true);
  assert.equal(parseLiveCmdline('BOOT_IMAGE=/@/boot/vmlinuz root=UUID=1 ro rootflags=subvol=@ quiet'), false);

  assert.deepEqual(parseSavedWifi('Home:802-11-wireless\nWired connection 1:802-3-ethernet\nCafe\\:Guest:802-11-wireless'), ['Home', 'Cafe:Guest']);
});

test('what the panel says', () => {
  assert.equal(wifiSub({ adapter: false, wired: 'Wired connection 1' }), 'Wired');
  assert.equal(wifiSub({ adapter: false }), 'No Wi-Fi');
  assert.equal(wifiSub({ adapter: true, on: false }), 'Off');
  assert.equal(wifiSub({ adapter: true, on: true, connected: 'Home' }), 'Home');
  assert.equal(wifiSub({ adapter: true, on: true }), 'Not connected');

  assert.equal(btSub({ adapter: false }), 'No Bluetooth');
  assert.equal(btSub({ adapter: true, on: true, devices: [{ name: 'Headphones', connected: true }, { name: 'Mouse', connected: false }] }), 'Headphones');
  assert.equal(btSub({ adapter: true, on: true, devices: [] }), 'On');

  assert.equal(batteryLine({ battery: null }), null);
  assert.deepEqual(batteryLine({ battery: 54, time: '3 h left' }), { pct: '54%', detail: '3 h left' });
  assert.deepEqual(batteryLine({ battery: 100, charging: true }), { pct: '100%', detail: 'Fully charged' });

  assert.deepEqual([0, 20, 50, 76, 100].map(bars), [1, 1, 2, 4, 4]);
  assert.equal(needsPassword({ ssid: 'Home', secure: true }, ['Home']), false);
  assert.equal(needsPassword({ ssid: 'Cafe', secure: true }), true);
  assert.equal(needsPassword({ ssid: 'Open', secure: false }), false);
});

test('Install is offered only in the live session', () => {
  assert.equal(findIntent('install', 'linux'), null);
  assert.equal(findIntent('install', 'linux', { live: true }).run.main, 'install');
  assert.equal(findIntent('install', 'win32', { live: true }), null);
  assert.ok(!intentsFor('linux').some((i) => i.id === 'install'));
});
