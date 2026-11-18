import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveRequest, serveFolder, urlFor, typeOf, stopAll } from '../src/main/site-server.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-site-'));
fs.mkdirSync(path.join(root, 'sub'));
fs.writeFileSync(path.join(root, 'index.html'), '<h1>Home</h1>');
fs.writeFileSync(path.join(root, 'sub', 'index.html'), '<h1>Sub</h1>');
fs.writeFileSync(path.join(root, 'style.css'), 'h1{color:red}');
fs.writeFileSync(path.join(path.dirname(root), 'secret.txt'), 'outside');

test('requests resolve inside the folder only', () => {
  assert.equal(resolveRequest(root, '/'), path.join(root, 'index.html'));
  assert.equal(resolveRequest(root, '/sub/'), path.join(root, 'sub', 'index.html'));
  assert.equal(resolveRequest(root, '/style.css?v=2'), path.join(root, 'style.css'));
  for (const bad of ['/../secret.txt', '/..%2fsecret.txt', '/sub/../../secret.txt', '/%00', '/missing.html', '/..\\secret.txt']) assert.equal(resolveRequest(root, bad), null, bad);
  assert.match(typeOf('a.css'), /text\/css/);
  assert.match(typeOf('a.js'), /javascript/);
});

test('the folder is served on localhost, always with the newest file', async () => {
  const url = await urlFor(root, path.join(root, 'index.html'));
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/index\.html$/);
  let r = await fetch(url);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '<h1>Home</h1>');
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>Changed</h1>');
  assert.equal(await (await fetch(url)).text(), '<h1>Changed</h1>');
  assert.equal((await fetch(url.replace('index.html', '..%2fsecret.txt'))).status, 404);
  assert.equal((await fetch(url.replace('index.html', 'nope.html'))).status, 404);
  assert.equal((await serveFolder(root)).port, (await serveFolder(root)).port, 'one server per folder');
  await stopAll();
});
