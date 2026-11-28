import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Scorpion OS runs Windows programs (.exe, .msi) with Wine. The image is built in the cloud (a few hours), so what can be checked here is checked here:
// the package list, the launcher, the file association and the build step that installs them.
const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const packages = (p) => read(p).split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);

test('the Windows support packages are listed: Wine in 64 and 32 bits, winetricks, and what 32-bit programs need', () => {
  const list = packages('os/config/packages-windows.list');
  for (const p of ['wine', 'wine64', 'libwine', 'wine32:i386', 'libwine:i386', 'winetricks', 'cabextract', 'fonts-wine']) assert.ok(list.includes(p), p);
  assert.equal(new Set(list).size, list.length, 'no package twice');
  for (const p of list) assert.match(p, /^[a-z0-9][a-z0-9+.-]*(:i386)?$/, p);
});

test('the image build turns on 32-bit packages, installs the list one by one, and checks Wine is there', () => {
  const build = read('os/build-iso.sh');
  assert.match(build, /dpkg --add-architecture i386/);
  assert.match(build, /packages-windows\.list/);
  assert.match(build, /\(Windows support package \$p skipped\)/); // a missing one never stops the build
  assert.match(build, /command -v wine/);
  assert.match(build, /usr\/bin\/scorpion-windows/); // made executable
  assert.ok(build.indexOf('--add-architecture i386') < build.indexOf('packages-windows.list'), 'i386 comes first');
  assert.match(build, /Architectures: amd64/); // Mozilla's repository has no 32-bit packages
});

test('an .exe or .msi opens with Wine: the desktop entry, and the default for each kind of file', () => {
  const desktop = read('os/rootfs/usr/share/applications/scorpion-windows.desktop');
  assert.match(desktop, /^Exec=scorpion-windows %f$/m);
  const types = /^MimeType=(.*)$/m.exec(desktop)[1].split(';').filter(Boolean);
  for (const t of ['application/x-ms-dos-executable', 'application/vnd.microsoft.portable-executable', 'application/x-msi']) assert.ok(types.includes(t), t);
  const defaults = Object.fromEntries(read('os/rootfs/etc/xdg/mimeapps.list').split('\n').filter((l) => /^[a-z].*=/.test(l)).map((l) => l.split('=')));
  for (const t of ['application/x-ms-dos-executable', 'application/vnd.microsoft.portable-executable', 'application/x-msi']) assert.equal(defaults[t], 'scorpion-windows.desktop', t);
  assert.ok(fs.existsSync(path.join(root, 'os/rootfs/usr/share/applications', defaults['application/x-msi'])));
});

test('the launcher is valid shell, explains itself, and says plainly when Wine is missing or the file is', () => {
  const script = path.join(root, 'os/rootfs/usr/bin/scorpion-windows');
  const text = read('os/rootfs/usr/bin/scorpion-windows');
  assert.ok(text.startsWith('#!/bin/bash\n'));
  assert.ok(!text.includes('\r'), 'no Windows line endings in a Linux script');
  // bash on this machine's path (a real file, whichever system this runs on); none: the checks above stand.
  const bashPath = (process.env.PATH || '').split(path.delimiter).flatMap((d) => ['bash.exe', 'bash'].map((n) => path.join(d, n))).find((p) => fs.existsSync(p));
  if (!bashPath) return;
  assert.equal(spawnSync(bashPath, ['-n', script]).status, 0, 'valid syntax');
  const help = spawnSync(bashPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /scorpion-windows --add vcrun2022/);
  assert.match(help.stdout, /--reset/);
  // With nothing on the path (so no Wine) it says so and exits 127.
  const noWine = spawnSync(bashPath, [script, '/no/such/setup.exe'], { encoding: 'utf8', env: { PATH: '', HOME: root } });
  assert.equal(noWine.status, 127, `exit ${noWine.status}`);
  assert.match(noWine.stderr, /not installed/i);
});

test('Scorpion knows it can run Windows programs on Scorpion OS, and asks first before running an installer', async () => {
  const agent = read('src/main/agent.js');
  assert.match(agent, /Windows programs run here too, through Wine/);
  assert.match(agent, /scorpion-windows --add vcrun2022/);
  const lin = await import('../src/main/linux-control.js');
  assert.equal(lin.isRunnable('/home/me/Downloads/setup.exe'), true); // open_path asks before running it
  assert.equal(lin.isRunnable('/home/me/Downloads/installer.MSI'), true);
  assert.equal(lin.isRunnable('/home/me/Pictures/cat.png'), false);
});
