import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { createRemoteControl, makeCertificate, loadCertificate, isPrivateAddress, isLoopback, IDLE_MS } from '../src/main/remote-control.js';
import { normalizeInput, windowsInput, macInput, appleKeyLine, jxaMouse } from '../src/main/remote-input.js';

const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-rc-'));

test('the certificate made here is a real, self-signed certificate', () => {
  const { cert, key } = makeCertificate();
  const x = new crypto.X509Certificate(cert);
  assert.ok(x.verify(x.publicKey), 'signed by its own key');
  assert.match(x.subject, /Scorpion Remote/);
  assert.match(x.subjectAltName, /DNS:localhost/);
  assert.ok(Date.parse(x.validTo) > Date.now() + 3000 * 86_400_000, 'valid for years');
  assert.ok(crypto.createPrivateKey(key));
  // kept in the data folder and reused
  const dir = fresh();
  const a = loadCertificate(dir);
  assert.equal(loadCertificate(dir).fingerprint, a.fingerprint);
});

test('only this computer, or private network addresses, may even talk to it', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '192.168.1.20', '10.1.2.3', '172.16.0.5', '172.31.9.9', '100.64.1.1', '100.101.102.103', 'fd12::1', 'fe80::1']) assert.ok(isPrivateAddress(a), a);
  for (const a of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '203.0.113.9', '2001:db8::1', '']) assert.ok(!isPrivateAddress(a), a);
  assert.ok(isLoopback('::ffff:127.0.0.1'));
  assert.ok(!isLoopback('192.168.1.2'));
});

test('input from the page is checked: only these things can reach the computer', () => {
  assert.equal(normalizeInput(null), null);
  assert.equal(normalizeInput({ type: 'run', command: 'calc' }), null);
  assert.deepEqual(normalizeInput({ type: 'move', x: 2, y: -1 }), { type: 'move', x: 1, y: 0 });
  assert.deepEqual(normalizeInput({ type: 'click', x: 0.5, y: 0.25, button: 'weird', count: 9 }), { type: 'click', x: 0.5, y: 0.25, button: 'left', count: 2 });
  assert.equal(normalizeInput({ type: 'wheel', x: 0, y: 0, notches: 999 }).notches, 20);
  assert.equal(normalizeInput({ type: 'text', text: '' }), null);
  assert.equal(normalizeInput({ type: 'text', text: 'x'.repeat(1000) }).text.length, 400);
  assert.deepEqual(normalizeInput({ type: 'key', key: 'Enter' }).name, 'Enter');
  assert.equal(normalizeInput({ type: 'key', key: 'NotAKey' }), null);
  assert.deepEqual(normalizeInput({ type: 'key', key: 'c', mods: { ctrl: true } }), { type: 'key', char: 'c', mods: { ctrl: true, alt: false, shift: false, meta: false } });
  assert.deepEqual(normalizeInput({ type: 'key', key: 'a' }), { type: 'text', text: 'a' }, 'a plain letter is typing');
  assert.equal(normalizeInput({ type: 'key', key: ';', mods: { ctrl: true } }).type, 'text', 'no odd shortcuts: it is just a character');
});

test('Windows: input becomes the helper\'s own requests, in real pixels', async () => {
  const calls = [];
  const w = windowsInput({ call: async (...a) => { calls.push(a); }, toScreen: (x, y) => ({ x: Math.round(x * 1920), y: Math.round(y * 1080) }) });
  await w.handle(normalizeInput({ type: 'click', x: 0.5, y: 0.5, button: 'right' }));
  await w.handle(normalizeInput({ type: 'down', x: 0, y: 1 }));
  await w.handle(normalizeInput({ type: 'wheel', x: 0.1, y: 0.1, notches: -3 }));
  await w.handle(normalizeInput({ type: 'text', text: 'héllo' }));
  await w.handle(normalizeInput({ type: 'key', key: 'ArrowLeft' }));
  await w.handle(normalizeInput({ type: 'key', key: 'c', mods: { ctrl: true } }));
  assert.deepEqual(calls[0], ['click', 960, 540, 1, 1]);
  assert.deepEqual(calls[1], ['down', 0, 1080]);
  assert.deepEqual(calls[2], ['wheel', 192, 108, -3, 0]);
  assert.equal(Buffer.from(calls[3][1], 'base64').toString('utf8'), 'héllo');
  assert.deepEqual(calls[4], ['key', 37, 16], 'an arrow is an extended key');
  assert.deepEqual(calls[5], ['key', 67, 1], 'Ctrl+C');
});

