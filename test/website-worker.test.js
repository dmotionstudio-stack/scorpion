import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../website/worker.js';

const SESSION = 'cs_test_abcdefghij1234567890';
const asked = [];

// A bucket with one file in it, the way R2's binding answers (a whole file, or a range of it).
const bucket = {
  async get(key, opts) {
    asked.push(key);
    if (key !== '0.1.55/Scorpion Setup 0.1.55.exe') return null;
    const data = new TextEncoder().encode('0123456789');
    const range = /bytes=(\d+)-(\d+)/.exec(opts?.range?.get?.('range') || '');
    if (range) {
      const offset = Number(range[1]), length = Number(range[2]) - offset + 1;
      return { body: new Blob([data.slice(offset, offset + length)]).stream(), size: data.length, range: { offset, length }, httpEtag: '"x"', writeHttpMetadata() {} };
    }
    return { body: new Blob([data]).stream(), size: data.length, httpEtag: '"x"', writeHttpMetadata() {} };
  },
};

function withStripe(session, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(session), { status: 200, headers: { 'Content-Type': 'application/json' } });
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.DOWNLOAD_BASE_URL = 'r2://scorpion-downloads';
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = real; });
}
const paid = { payment_status: 'paid', metadata: { edition: 'standard', platform: 'win', version: '0.1.55' } };
const get = (path, headers) => worker.fetch(new Request(`https://site.test${path}`, { headers }), { DOWNLOADS: bucket });

test('only /api/* reaches the Worker; pages are left to Cloudflare', async () => {
  let served = null;
  const res = await worker.fetch(new Request('https://site.test/download.html'), { ASSETS: { fetch: async (r) => { served = new URL(r.url).pathname; return new Response('page'); } } });
  assert.equal(served, '/download.html');
  assert.equal(await res.text(), 'page');
  assert.equal((await worker.fetch(new Request('https://site.test/api/nothing'), {})).status, 404);
  assert.equal((await worker.fetch(new Request('https://site.test/api/checkout', { method: 'DELETE' }), {})).status, 405);
});

test('a paid order downloads from the private bucket, with resume', async () => {
  await withStripe(paid, async () => {
    const res = await get(`/api/download?session_id=${SESSION}&file=win`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '0123456789');
    assert.match(res.headers.get('Content-Disposition'), /attachment; filename\*=UTF-8''Scorpion%20Setup%200\.1\.55\.exe/);
    assert.equal(res.headers.get('Content-Length'), '10');
    assert.equal(asked.at(-1), '0.1.55/Scorpion Setup 0.1.55.exe');
    const part = await get(`/api/download?session_id=${SESSION}&file=win`, { Range: 'bytes=2-5' });
    assert.equal(part.status, 206);
    assert.equal(await part.text(), '2345');
    assert.equal(part.headers.get('Content-Range'), 'bytes 2-5/10');
  });
});

test('nothing downloads without paying, for a file that is not in the order, or that is not uploaded yet', async () => {
  await withStripe({ ...paid, payment_status: 'unpaid' }, async () => {
    assert.equal((await get(`/api/download?session_id=${SESSION}&file=win`)).status, 402);
  });
  await withStripe(paid, async () => {
    assert.equal((await get(`/api/download?session_id=${SESSION}&file=os`)).status, 403, 'Standard is one platform and no OS');
    assert.equal((await get('/api/download?session_id=nope&file=win')).status, 400);
    const missing = await get(`/api/download?session_id=${SESSION}&file=mac-arm`);
    assert.equal(missing.status, 403, 'the Mac file is not in a Windows order');
  });
  await withStripe({ ...paid, metadata: { ...paid.metadata, version: '0.1.99' } }, async () => {
    assert.equal((await get(`/api/download?session_id=${SESSION}&file=win`)).status, 404, 'a version that is not uploaded');
  });
});

test('with a public address instead of a bucket, the buyer is sent to the file', async () => {
  await withStripe(paid, async () => {
    process.env.DOWNLOAD_BASE_URL = 'https://downloads.example.com';
    const res = await worker.fetch(new Request(`https://site.test/api/download?session_id=${SESSION}&file=win`), {});
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('Location'), 'https://downloads.example.com/0.1.55/Scorpion%20Setup%200.1.55.exe');
  });
});

test('the OS image comes from its own os/ folder', async () => {
  await withStripe({ payment_status: 'paid', metadata: { edition: 'complete', version: '0.1.55' } }, async () => {
    const res = await get(`/api/download?session_id=${SESSION}&file=os`);
    assert.equal(res.status, 404, 'not uploaded in this fake bucket');
    assert.equal(asked.at(-1), 'os/scorpion-os-0.1-amd64.iso');
  });
});
