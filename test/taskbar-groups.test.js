import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTaskbar, cleanGroups, setGroup, groupOf, freeGroupNames, appName, GROUP_NAMES } from '../src/renderer/taskbar-core.js';

const pinned = [
  { id: 'C:\\Office\\WINWORD.EXE', name: 'Word' },
  { id: 'C:\\Games\\steam.exe', name: 'Steam' },
  { id: 'C:\\Office\\EXCEL.EXE', name: 'Excel' },
  { id: 'Microsoft.WindowsCalculator', name: 'Calculator' },
];
const win = (hwnd, exe, extra = {}) => ({ hwnd: String(hwnd), exe, title: `Window ${hwnd}`, process: exe.split('\\').pop().replace(/\.exe$/i, ''), ...extra });

test('pinned apps in a group share one icon, where the first of them was', () => {
  const groups = [{ id: 'work', name: 'Work', apps: ['C:\\Office\\EXCEL.EXE', 'c:\\office\\winword.exe'] }];
  const { pins } = layoutTaskbar({ pinned, groups, windows: [win(1, 'c:\\office\\excel.exe', { active: true })] });
  assert.deepEqual(pins.map((p) => p.kind === 'group' ? `group:${p.name}` : p.app.name), ['group:Work', 'Steam', 'Calculator']);
  const g = pins[0];
  assert.deepEqual(g.apps.map((a) => a.name), ['Excel', 'Word']); // the group's own order
  assert.equal(g.running, true);
  assert.equal(g.active, true);
  assert.deepEqual(g.apps[0].windows.map((w) => w.hwnd), ['1']);
  assert.equal(pins[1].running, false);
});

test("an app's open windows go under one icon; a single window stays a window", () => {
  const windows = [win(1, 'C:\\Chrome\\chrome.exe'), win(2, 'C:\\Win\\explorer.exe'), win(3, 'C:\\Chrome\\chrome.exe', { active: true }), win(4, 'C:\\Chrome\\chrome.exe'), win(5, 'C:\\Games\\steam.exe')];
  const { pins, wins } = layoutTaskbar({ pinned, windows });
  assert.deepEqual(wins.map((w) => w.kind), ['windows', 'window']);
  assert.equal(wins[0].name, 'Chrome');
  assert.deepEqual(wins[0].windows.map((w) => w.hwnd), ['1', '3', '4']);
  assert.equal(wins[0].active, true);
  assert.equal(wins[1].w.hwnd, '2');
  // A pinned app's windows stay with its pin.
  assert.deepEqual(pins.find((p) => p.app?.name === 'Steam').windows.map((w) => w.hwnd), ['5']);
  // Turned off: one icon a window.
  assert.deepEqual(layoutTaskbar({ pinned, windows, combine: false }).wins.map((w) => w.w.hwnd), ['1', '2', '3', '4']);
});

test('windows nobody can name are never combined; Scorpion OS windows combine by their app', () => {
  const windows = [{ hwnd: 'a', title: 'One' }, { hwnd: 'b', title: 'Two' }, { hwnd: 'c', appId: 'org.gnome.Nautilus', title: 'Home' }, { hwnd: 'd', appId: 'org.gnome.Nautilus', title: 'Music' }];
  const { wins } = layoutTaskbar({ windows });
  assert.deepEqual(wins.map((w) => w.kind), ['window', 'window', 'windows']);
  assert.equal(wins[2].windows.length, 2);
  assert.equal(appName({ exe: 'C:\\x\\firefox.exe' }), 'Firefox');
});

test('putting an app in a group, moving it, and taking it out', () => {
  let groups = setGroup([], pinned[0].id, 'Work');
  assert.deepEqual(groups, [{ id: 'work', name: 'Work', apps: [pinned[0].id] }]);
  groups = setGroup(groups, pinned[2].id, 'work'); // the same group, however it's spelled
  assert.deepEqual(groups[0].apps, [pinned[0].id, pinned[2].id]);
  groups = setGroup(groups, pinned[0].id, 'Games'); // moved: in one group only
  assert.deepEqual(groups.map((g) => [g.name, g.apps.length]), [['Work', 1], ['Games', 1]]);
  assert.equal(groupOf(groups, pinned[0].id.toLowerCase()).name, 'Games');
  groups = setGroup(groups, pinned[0].id, null); // out: an empty group goes
  assert.deepEqual(groups.map((g) => g.name), ['Work']);
  assert.equal(groupOf(groups, pinned[0].id), null);
  assert.ok(!freeGroupNames(groups).includes('Work'));
  assert.equal(freeGroupNames(groups).length, GROUP_NAMES.length - 1);
});

test('groups are kept tidy: only apps still pinned, each in one group, no empty or repeated groups', () => {
  const groups = [
    { id: 'work', name: 'Work', apps: [pinned[0].id, 'C:\\gone.exe'] },
    { id: 'work2', name: 'work', apps: [pinned[1].id] }, // the same name again
    { id: 'games', name: 'Games', apps: [pinned[0].id, pinned[1].id] }, // Word is already in Work
    { id: 'empty', name: 'Empty', apps: ['C:\\gone.exe'] },
    { name: '   ', apps: [pinned[3].id] },
  ];
  assert.deepEqual(cleanGroups(groups, pinned), [{ id: 'work', name: 'Work', apps: [pinned[0].id] }, { id: 'games', name: 'Games', apps: [pinned[1].id] }]);
  assert.deepEqual(cleanGroups(null, pinned), []);
  assert.deepEqual(layoutTaskbar({ pinned, groups: 'nonsense' }).pins.length, 4);
});
