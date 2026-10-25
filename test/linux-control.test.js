import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDesktopEntry, parseExec, showsHere, parseToplevels, handleOf, fromHandle, parseBattery, parseActiveConnection, parseRecentXbel, appKind } from '../src/main/linux-control.js';

test('.desktop entries are read the way the freedesktop spec says', () => {
  const e = parseDesktopEntry(`# comment
[Desktop Entry]
Type=Application
Name=Text Editor
Name[de]=Texteditor
Exec=gnome-text-editor %U
Icon=org.gnome.TextEditor
Comment=Edit\\stext files

[Desktop Action new-window]
Name=New Window
Exec=gnome-text-editor --new-window
`);
  assert.equal(e.Name, 'Text Editor', 'unlocalized name, not the German one');
  assert.equal(e.Exec, 'gnome-text-editor %U', 'only the main group, not the action');
  assert.equal(e.Comment, 'Edit text files');
  assert.equal(e.Icon, 'org.gnome.TextEditor');
});

test('Exec lines become argument lists without field codes', () => {
  assert.deepEqual(parseExec('gnome-text-editor %U'), ['gnome-text-editor']);
  assert.deepEqual(parseExec('/usr/bin/env "MY VAR=1" app --file %f'), ['/usr/bin/env', 'MY VAR=1', 'app', '--file']);
  assert.deepEqual(parseExec('sh -c "echo \\"hi\\""'), ['sh', '-c', 'echo "hi"']);
  assert.deepEqual(parseExec('app --level=100%%'), ['app', '--level=100%']);
  assert.deepEqual(parseExec('env BAMF=1 /snap/bin/firefox %u'), ['env', 'BAMF=1', '/snap/bin/firefox']);
});

test('the app list keeps what belongs here', () => {
  const base = { Type: 'Application', Name: 'X', Exec: 'x' };
  assert.equal(showsHere(base, ['scorpion']), true);
  assert.equal(showsHere({ ...base, NoDisplay: 'true' }, ['scorpion']), false);
  assert.equal(showsHere({ ...base, OnlyShowIn: 'GNOME;Unity;' }, ['scorpion', 'wlroots']), false);
  assert.equal(showsHere({ ...base, OnlyShowIn: 'wlroots;' }, ['scorpion', 'wlroots']), true);
  assert.equal(showsHere({ ...base, NotShowIn: 'Scorpion;' }, ['scorpion']), false);
  assert.equal(showsHere({ ...base, Type: 'Link' }, ['scorpion']), false);
  assert.equal(appKind('firefox_firefox.desktop'), 'desktop');
  assert.equal(appKind('/opt/app/run'), 'path');
  assert.equal(appKind('gnome-clocks'), 'command');
});

test('windows come from lswt, with handles that survive the round trip', () => {
  const v2 = JSON.stringify({ version: 2, toplevels: [
    { title: 'Inbox - Thunderbird', 'app-id': 'thunderbird', identifier: 'a1', activated: true, minimized: false },
    { title: 'Files', 'app-id': 'org.gnome.Nautilus', activated: false, minimized: true },
    { title: '', 'app-id': '' },
  ] });
  const tops = parseToplevels(v2);
  assert.equal(tops.length, 2, 'the empty one is dropped');
  assert.deepEqual(tops[0], { title: 'Inbox - Thunderbird', appId: 'thunderbird', active: true, minimized: false, id: 'a1' });
  assert.equal(tops[1].minimized, true);
  const v1 = JSON.stringify([{ title: 'Terminal', app_id: 'foot', state: ['activated', 'maximized'] }]);
  assert.equal(parseToplevels(v1)[0].active, true);
  assert.deepEqual(parseToplevels('not json'), []);
  assert.deepEqual(fromHandle(handleOf({ appId: 'foot', title: 'a: b "c"' })), { appId: 'foot', title: 'a: b "c"' });
  assert.equal(fromHandle('%%%'), null);
});

