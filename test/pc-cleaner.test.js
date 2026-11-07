import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCleaner, categoryList, isAllowed, formatBytes } from '../src/main/pc-cleaner.js';

// A fake Windows profile in a temp folder: the cleaner only ever sees these places.
function fake() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleaner-test-'));
  const env = { SystemRoot: path.join(root, 'Windows'), USERPROFILE: path.join(root, 'User'), LOCALAPPDATA: path.join(root, 'User', 'AppData', 'Local'), TEMP: path.join(root, 'User', 'AppData', 'Local', 'Temp'), SystemDrive: root };
  const put = (rel, bytes = 100, ageDays = 0) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(bytes, 1));
    if (ageDays) { const t = new Date(Date.now() - ageDays * 86_400_000); fs.utimesSync(file, t, t); }
    return file;
  };
  return { root, env, put, exists: (rel) => fs.existsSync(path.join(root, rel)) };
}
const T = 'User/AppData/Local/Temp';

test('scan measures each category and deletes nothing', () => {
  const f = fake();
  f.put(`${T}/a.tmp`, 1000); f.put(`${T}/sub/b.tmp`, 500); f.put(`${T}/claude/session.json`, 9999);
  f.put('User/AppData/Local/Microsoft/Edge/User Data/Default/Cache/c1', 2000);
  f.put('User/AppData/Local/Microsoft/Windows/Explorer/thumbcache_96.db', 300);
  f.put('User/AppData/Local/Microsoft/Windows/Explorer/other.db', 700);
  const c = createCleaner({ env: f.env, admin: () => false, recycleBytes: () => 4096 });
  const { rows, total } = c.scan('');
  const size = (id) => rows.find((r) => r.id === id).bytes;
  assert.equal(size('Temp'), 1500); // not the claude folder
  assert.equal(size('BrowserCaches'), 2000);
  assert.equal(size('ThumbCaches'), 300); // only thumbcache/iconcache files
  assert.equal(size('RecycleBin'), 4096);
  assert.equal(total, 1500 + 2000 + 300); // reported-only categories are not reclaimable
  assert.ok(f.exists(`${T}/a.tmp`) && f.exists(`${T}/claude/session.json`));
});

test('clean takes only what was chosen, and never the claude folders', () => {
  const f = fake();
  f.put(`${T}/a.tmp`, 1000); f.put(`${T}/sub/b.tmp`, 500);
  f.put(`${T}/claude/session.json`, 9999); f.put(`${T}/Claude-1234/x`, 10); f.put(`${T}/claudesomething.txt`, 10);
  f.put('User/AppData/Local/Microsoft/Edge/User Data/Default/Cache/c1', 2000);
  f.put('User/AppData/Local/Microsoft/Windows/Explorer/thumbcache_96.db', 300);
  f.put('User/AppData/Local/Microsoft/Windows/Explorer/other.db', 700);
  const logDir = path.join(f.root, 'logs');
  const c = createCleaner({ env: f.env, admin: () => false, logDir, freeBytes: () => 1e9 });
  const r = c.clean('Temp, ThumbCaches');
  assert.equal(r.freed, 1500 + 300);
  assert.ok(!f.exists(`${T}/a.tmp`) && !f.exists(`${T}/sub`));
  assert.ok(f.exists(`${T}/claude/session.json`) && f.exists(`${T}/Claude-1234/x`) && f.exists(`${T}/claudesomething.txt`));
  assert.ok(f.exists('User/AppData/Local/Microsoft/Windows/Explorer/other.db')); // not a thumbnail cache
  assert.ok(f.exists('User/AppData/Local/Microsoft/Edge/User Data/Default/Cache/c1')); // not chosen
  assert.ok(r.log && fs.readFileSync(r.log, 'utf8').includes('Temp: cleaned'));
});

