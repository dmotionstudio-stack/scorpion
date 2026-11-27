import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desktopSwitchItem } from '../src/main/power-menu.js';

test('the power menu names the desktop switch for the system it is on', () => {
  assert.deepEqual(desktopSwitchItem('win32', 'shell'), { label: 'Switch to the Windows desktop', action: 'explorer' });
  assert.deepEqual(desktopSwitchItem('win32', null), { label: 'Switch to the Windows desktop', action: 'explorer' });
  assert.deepEqual(desktopSwitchItem('win32', 'bar'), { label: 'Back to the Windows taskbar', action: 'taskbar-off' });
  assert.deepEqual(desktopSwitchItem('darwin', null), { label: 'Switch to the Mac desktop', action: 'hide' });
  assert.deepEqual(desktopSwitchItem('darwin', 'shell'), { label: 'Switch to the Mac desktop', action: 'hide' });
  assert.deepEqual(desktopSwitchItem('linux', 'bar'), { label: 'Back to the Linux taskbar', action: 'taskbar-off' });
});

test('Scorpion OS has no other desktop to switch to, and nothing Windows-like shows on a Mac or Linux', () => {
  assert.equal(desktopSwitchItem('linux', 'shell'), null);
  assert.equal(desktopSwitchItem('linux', null), null);
  assert.equal(desktopSwitchItem('freebsd', null), null);
  for (const p of ['darwin', 'linux']) for (const m of ['shell', 'bar', null]) assert.ok(!/windows/i.test(desktopSwitchItem(p, m)?.label || ''), `${p}/${m}`);
});
