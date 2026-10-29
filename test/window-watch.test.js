import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowChanges, shouldFill, keyOf } from '../src/main/window-watch.js';

const w = (hwnd, exe, more = {}) => ({ hwnd, exe, title: `${exe} ${hwnd}`, ...more });

test('the first look finds nothing new', () => {
  assert.deepEqual(windowChanges(null, [w('1', 'notepad.exe')]), { opened: [], minimized: [] });
});

test('a new window of an app is opened; a minimized one is noticed once', () => {
  const a = [w('1', 'notepad.exe')];
  const b = [w('1', 'notepad.exe'), w('2', 'chrome.exe')];
  assert.deepEqual(windowChanges(a, b).opened.map(keyOf), ['2']);
  const c = [w('1', 'notepad.exe', { minimized: true }), w('2', 'chrome.exe')];
  assert.deepEqual(windowChanges(b, c).minimized.map(keyOf), ['1']);
  assert.deepEqual(windowChanges(c, c).minimized, []); // still minimized: not again
});

test('a window whose title changed (Linux, no identifiers) is not a new one', () => {
  const a = [{ hwnd: 'firefox|Inbox', appId: 'firefox' }];
  const b = [{ hwnd: 'firefox|News', appId: 'firefox' }];
  assert.deepEqual(windowChanges(a, b).opened, []);
  // With identifiers, the same window keeps its key.
  const c = [{ hwnd: 'x', key: '7', appId: 'firefox' }];
  const d = [{ hwnd: 'y', key: '7', appId: 'firefox', minimized: true }];
  assert.deepEqual(windowChanges(c, d).minimized.map(keyOf), ['7']);
});

test("only an app's only window fills the screen", () => {
  const one = w('2', 'chrome.exe');
  assert.equal(shouldFill(one, [w('1', 'notepad.exe'), one]), true);
  const dialog = w('3', 'notepad.exe');
  assert.equal(shouldFill(dialog, [w('1', 'notepad.exe'), dialog]), false);
  assert.equal(shouldFill(w('9', 'scorpion.exe', { self: true }), []), false);
});
