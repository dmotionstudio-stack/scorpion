import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { checkUrl, safeName, nameFor, freeName, downloadFile, fetchJson, humanSize } from '../src/main/fetcher.js';

const body = (...chunks) => ({ async *[Symbol.asyncIterator]() { for (const c of chunks) yield Buffer.from(c); } });
const reply = (chunks, { status = 200, headers = {}, url = 'https://example.com/files/tool.zip' } = {}) => async () => ({
  ok: status < 400, status, statusText: '', url, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, body: body(...chunks), text: async () => chunks.join(''),
});

test('only web addresses are downloaded', () => {
  assert.equal(checkUrl('https://example.com/a.zip').hostname, 'example.com');
  for (const bad of ['file:///C:/Windows/system.ini', 'javascript:alert(1)', 'ftp://x/y', 'not a url', '']) assert.throws(() => checkUrl(bad));
});

test('file names are made safe and free', () => {
  assert.equal(safeName('..\\..\\Windows\\evil.exe'), 'evil.exe');
  assert.equal(safeName('a<b>c:d.txt'), 'a_b_c_d.txt');
  assert.equal(safeName('...'), 'download');
  assert.equal(safeName('%E2%9C%93 ok.txt'), '✓ ok.txt');
  assert.equal(nameFor(new URL('https://x.com/dir/model.gguf?token=1'), null), 'model.gguf');
  assert.equal(nameFor(new URL('https://x.com/get'), 'attachment; filename="setup 1.2.exe"'), 'setup 1.2.exe');
  assert.equal(freeName('/d', 'a.zip', (p) => p === path.join('/d', 'a.zip')), 'a (2).zip');
});

test('a download is written whole, with its size and checksum, never over a file that is there', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-dl-'));
  try {
    const seen = [];
    const r = await downloadFile('https://example.com/files/tool.zip', dir, { fetchImpl: reply(['hello ', 'world'], { headers: { 'content-length': '11' } }), onProgress: (p) => seen.push(p.done) });
    assert.equal(path.basename(r.path), 'tool.zip');
    assert.equal(fs.readFileSync(r.path, 'utf8'), 'hello world');
    assert.equal(r.bytes, 11);
    assert.equal(r.sha256, crypto.createHash('sha256').update('hello world').digest('hex'));
    assert.deepEqual(seen, [6, 11]);
    const again = await downloadFile('https://example.com/files/tool.zip', dir, { fetchImpl: reply(['second']) });
    assert.equal(path.basename(again.path), 'tool (2).zip');
    assert.equal(fs.readFileSync(r.path, 'utf8'), 'hello world', 'the first file is untouched');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['tool (2).zip', 'tool.zip']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a download that fails or is cut short leaves nothing behind', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-dl-'));
  try {
    await assert.rejects(downloadFile('https://example.com/x.bin', dir, { fetchImpl: reply([], { status: 404 }) }), /404/);
    await assert.rejects(downloadFile('https://example.com/x.bin', dir, { fetchImpl: reply(['abc'], { headers: { 'content-length': '10' } }) }), /stopped at 3 of 10/);
    await assert.rejects(downloadFile('https://example.com/x.bin', dir, { fetchImpl: reply(['abcdef'], { headers: { 'content-length': '6' } }), maxBytes: 4 }), /over the limit/);
    await assert.rejects(downloadFile('file:///etc/passwd', dir), /Only http/);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an agent definition is read as JSON, small and from the web only', async () => {
  assert.deepEqual(await fetchJson('https://example.com/a.json', { fetchImpl: reply(['{"name":"Tax helper"}']) }), { name: 'Tax helper' });
  await assert.rejects(fetchJson('https://example.com/a.json', { fetchImpl: reply(['<html>']) }), /not a JSON/);
  await assert.rejects(fetchJson('https://example.com/a.json', { fetchImpl: reply(['x'.repeat(300_000)]) }), /too big/);
  await assert.rejects(fetchJson('file:///x.json'), /Only http/);
  assert.equal(humanSize(5_627_045_536), '5.6 GB');
});