test('administrator categories are skipped without rights, run with them', () => {
  const f = fake();
  f.put('Windows/Temp/old.tmp', 800); f.put('Windows/Prefetch/APP.pf', 200);
  let r = createCleaner({ env: f.env, admin: () => false }).clean('WinTemp,Prefetch');
  assert.equal(r.freed, 0);
  assert.ok(r.rows.every((x) => /needs administrator/.test(x.status)));
  assert.ok(f.exists('Windows/Temp/old.tmp'));
  r = createCleaner({ env: f.env, admin: () => true }).clean('WinTemp,Prefetch');
  assert.equal(r.freed, 1000);
  assert.ok(!f.exists('Windows/Temp/old.tmp'));
});

test('component logs: only those older than a week', () => {
  const f = fake();
  f.put('Windows/Logs/CBS/new.log', 100, 1); f.put('Windows/Logs/CBS/old.log', 300, 30);
  const r = createCleaner({ env: f.env, admin: () => true }).clean('CbsLogs');
  assert.equal(r.freed, 300);
  assert.ok(f.exists('Windows/Logs/CBS/new.log') && !f.exists('Windows/Logs/CBS/old.log'));
});

test('the Recycle Bin and old installers are reported, never deleted', () => {
  const f = fake();
  const old = f.put('User/Downloads/setup-old.exe', 5000, 90);
  f.put('User/Downloads/new.exe', 100, 2); f.put('User/Downloads/notes.txt', 100, 90);
  const c = createCleaner({ env: f.env, admin: () => true, recycleBytes: () => 123 });
  assert.equal(c.scan('StaleInstallers').rows[0].bytes, 5000);
  assert.deepEqual(c.staleInstallers().map((x) => x.path), [old]);
  const r = c.clean('StaleInstallers,RecycleBin');
  assert.equal(r.freed, 0);
  assert.ok(r.rows.every((x) => /never deleted/.test(x.status)));
  assert.ok(fs.existsSync(old));
  // "all" and "safe" never include them
  assert.deepEqual(c.pick('all').map((x) => x.id).filter((id) => /RecycleBin|StaleInstallers/.test(id)), []);
  assert.deepEqual(c.pick('safe').map((x) => x.id), ['Temp', 'CrashDumps', 'PackageCaches', 'BrowserCaches', 'ThumbCaches']);
});

test('the allowlist: places outside it, and claude folders, are refused', () => {
  const f = fake();
  const cats = categoryList(f.env);
  assert.equal(isAllowed(path.join(f.root, T, 'x.tmp'), cats), true);
  assert.equal(isAllowed(path.join(f.root, 'Windows', 'Temp', 'x'), cats), true);
  assert.equal(isAllowed(path.join(f.root, 'User', 'Documents', 'thesis.docx'), cats), false);
  assert.equal(isAllowed(path.join(f.root, 'User', 'Downloads', 'a.exe'), cats), false); // reported only
  assert.equal(isAllowed(path.join(f.root, T, 'claude', 'x'), cats), false);
  assert.equal(isAllowed(path.join(f.root, T, '..', '..', 'Roaming', 'x'), cats), false); // .. does not escape
});

test('a blank clean request deletes nothing, not everything', () => {
  const f = fake();
  f.put(`${T}/a.tmp`, 1000); f.put('User/AppData/Local/Microsoft/Edge/User Data/Default/Cache/c1', 2000);
  const c = createCleaner({ env: f.env, admin: () => false });
  for (const blank of ['', '   ', undefined, null]) assert.throws(() => c.clean(blank), /Say which categories/);
  assert.ok(f.exists(`${T}/a.tmp`) && f.exists('User/AppData/Local/Microsoft/Edge/User Data/Default/Cache/c1'));
  assert.equal(c.scan('').rows.length, 11); // scanning with none named still looks at every category
});

test('unknown categories and empty requests are errors; names are forgiving', () => {
  const c = createCleaner({ env: fake().env, admin: () => false });
  assert.throws(() => c.clean('Documents'), /isn't a cleaner category/);
  assert.throws(() => c.clean('  ,  '), /Say which categories/);
  assert.deepEqual(c.pick('temp, browsercaches').map((x) => x.id), ['Temp', 'BrowserCaches']);
});

test('sizes read as people say them', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(5 * 1048576), '5.0 MB');
  assert.equal(formatBytes(1.5 * 1073741824), '1.5 GB');
});
