import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rootItems, listFolder } from '../src/main/files-list.js';
import { getSettings, initStore } from '../src/main/store.js';

test('Mac: your folders, the startup disk, then what is mounted (never the startup disk twice)', () => {
  const have = new Set(['/Users/sam/Desktop', '/Users/sam/Documents', '/Users/sam/Movies']);
  const items = rootItems({
    platform: 'darwin',
    home: '/Users/sam',
    io: {
      exists: (p) => have.has(p.replaceAll('\\', '/')),
      readdir: () => ['Macintosh HD', 'USB STICK', '.timemachine', 'Backups'],
      realpath: (p) => ({ '/Volumes/Macintosh HD': '/', '/Volumes/USB STICK': '/Volumes/USB STICK', '/Volumes/Backups': '/Volumes/Backups' })[p],
    },
  });
  assert.deepEqual(items.map((i) => i.name), ['Desktop', 'Documents', 'Movies', 'Macintosh HD', 'USB STICK', 'Backups']);
  assert.equal(items.find((i) => i.name === 'Macintosh HD').path, '/');
  assert.equal(items.find((i) => i.name === 'USB STICK').path, '/Volumes/USB STICK');
  assert.ok(items.every((i) => i.dir));
});

test('Mac: a share that went away, or no /Volumes at all, does not break the list', () => {
  const gone = rootItems({ platform: 'darwin', home: '/Users/sam', io: { exists: () => false, readdir: () => ['Share'], realpath: () => { throw new Error('ENOENT'); } } });
  assert.deepEqual(gone.map((i) => i.name), ['Macintosh HD']);
  const none = rootItems({ platform: 'darwin', home: '/Users/sam', io: { exists: () => false, readdir: () => { throw new Error('ENOENT'); } } });
  assert.deepEqual(none.map((i) => i.name), ['Macintosh HD']);
});

test('Windows: your folders, then every drive letter that exists', () => {
  const items = rootItems({ platform: 'win32', home: 'C:\\Users\\sam', io: { exists: (p) => /^(C:\\|D:\\|C:\\Users\\sam\\(Desktop|Videos))$/.test(p) } });
  assert.deepEqual(items.map((i) => i.name), ['Desktop', 'Videos', 'C:\\', 'D:\\']);
});

test('a folder lists folders first, and its top is the top of the computer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-list-'));
  fs.mkdirSync(path.join(dir, 'b-folder'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
  fs.writeFileSync(path.join(dir, '.hidden'), 'x');
  const r = listFolder(dir);
  assert.deepEqual(r.items.map((i) => [i.name, i.dir, i.hidden]), [['b-folder', true, false], ['.hidden', false, true], ['a.txt', false, false]]);
  assert.equal(r.parent, path.dirname(dir));
  assert.equal(listFolder(path.parse(dir).root).parent, ''); // the top of a drive goes back to the top level
  assert.equal(listFolder(null).dir, null);
});

test('full file access is the default on Windows and macOS, asking on Scorpion OS', () => {
  initStore(fs.mkdtempSync(path.join(os.tmpdir(), 'files-default-')));
  const want = process.platform === 'win32' || process.platform === 'darwin' ? 'full' : 'ask';
  assert.equal(getSettings().fileAccess, want);
});
