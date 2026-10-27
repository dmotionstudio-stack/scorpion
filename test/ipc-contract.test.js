import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The list of messages between Scorpion's screens and its main process is
// preload.cjs: every call there must have a handler in the main process, and
// every event a page listens for must be sent from it. A renamed or removed
// message fails here instead of failing quietly in the app.
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const preload = read('src/preload.cjs');
const mainFiles = ['src/main/main.js', 'src/main/shell.js', 'src/main/shell-api.js', 'src/main/updates.js'].map(read).join('\n');

const calls = [...preload.matchAll(/\binvoke\('([^']+)'\)/g)].map((m) => m[1]);
const events = [...preload.matchAll(/\bon\('([^']+)'\)/g)].map((m) => m[1]);
const handled = new Set([...mainFiles.matchAll(/\b(?:h|ipcMain\.handle)\('([^']+)'/g), ...mainFiles.matchAll(/handlers\['([^']+)'\]\s*=/g)].map((m) => m[1]));
const sent = new Set([...mainFiles.matchAll(/\b(?:send|webContents\.send|sender\.send|shellEvent)\('([^']+)'/g)].map((m) => m[1]));

test('every call the screens make has a handler', () => {
  assert.ok(calls.length > 50, 'found the calls');
  const missing = calls.filter((c) => !handled.has(c));
  assert.deepEqual(missing, [], `calls with no handler in the main process: ${missing.join(', ')}`);
});

test('every event the screens listen for is sent', () => {
  assert.ok(events.length > 5, 'found the events');
  const never = events.filter((e) => !sent.has(e));
  assert.deepEqual(never, [], `events never sent by the main process: ${never.join(', ')}`);
});

test('no call is listed twice', () => {
  const seen = new Set();
  const twice = calls.filter((c) => (seen.has(c) ? true : (seen.add(c), false)));
  // The same channel under two names is fine only when both are meant (none today).
  assert.deepEqual(twice, []);
});
