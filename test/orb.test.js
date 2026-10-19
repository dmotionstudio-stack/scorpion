import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const vendored = path.join('src', 'vendor', 'three-addons');
const upstream = path.join('node_modules', 'three', 'examples', 'jsm');

test('vendored Three.js add-ons match the installed three version', () => {
  const files = fs.readdirSync(vendored, { recursive: true }).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 9);
  for (const f of files) {
    assert.equal(fs.readFileSync(path.join(vendored, f), 'utf8'), fs.readFileSync(path.join(upstream, f), 'utf8'), `${f} differs: copy it again from ${upstream}`);
  }
});

test('every add-on the orb imports is vendored', () => {
  const orb = fs.readFileSync(path.join('src', 'renderer', 'orb.js'), 'utf8');
  const wanted = [...orb.matchAll(/from 'three\/addons\/([^']+)'/g)].map((m) => m[1]);
  assert.ok(wanted.length >= 5);
  for (const w of wanted) assert.ok(fs.existsSync(path.join(vendored, w)), `${w} is not vendored`);
});

test('the import map in index.html is allowed by its CSP hash', async () => {
  const { createHash } = await import('node:crypto');
  const html = fs.readFileSync(path.join('src', 'renderer', 'index.html'), 'utf8');
  const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1];
  const hash = createHash('sha256').update(map).digest('base64');
  assert.ok(html.includes(`'sha256-${hash}'`), 'update the sha256 in the Content-Security-Policy after editing the import map');
});