test('Mac: osascript scripts are fixed text with numbers and an escaped string', async () => {
  const runs = [];
  const m = macInput({ run: async (args) => { runs.push(args); }, toScreen: (x, y) => ({ x: Math.round(x * 1440), y: Math.round(y * 900) }) });
  await m.handle(normalizeInput({ type: 'click', x: 0.5, y: 0.5, count: 2 }));
  await m.handle(normalizeInput({ type: 'text', text: 'say "hi" \\ now' }));
  await m.handle(normalizeInput({ type: 'key', key: 'v', mods: { meta: true } }));
  await m.handle(normalizeInput({ type: 'key', key: 'Escape' }));
  assert.equal(runs[0][0], '-l');
  assert.match(runs[0][3], /x: 720, y: 450/);
  assert.equal((runs[0][3].match(/CGEventPost/g) || []).length, 4, 'two clicks, a press and a release each');
  assert.equal(runs[1][1], 'tell application "System Events" to keystroke "say \\"hi\\" \\\\ now"');
  assert.equal(runs[2][1], 'tell application "System Events" to keystroke "v" using {command down}');
  assert.equal(runs[3][1], 'tell application "System Events" to key code 53');
  assert.match(jxaMouse('down', 1, 2, 'right'), /RightMouseDown/);
  assert.equal(appleKeyLine({ type: 'key', name: 'Tab', mods: { shift: true } }), 'tell application "System Events" to key code 48 using {shift down}');
});

