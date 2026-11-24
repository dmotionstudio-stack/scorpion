// Remote control: see this computer's screen and work its mouse and keyboard from a phone, a tablet or another computer's browser.
//
// What keeps it safe (it is off until the owner turns it on, in Settings → Connections):
//  - It is an HTTPS server with a certificate made here. By default it listens only on this computer (127.0.0.1); the owner can
//    allow the home network too, and then only private addresses (home network, VPN such as Tailscale) are answered at all.
//  - A device pairs once with a 6-digit code that is shown on THIS computer's screen (5 minutes, 5 wrong tries and it is gone,
//    and an address that keeps guessing is shut out). The device then holds a long random token; only its hash is kept here.
//  - Every session is approved on this computer ("Allow ... to control this computer?") unless the owner marked that device as
//    "allow without asking" for unattended use. One session at a time. A session ends by itself after 5 quiet minutes.
//  - While a session runs, the computer says so (a banner, a notification, a small window) and the owner can end it at once.
//  - Everything that happens is written to a log in Scorpion's data folder.
//  - Only the mouse, the keyboard and the screen picture are offered. Nothing else of Scorpion or the computer is reachable, and the
//    agent has no tool to switch any of this on.
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeInput } from './remote-input.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const IDLE_MS = 5 * 60_000;
export const PAIR_MS = 5 * 60_000;
export const APPROVE_MS = 60_000;
const PAIR_TRIES = 5;
const MAX_DEVICES = 10;
const BODY_LIMIT = 8 * 1024;

