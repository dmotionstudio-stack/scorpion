import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWindows, parseLinux, parseMacInfo, ejectCommands, sizeText, driveLabel, createDrives, WIN_SCRIPT } from '../src/main/drives.js';

test('Windows: one drive or several, named by their label, in letter order', () => {
  const one = parseWindows('{"letter":"e","label":"Backup","size":128000000000,"free":50000000000}');
  assert.deepEqual(one, [{ id: 'E:', name: 'Backup', mount: 'E:\\', size: 128000000000, free: 50000000000 }]);
  const two = parseWindows('[{"letter":"G","label":"","size":0,"free":0},{"letter":"F","label":"Photos","size":64e9,"free":1}]');
  assert.deepEqual(two.map((d) => `${d.id} ${d.name}`), ['F: Photos', 'G: Removable drive']);
  assert.deepEqual(parseWindows(''), []);
  assert.deepEqual(parseWindows('not json'), []);
  assert.deepEqual(parseWindows('[{"letter":"C:\\\\evil"},{"label":"x"}]'), []);
  assert.match(WIN_SCRIPT, /BusType -eq 'USB'/);
  assert.match(WIN_SCRIPT, /DriveType=2/);
});

test('Linux: removable and USB disks that are mounted; the system disk and boot partitions are not', () => {
  const out = JSON.stringify({ blockdevices: [
    { name: 'nvme0n1', type: 'disk', rm: false, tran: 'nvme', hotplug: false, size: 5e11, children: [
      { name: 'nvme0n1p1', type: 'part', mountpoint: '/boot/efi', size: 5e8 }, { name: 'nvme0n1p2', type: 'part', mountpoint: '/', size: 4e11 }] },
    { name: 'sda', type: 'disk', rm: true, tran: 'usb', hotplug: true, model: 'SanDisk', size: 3e10, children: [
      { name: 'sda1', type: 'part', label: 'STICK', mountpoint: '/media/me/STICK', size: 3e10 }, { name: 'sda2', type: 'part', mountpoint: null, size: 1e6 }] },
    { name: 'sdb', type: 'disk', rm: false, tran: 'usb', hotplug: false, model: 'External HDD', size: 1e12, children: [
      { name: 'sdb1', type: 'part', label: '', mountpoint: '/media/me/data', size: 1e12 }] },
  ] });
  const d = parseLinux(out);
  assert.deepEqual(d.map((x) => [x.name, x.mount, x.dev, x.parent]), [['STICK', '/media/me/STICK', '/dev/sda1', '/dev/sda'], ['External HDD', '/media/me/data', '/dev/sdb1', '/dev/sdb']]);
  assert.deepEqual(parseLinux('garbage'), []);
  assert.deepEqual(parseLinux('{}'), []);
});

test('macOS: a volume is external when diskutil says it is not internal', () => {
  const ext = '<dict><key>Internal</key><false/><key>RemovableMedia</key><true/><key>VolumeName</key><string>CAMERA</string><key>TotalSize</key><integer>64000000000</integer><key>DeviceNode</key><string>/dev/disk4s1</string></dict>';
  assert.deepEqual(parseMacInfo(ext), { internal: false, removable: true, name: 'CAMERA', size: 64000000000, free: 0, dev: '/dev/disk4s1' });
  assert.equal(parseMacInfo('<dict><key>Internal</key><true/></dict>').internal, true);
  assert.equal(parseMacInfo('').internal, null);
});

test('eject: each system its own way, and never with a name that is not a drive', () => {
  const w = ejectCommands('win32', { id: 'E:' });
  assert.match(w[0].ps, /ParseName\('E:'\).*InvokeVerb\('Eject'\)|ParseName\('E:'\)/);
  assert.equal(ejectCommands('win32', { id: "E:'; calc" }), null);
  assert.deepEqual(ejectCommands('linux', { dev: '/dev/sda1', parent: '/dev/sda' }).map((s) => s.args.slice(0, 1)[0]), ['unmount', 'power-off']);
  assert.equal(ejectCommands('linux', { dev: '/dev/sda1; reboot' }), null);
  assert.deepEqual(ejectCommands('darwin', { mount: '/Volumes/CAMERA' })[0].args, ['eject', '/Volumes/CAMERA']);
  assert.equal(ejectCommands('freebsd', { id: 'x' }), null);
});

test('menu lines: name, letter and size', () => {
  assert.equal(sizeText(32e9), '32 GB');
  assert.equal(sizeText(256e6), '256 MB');
  assert.equal(sizeText(0), '');
  assert.equal(driveLabel({ id: 'E:', name: 'Backup', size: 128e9 }), 'Backup (E:) · 128 GB');
  assert.equal(driveLabel({ id: '/dev/sda1', name: 'STICK', size: 0 }), 'STICK');
});

test('listing and ejecting through the system, with an error said plainly', async () => {
  const calls = [];
  const win = createDrives({ platform: 'win32', ps: async (script) => { calls.push(script.slice(0, 20)); return /Eject/.test(script) ? '' : '[{"letter":"E","label":"Backup","size":1e11,"free":1}]'; } });
  assert.equal((await win.list()).length, 1);
  assert.equal((await win.eject('E:')).name, 'Backup');
  await assert.rejects(win.eject('Z:'), /not connected any more/);
  const busy = createDrives({ platform: 'linux', exec: async (f, a) => { if (f === 'lsblk') return JSON.stringify({ blockdevices: [{ name: 'sda', type: 'disk', rm: true, children: [{ name: 'sda1', type: 'part', label: 'S', mountpoint: '/media/s', size: 1e9 }] }] }); throw new Error('target is busy'); } });
  await assert.rejects(busy.eject('/dev/sda1'), /S is in use/);
  const broken = createDrives({ platform: 'win32', ps: async () => { throw new Error('boom'); } });
  assert.deepEqual(await broken.list(), [], 'a system that will not say: no drives, no error');
  assert.deepEqual(await createDrives({ platform: 'freebsd' }).list(), []);
});
