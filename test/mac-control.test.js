import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scanApps, parseWindows, fromHandle, parseBattery, parseVolume, permissionHint, isRunnable, SETTINGS_PAGES, openSettings, matchByName } from '../src/main/mac-control.js';

// A folder tree for scanApps: { dir: [entries] }, an entry ending in .app or a name, folders marked with a trailing /.
const fakeFs = (tree) => ({
  readdirSync(dir) {
    const list = tree[dir.split(path.sep).join('/')];
    if (!list) throw new Error('ENOENT');
    return list.map((n) => ({ name: n.replace(/\/$/, ''), isDirectory: () => n.endsWith('/') || n.endsWith('.app') }));
  },
});

test('the apps of a Mac: bundles in the app folders and one folder down', () => {
  const apps = scanApps(['/Applications', '/System/Applications'], fakeFs({
    '/Applications': ['Safari.app', 'Utilities/', '.hidden.app', 'readme.txt', 'Google Chrome.app'],
    '/Applications/Utilities': ['Terminal.app'],
    '/System/Applications': ['Calculator.app', 'Safari.app'],
  }));
  assert.deepEqual(apps.map((a) => a.name), ['Calculator', 'Google Chrome', 'Safari', 'Terminal']);
  assert.equal(apps.find((a) => a.name === 'Safari').id, path.join('/Applications', 'Safari.app'), 'the first folder wins a duplicate');
  assert.equal(matchByName('chrome', apps).best.name, 'Google Chrome');
});

test('windows come back as rows of pid, app, frontmost, minimized, number and title', () => {
  const out = '501\tSafari\ttrue\tfalse\t1\tApple\n501\tSafari\ttrue\ttrue\t2\tNews\n610\tNotes\tfalse\tfalse\t1\t\n';
  const wins = parseWindows(out);
  assert.equal(wins.length, 3);
  assert.deepEqual({ ...wins[0] }, { hwnd: '501:1', pid: 501, process: 'Safari', title: 'Apple', active: true, minimized: false, exe: null });
  assert.equal(wins[1].active, false, 'only the front window of the front app is active');
  assert.equal(wins[1].minimized, true);
  assert.equal(wins[2].title, 'Notes', 'a window without a title shows its app name');
  assert.deepEqual(parseWindows(''), []);
});

test('a window handle is the pid and the window number', () => {
  assert.deepEqual(fromHandle('501:2'), { pid: 501, index: 2 });
  assert.equal(fromHandle('501'), null);
  assert.equal(fromHandle("1:1'; do shell script"), null);
});

test('battery and volume readings', () => {
  assert.deepEqual(parseBattery(" -InternalBattery-0 (id=1)\t82%; discharging; 5:10 remaining present: true"), { percent: 82, charging: false });
  assert.deepEqual(parseBattery('\t100%; charged; 0:00 remaining'), { percent: 100, charging: true });
  assert.equal(parseBattery('Now drawing from AC Power'), null);
  assert.equal(parseVolume('48\n'), 48);
  assert.equal(parseVolume('missing value'), null);
});

test('when macOS refuses, the answer says what to turn on', () => {
  assert.match(permissionHint('execution error: System Events got an error: osascript is not allowed assistive access. (-25211)'), /Accessibility/);
  assert.match(permissionHint('Not authorized to send Apple events to System Events. (-1743)'), /Automation/);
  assert.equal(permissionHint('some other error'), null);
});

test('programs that run when opened ask first; settings panes resolve by name', () => {
  assert.equal(isRunnable('/Users/a/tool.command'), true);
  assert.equal(isRunnable('/Applications/Safari.app'), true);
  assert.equal(isRunnable('/Users/a/photo.png'), false);
  assert.ok(SETTINGS_PAGES.display && SETTINGS_PAGES.sound && SETTINGS_PAGES.privacy);
  assert.throws(() => openSettings('nonsense page'), /Unknown Settings page/);
});