// ---------- the certificate (made here: no tool needed) ----------
const len = (n) => (n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]));
const tlv = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), len(body.length), body]); };
const intDer = (b) => tlv(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
const oid = (s) => {
  const a = s.split('.').map(Number);
  const bytes = [a[0] * 40 + a[1]];
  for (const n of a.slice(2)) { const t = [n & 127]; let v = n >> 7; while (v) { t.unshift((v & 127) | 128); v >>= 7; } bytes.push(...t); }
  return tlv(0x06, Buffer.from(bytes));
};
const utc = (d) => tlv(0x17, Buffer.from(`${d.toISOString().slice(2, 19).replace(/[-:T]/g, '')}Z`));
const pem = (label, der) => `-----BEGIN ${label}-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;

export function makeCertificate(now = new Date()) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const name = tlv(0x30, tlv(0x31, tlv(0x30, oid('2.5.4.3'), tlv(0x0c, Buffer.from('Scorpion Remote')))));
  const sigAlg = tlv(0x30, oid('1.2.840.10045.4.3.2')); // ecdsa-with-SHA256
  const serial = crypto.randomBytes(16);
  serial[0] = (serial[0] & 0x7f) | 0x01;
  const san = tlv(0xa3, tlv(0x30, tlv(0x30, oid('2.5.29.17'), tlv(0x04, tlv(0x30, tlv(0x82, Buffer.from('localhost')))))));
  const end = new Date(now.getTime() + 3650 * 86_400_000);
  const tbs = tlv(0x30, tlv(0xa0, intDer(Buffer.from([2]))), intDer(serial), sigAlg, name, tlv(0x30, utc(new Date(now.getTime() - 86_400_000)), utc(end)), name, publicKey.export({ type: 'spki', format: 'der' }), san);
  const sig = crypto.sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' });
  const cert = tlv(0x30, tbs, sigAlg, tlv(0x03, Buffer.concat([Buffer.from([0]), sig])));
  return { cert: pem('CERTIFICATE', cert), key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

// The certificate kept in the data folder, made again if it is missing, unreadable or about to run out.
export function loadCertificate(dir, now = Date.now()) {
  const certFile = path.join(dir, 'cert.pem');
  const keyFile = path.join(dir, 'key.pem');
  try {
    const cert = fs.readFileSync(certFile, 'utf8');
    const key = fs.readFileSync(keyFile, 'utf8');
    const x = new crypto.X509Certificate(cert);
    if (Date.parse(x.validTo) - now > 30 * 86_400_000) return { cert, key, fingerprint: x.fingerprint256 };
  } catch { /* made below */ }
  fs.mkdirSync(dir, { recursive: true });
  const made = makeCertificate();
  fs.writeFileSync(certFile, made.cert);
  fs.writeFileSync(keyFile, made.key, { mode: 0o600 });
  return { ...made, fingerprint: new crypto.X509Certificate(made.cert).fingerprint256 };
}

// ---------- who may even talk to it ----------
export function isLoopback(addr) {
  const a = String(addr || '').replace(/^::ffff:/, '');
  return a === '::1' || a === '127.0.0.1' || a.startsWith('127.');
}
export function isPrivateAddress(addr) {
  const a = String(addr || '').replace(/^::ffff:/, '').toLowerCase();
  if (isLoopback(a)) return true;
  if (/^10\./.test(a) || /^192\.168\./.test(a) || /^169\.254\./.test(a)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a)) return true; // 100.64.0.0/10: Tailscale and carrier-grade NAT
  return /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a);
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const hashToken = (t) => sha(t).toString('hex');
const bearer = (req) => /^Bearer ([\w-]{16,128})$/.exec(req.headers.authorization || '')?.[1] || null;

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal && isPrivateAddress(i.address)) out.push(i.address);
  return out;
}

/**
 * config: { get() → { enabled, lan, port, devices }, set(patch) }
 * capture() → { jpeg: Buffer, width, height }   the shared screen
 * input: { handle(command) }                      remote-input.js, for this operating system
 * approve({ device, ip }) → Promise<boolean>      asks the owner on this computer
 * onChange(status)                                called when anything the owner sees changes
 */
export function createRemoteControl({ dataDir, config, capture, input, approve, onChange = () => {}, now = Date.now, port: forcedPort }) {
  const dir = path.join(dataDir, 'remote-control');
  let server = null;
  let state = { state: 'off', error: null, port: null, fingerprint: null };
  let pairing = null; // { code, expiresAt, tries }
  let session = null; // { id, deviceId, name, ip, since, last }
  let pending = null; // { name, ip } waiting for the owner
  let frame = null; // { at, promise }
  let idleTimer = null;
  const log = [];
  const shutOut = new Map(); // ip → { fails, until }

  const cfg = () => ({ enabled: false, lan: false, port: 8443, devices: [], ...(config.get() || {}) });
  const note = (text) => {
    const line = { at: now(), text };
    log.push(line);
    if (log.length > 60) log.shift();
    try { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, 'log.txt'), `${new Date(line.at).toISOString()}  ${text}\n`); } catch { /* the log is a help, not a need */ }
  };

  function status() {
    const c = cfg();
    const port = state.port;
    const urls = port ? (c.lan ? lanAddresses().map((a) => `https://${a}:${port}`) : []).concat(`https://localhost:${port}`) : [];
    return {
      ...state,
      enabled: c.enabled,
      lan: c.lan,
      configuredPort: c.port,
      urls,
      devices: c.devices.map((d) => ({ id: d.id, name: d.name, addedAt: d.addedAt, lastSeen: d.lastSeen || null, unattended: Boolean(d.unattended) })),
      pairing: pairing && pairing.expiresAt > now() ? { code: pairing.code, expiresAt: pairing.expiresAt } : null,
      session: session ? { name: session.name, ip: session.ip, since: session.since } : null,
      waiting: pending,
      log: log.slice(-12),
    };
  }
  const changed = () => { try { onChange(status()); } catch { /* the owner's screen is not the server's business */ } };

  function endSession(reason = 'ended') {
    if (!session) return false;
    note(`Session with ${session.name} (${session.ip}) ${reason}`);
    session = null;
    frame = null;
    clearInterval(idleTimer);
    idleTimer = null;
    changed();
    return true;
  }

  // ---------- pairing ----------
  function startPairing() {
    if (!state.port) throw new Error('Remote control is not on. Turn it on first.');
    if (cfg().devices.length >= MAX_DEVICES) throw new Error(`${MAX_DEVICES} devices are paired already. Remove one first.`);
    pairing = { code: String(crypto.randomInt(100000, 1000000)), expiresAt: now() + PAIR_MS, tries: 0 };
    note('A pairing code was shown');
    changed();
    return { code: pairing.code, expiresAt: pairing.expiresAt };
  }
  function cancelPairing() { pairing = null; changed(); }

  const blocked = (ip) => { const s = shutOut.get(ip); return Boolean(s && s.until > now()); };
  function failed(ip) {
    const s = shutOut.get(ip) || { fails: 0, until: 0 };
    s.fails += 1;
    if (s.fails >= 5) { s.until = now() + 10 * 60_000; s.fails = 0; note(`${ip} was shut out for 10 minutes (wrong codes or tokens)`); }
    shutOut.set(ip, s);
  }

  function pair(code, name, ip) {
    if (!pairing || pairing.expiresAt <= now()) return { status: 403, error: 'There is no pairing code open on the computer. Start one in Scorpion → Settings → Connections.' };
    pairing.tries += 1;
    if (!same(code, pairing.code)) {
      failed(ip);
      if (pairing.tries >= PAIR_TRIES) { pairing = null; note('The pairing code was used up by wrong tries'); changed(); }
      return { status: 403, error: 'That code is not right.' };
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const device = { id: crypto.randomBytes(6).toString('hex'), name: String(name || 'A device').replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, 40) || 'A device', hash: hashToken(token), addedAt: now(), lastSeen: now(), unattended: false };
    config.set({ devices: [...cfg().devices, device] });
    pairing = null;
    note(`Paired ${device.name} (${ip})`);
    changed();
    return { status: 200, body: { token, name: device.name } };
  }

  function removeDevice(id) {
    const d = cfg().devices.find((x) => x.id === id);
    if (!d) return false;
    config.set({ devices: cfg().devices.filter((x) => x.id !== id) });
    if (session?.deviceId === id) endSession('ended: the device was removed');
    note(`Removed ${d.name}`);
    changed();
    return true;
  }
  function setUnattended(id, on) {
    config.set({ devices: cfg().devices.map((d) => (d.id === id ? { ...d, unattended: Boolean(on) } : d)) });
    note(`${on ? 'Allowed' : 'No longer allowed'} ${cfg().devices.find((d) => d.id === id)?.name || 'a device'} without asking`);
    changed();
  }

  // ---------- a session ----------
  async function openSession(token, ip) {
    const device = cfg().devices.find((d) => same(hashToken(token), d.hash));
    if (!device) { failed(ip); return { status: 401, error: 'This device is not paired (any more). Pair it again.' }; }
    if (session) return { status: 409, error: 'Someone is already controlling this computer.' };
    if (pending) return { status: 409, error: 'Another request is waiting for the owner.' };
    if (!device.unattended) {
      pending = { name: device.name, ip };
      note(`${device.name} (${ip}) asked to control this computer`);
      changed();
      let ok = false;
      try { ok = await Promise.race([approve({ device: { id: device.id, name: device.name }, ip }), new Promise((r) => setTimeout(() => r(false), APPROVE_MS).unref?.())]); } catch { ok = false; }
      pending = null;
      if (!ok) { note(`${device.name} was not allowed`); changed(); return { status: 403, error: 'The owner did not allow it.' }; }
    }
    const id = crypto.randomBytes(24).toString('base64url');
    session = { id, deviceId: device.id, name: device.name, ip, since: now(), last: now() };
    config.set({ devices: cfg().devices.map((d) => (d.id === device.id ? { ...d, lastSeen: now() } : d)) });
    note(`${device.name} (${ip}) is controlling this computer`);
    clearInterval(idleTimer);
    idleTimer = setInterval(sweep, 15_000);
    idleTimer.unref?.();
    changed();
    return { status: 200, body: { session: id, name: device.name } };
  }
  function sweep() { if (session && now() - session.last > IDLE_MS) endSession('ended: nothing for 5 minutes'); }
  const sessionOf = (token) => (session && token && same(token, session.id) ? session : null);

  // One picture at a time; a picture less than 60 ms old is reused.
  async function screenFrame() {
    if (frame?.promise) return frame.promise;
    if (frame?.value && now() - frame.at < 60) return frame.value;
    const promise = Promise.resolve(capture()).then((v) => { frame = { at: now(), value: v }; return v; }, (err) => { frame = null; throw err; });
    frame = { promise };
    return promise;
  }

  // ---------- the server ----------
  const send = (res, status, body, type = 'application/json', extra = {}) => {
    const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin', ...extra });
    res.end(data);
  };
  const readJson = (req) => new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => { size += c.length; if (size > BODY_LIMIT) { reject(new Error('too big')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
  const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src blob: data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

  async function handle(req, res) {
    const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const c = cfg();
    // Only this computer, or (when the owner allowed the network) private addresses.
    if (!(isLoopback(ip) || (c.lan && isPrivateAddress(ip)))) return send(res, 403, { error: 'Not allowed from here.' });
    const host = String(req.headers.host || '');
    if (!c.lan && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return send(res, 403, { error: 'Not allowed.' });
    if (req.headers.origin && req.headers.origin !== `https://${host}`) return send(res, 403, { error: 'Not allowed.' });
    if (blocked(ip)) return send(res, 429, { error: 'Too many wrong tries. Wait ten minutes.' });
    const url = new URL(req.url, 'https://x');
    const route = `${req.method} ${url.pathname}`;
    try {
      if (route === 'GET /') return send(res, 200, fs.readFileSync(path.join(HERE, 'remote-client.html')), 'text/html; charset=utf-8', { 'Content-Security-Policy': PAGE_CSP });
      if (route === 'GET /client.js') return send(res, 200, fs.readFileSync(path.join(HERE, 'remote-client.js')), 'text/javascript; charset=utf-8');
      if (route === 'GET /favicon.ico') return send(res, 204, '');
      if (req.method === 'POST' && !/^application\/json\b/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'JSON only.' });
      if (route === 'POST /pair') {
        const b = await readJson(req);
        const r = pair(String(b.code || ''), b.name, ip);
        return send(res, r.status, r.body || { error: r.error });
      }
      if (route === 'POST /session') {
        const token = bearer(req);
        if (!token) return send(res, 401, { error: 'Pair this device first.' });
        const r = await openSession(token, ip);
        return send(res, r.status, r.body || { error: r.error });
      }
      // Everything below needs a running session.
      const s = sessionOf(bearer(req));
      if (!s) { failed(ip); return send(res, 401, { error: 'The session is over.' }); }
      s.last = now();
      if (route === 'GET /frame') {
        const f = await screenFrame();
        return send(res, 200, f.jpeg, 'image/jpeg', { 'X-Screen-Width': String(f.width), 'X-Screen-Height': String(f.height) });
      }
      if (route === 'POST /input') {
        const cmd = normalizeInput(await readJson(req));
        if (!cmd) return send(res, 400, { error: 'Not an input.' });
        await input.handle(cmd);
        return send(res, 200, { ok: true });
      }
      if (route === 'POST /end') { endSession('ended by the device'); return send(res, 200, { ok: true }); }
      return send(res, 404, { error: 'Not found.' });
    } catch (err) {
      return send(res, 500, { error: String(err.message || err).slice(0, 200) });
    }
  }

  async function start() {
    await stop();
    const c = cfg();
    if (!c.enabled) { state = { state: 'off', error: null, port: null, fingerprint: null }; changed(); return status(); }
    try {
      const { cert, key, fingerprint } = loadCertificate(dir, now());
      const srv = https.createServer({ cert, key, minVersion: 'TLSv1.2' }, (req, res) => { handle(req, res); });
      srv.on('tlsClientError', () => {});
      await new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(forcedPort ?? c.port, c.lan ? '0.0.0.0' : '127.0.0.1', resolve); });
      srv.on('error', () => {});
      server = srv;
      state = { state: 'on', error: null, port: srv.address().port, fingerprint };
      note(`Remote control is on (port ${state.port}, ${c.lan ? 'home network allowed' : 'this computer only'})`);
    } catch (err) {
      state = { state: 'error', error: err.code === 'EADDRINUSE' ? `Port ${c.port} is used by another program. Pick another port.` : String(err.message || err), port: null, fingerprint: null };
    }
    changed();
    return status();
  }

  async function stop() {
    endSession('ended: remote control was turned off');
    pairing = null;
    pending = null;
    const srv = server;
    server = null;
    if (srv) {
      srv.closeAllConnections?.();
      await new Promise((r) => srv.close(() => r()));
      note('Remote control is off');
    }
    state = { state: 'off', error: null, port: null, fingerprint: null };
    return status();
  }

  return { start, stop, status, startPairing, cancelPairing, removeDevice, setUnattended, endSession, sweep };
}