// ---------- the real server, over real TLS, on this computer ----------
function setup({ unattended = false, approve = async () => true, lan = false } = {}) {
  const cfg = { enabled: true, lan, port: 0, devices: [] };
  const seen = { inputs: [], captures: 0 };
  let clock = 1_000_000;
  const rc = createRemoteControl({
    dataDir: fresh(),
    config: { get: () => cfg, set: (p) => Object.assign(cfg, p) },
    capture: async () => { seen.captures++; return { jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), width: 1600, height: 900 }; },
    input: { handle: async (c) => { seen.inputs.push(c); } },
    approve: async (...a) => { seen.asked = (seen.asked || 0) + 1; return approve(...a); },
    now: () => clock,
    port: 0,
  });
  const call = (method, route, { body, token, headers = {}, port = rc.status().port, raw } = {}) => new Promise((resolve, reject) => {
    const data = raw ?? (body === undefined ? null : JSON.stringify(body));
    const req = https.request({ host: '127.0.0.1', port, path: route, method, rejectUnauthorized: false, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => { const buf = Buffer.concat(parts); let json = null; try { json = JSON.parse(buf.toString()); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, json, buf }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
  const pairDevice = async (name = 'My phone') => {
    const { code } = rc.startPairing();
    const r = await call('POST', '/pair', { body: { code, name } });
    assert.equal(r.status, 200);
    return r.json.token;
  };
  return { rc, cfg, seen, call, pairDevice, tick: (ms) => { clock += ms; } };
}

test('it is off until turned on, and nothing listens', async () => {
  const cfg = { enabled: false, lan: false, port: 0, devices: [] };
  const rc = createRemoteControl({ dataDir: fresh(), config: { get: () => cfg, set: (p) => Object.assign(cfg, p) }, capture() {}, input: {}, approve: async () => false, port: 0 });
  const st = await rc.start();
  assert.equal(st.state, 'off');
  assert.equal(st.port, null);
  assert.throws(() => rc.startPairing(), /not on/);
});

test('pairing, approval, seeing the screen, and working the computer', async () => {
  const t = setup();
  await t.rc.start();
  try {
    // the page itself is served with a strict policy
    const page = await t.call('GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-security-policy'], /default-src 'none'/);
    assert.match((await t.call('GET', '/client.js')).buf.toString(), /Scorpion/);
    // no code open: nobody can pair
    assert.equal((await t.call('POST', '/pair', { body: { code: '123456', name: 'x' } })).status, 403);
    const token = await t.pairDevice('My phone');
    // only a hash of the token is kept
    assert.ok(!JSON.stringify(t.cfg).includes(token));
    assert.equal(t.cfg.devices.length, 1);
    // nothing without a session
    assert.equal((await t.call('GET', '/frame')).status, 401);
    assert.equal((await t.call('POST', '/input', { body: { type: 'click', x: 0, y: 0 } })).status, 401);
    assert.equal((await t.call('POST', '/session', { body: {} })).status, 401);
    const s = await t.call('POST', '/session', { token, body: {} });
    assert.equal(s.status, 200);
    assert.equal(t.seen.asked, 1, 'the owner was asked');
    assert.equal(t.rc.status().session.name, 'My phone');
    const session = s.json.session;
    const f = await t.call('GET', '/frame', { token: session });
    assert.equal(f.status, 200);
    assert.equal(f.headers['content-type'], 'image/jpeg');
    assert.equal(f.headers['x-screen-width'], '1600');
    // the device token alone is not a session
    assert.equal((await t.call('GET', '/frame', { token })).status, 401);
    // input is checked, then done
    assert.equal((await t.call('POST', '/input', { token: session, body: { type: 'click', x: 0.5, y: 0.5 } })).status, 200);
    assert.equal((await t.call('POST', '/input', { token: session, body: { type: 'format', drive: 'C' } })).status, 400);
    assert.deepEqual(t.seen.inputs.map((c) => c.type), ['click']);
    // one at a time
    const second = await t.pairDevice('Tablet');
    assert.equal((await t.call('POST', '/session', { token: second, body: {} })).status, 409);
    // ending
    assert.equal((await t.call('POST', '/end', { token: session, body: {} })).status, 200);
    assert.equal(t.rc.status().session, null);
    assert.equal((await t.call('GET', '/frame', { token: session })).status, 401);
    assert.ok(t.rc.status().log.some((l) => /is controlling this computer/.test(l.text)), 'it is all in the log');
  } finally { await t.rc.stop(); }
});

test('a session the owner denies never starts, and an unattended device is let in without asking', async () => {
  const denied = setup({ approve: async () => false });
  await denied.rc.start();
  try {
    const token = await denied.pairDevice();
    assert.equal((await denied.call('POST', '/session', { token, body: {} })).status, 403);
    assert.equal(denied.rc.status().session, null);
  } finally { await denied.rc.stop(); }

  const open = setup({ approve: async () => false });
  await open.rc.start();
  try {
    const token = await open.pairDevice();
    open.rc.setUnattended(open.cfg.devices[0].id, true);
    assert.equal((await open.call('POST', '/session', { token, body: {} })).status, 200);
    assert.equal(open.seen.asked, undefined, 'nobody was asked');
    open.rc.endSession('test');
  } finally { await open.rc.stop(); }
});

test('wrong codes use the code up, and a guessing address is shut out', async () => {
  const t = setup();
  await t.rc.start();
  try {
    t.rc.startPairing();
    for (let i = 0; i < 4; i++) assert.equal((await t.call('POST', '/pair', { body: { code: '000000', name: 'x' } })).status, 403);
    assert.equal((await t.call('POST', '/pair', { body: { code: '000000', name: 'x' } })).status, 403);
    assert.equal(t.rc.status().pairing, null, 'five wrong tries and the code is gone');
    // the same address has now failed five times: shut out, even with a right code
    const { code } = t.rc.startPairing();
    assert.equal((await t.call('POST', '/pair', { body: { code, name: 'x' } })).status, 429);
    // time passes
    t.tick(11 * 60_000);
    const { code: later } = t.rc.startPairing();
    assert.equal((await t.call('POST', '/pair', { body: { code: later, name: 'x' } })).status, 200);
  } finally { await t.rc.stop(); }
});

test('an old code does not work, and a stranger\'s page cannot reach it', async () => {
  const t = setup();
  await t.rc.start();
  try {
    const { code } = t.rc.startPairing();
    t.tick(6 * 60_000);
    assert.equal((await t.call('POST', '/pair', { body: { code, name: 'x' } })).status, 403, 'expired');
    t.rc.startPairing();
    // another site's page (a different Origin or Host) is turned away
    assert.equal((await t.call('POST', '/pair', { body: { code: '1', name: 'x' }, headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await t.call('GET', '/', { headers: { Host: 'evil.example' } })).status, 403, 'a rebound name is refused');
    assert.equal((await t.call('POST', '/pair', { raw: 'code=1', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  } finally { await t.rc.stop(); }
});

test('a session ends after five quiet minutes, when the device is removed, and when remote control is turned off', async () => {
  const t = setup();
  await t.rc.start();
  try {
    const token = await t.pairDevice();
    const { json } = await t.call('POST', '/session', { token, body: {} });
    t.tick(IDLE_MS - 1000);
    t.rc.sweep();
    assert.ok(t.rc.status().session, 'still in');
    assert.equal((await t.call('GET', '/frame', { token: json.session })).status, 200, 'using it keeps it');
    t.tick(IDLE_MS + 1000);
    t.rc.sweep();
    assert.equal(t.rc.status().session, null);
    // removing a device while it is in
    const again = await t.call('POST', '/session', { token, body: {} });
    assert.equal(again.status, 200);
    t.rc.removeDevice(t.cfg.devices[0].id);
    assert.equal(t.rc.status().session, null);
    assert.equal((await t.call('POST', '/session', { token, body: {} })).status, 401, 'the old token is dead');
  } finally { await t.rc.stop(); }
  assert.equal(t.rc.status().state, 'off');
});