test('battery, network and recent files are read from their sources', () => {
  assert.deepEqual(parseBattery('87\n', 'Charging\n'), { battery: 87, charging: true });
  assert.deepEqual(parseBattery('42', 'Discharging'), { battery: 42, charging: false });
  assert.deepEqual(parseBattery('', 'Unknown'), { battery: null, charging: false });
  assert.equal(parseActiveConnection('lo:loopback:lo\nHome\\: 5G:802-11-wireless:wlp2s0\n'), 'Home: 5G');
  assert.equal(parseActiveConnection(''), null);
  const xml = `<?xml version="1.0"?><xbel>
    <bookmark href="file:///home/me/Documents/Plan%20Q3.odt" added="2026-10-01T10:00:00Z" modified="2026-10-20T09:00:00Z" visited="x"/>
    <bookmark modified="2026-10-22T12:00:00Z" href="file:///home/me/notes.txt"/>
    <bookmark href="https://example.com" modified="2026-10-23T12:00:00Z"/>
  </xbel>`;
  const r = parseRecentXbel(xml);
  assert.deepEqual(r.map((x) => x.path), ['/home/me/notes.txt', '/home/me/Documents/Plan Q3.odt'], 'newest first, files only, decoded');
});

test('Wi-Fi, Bluetooth, apps and hardware lists are read from their tools', async () => {
  const { parseWifiList, parseBtDevices, parseFlatpakSearch, parseAptSearch, onlyDevices } = await import('../src/main/linux-control.js');
  const nets = parseWifiList(' :Home 5G:72:WPA2\n:Home 5G:40:WPA2\n*:Office\\:Guest:55:WPA2 WPA3\n:Cafe:90:--\n: :10:--\n');
  assert.deepEqual(nets.map((n) => n.ssid), ['Office:Guest', 'Cafe', 'Home 5G'], 'the one in use first, then by signal; escaped colons kept');
  assert.equal(nets.find((n) => n.ssid === 'Home 5G').signal, 72, 'the strongest of the same name');
  assert.equal(nets.find((n) => n.ssid === 'Cafe').secure, false);
  const bt = parseBtDevices('Device 00:1A:7D:DA:71:13 WH-1000XM4\n\u001b[0;93m[CHG]\u001b[0m Device 00:1A:7D:DA:71:13 RSSI: -60\n[NEW] Device aa:bb:cc:dd:ee:ff Keyboard K380\nController 11:22:33:44:55:66 scorpion\n');
  assert.deepEqual(bt, [{ mac: '00:1A:7D:DA:71:13', name: 'WH-1000XM4' }, { mac: 'AA:BB:CC:DD:EE:FF', name: 'Keyboard K380' }]);
  assert.deepEqual(parseFlatpakSearch('com.spotify.Client\tSpotify\tOnline music streaming service\nnot-an-app\n'), [{ source: 'flathub', id: 'com.spotify.Client', name: 'Spotify', description: 'Online music streaming service' }]);
  assert.deepEqual(parseAptSearch('gimp - GNU Image Manipulation Program\ngimp-data - Data files for GIMP\n').map((a) => a.id), ['gimp', 'gimp-data']);
  const lspci = '00:02.0 VGA compatible controller: Intel Corporation Iris Xe\n\tKernel driver in use: i915\n01:00.0 3D controller: NVIDIA GA107M\n\tKernel driver in use: nouveau\n02:00.0 Network controller: Intel Wi-Fi 6E\n\tKernel driver in use: iwlwifi';
  assert.match(onlyDevices(lspci, /VGA|3D|Display/), /i915[\s\S]*nouveau/);
  assert.doesNotMatch(onlyDevices(lspci, /VGA|3D|Display/), /iwlwifi/);
  assert.match(onlyDevices(lspci, /Network|Ethernet|Wireless/), /iwlwifi/);
});
