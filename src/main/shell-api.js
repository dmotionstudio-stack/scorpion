// The local connection between Scorpion and the native shell host on Scorpion
// OS (os/rootfs/usr/lib/scorpion-os/scorpion-shell). The host shows Scorpion's
// shell pages (edge.html, summon.html, notify.html, osd.html) as Wayland
// layer-shell panels in WebKitGTK; their window.scorpion (shell-bridge.js)
// calls Scorpion here. It listens on 127.0.0.1 only, every request carries a
// random key written to a file only this user can read
// ($XDG_RUNTIME_DIR/scorpion-shell.json), and only the shell's own calls and
// events (src/shared/shell-channels.js) go through.
//   GET  /<key>/<page or asset>      the shell pages (from src/renderer)
//   POST /<key>/ipc/<channel>        a call: JSON in, { ok, value | error } out
//   GET  /<key>/events               the events, as server-sent events
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { SHELL_CHANNELS, SHELL_EVENT_CHANNELS } from '../shared/shell-channels.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
let server = null;
const clients = new Set();
let info = null;
let onGone = null; // the host's pages all closed for 15 s
let goneTimer = null;

export const infoFile = () => path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), 'scorpion-shell.json');

// handlers: channel → fn(arg); roots: folders the pages and their assets come from.
export function startShellApi({ handlers, roots, gone }) {
  onGone = gone || null;
  if (server) return Promise.resolve(info);
  const key = crypto.randomBytes(24).toString('hex');
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter(Boolean);
    // Constant-time key check; anything else is simply not found.
    const given = Buffer.from(parts[0] || '');
    if (given.length !== key.length || !crypto.timingSafeEqual(given, Buffer.from(key))) { res.writeHead(404).end(); return; }
    const rest = parts.slice(1);
    if (req.method === 'POST' && rest[0] === 'ipc' && rest.length === 2) {
      const channel = decodeURIComponent(rest[1]);
      if (!SHELL_CHANNELS.has(channel) || !handlers[channel]) { res.writeHead(404).end(); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 1_000_000) { res.writeHead(413).end(); return; } }
      let arg;
      try { arg = body ? JSON.parse(body) : undefined; } catch { res.writeHead(400).end(); return; }
      let out;
      try { out = { ok: true, value: await handlers[channel](arg) }; } catch (err) { out = { ok: false, error: err?.message || String(err) }; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(out ?? { ok: true }));
      return;
    }
    if (req.method === 'GET' && rest[0] === 'events' && rest.length === 1) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': hello\n\n');
      clients.add(res);
      clearTimeout(goneTimer);
      req.on('close', () => {
        clients.delete(res);
        if (!clients.size) goneTimer = setTimeout(() => { if (!clients.size) onGone?.(); }, 15000);
      });
      return;
    }
    if (req.method === 'GET' && rest.length) {
      // A page or one of its files, never outside the allowed folders.
      const rel = rest.map(decodeURIComponent).join('/');
      for (const root of roots) {
        const file = path.resolve(root, rel);
        if (!file.startsWith(path.resolve(root) + path.sep)) continue;
        if (fs.existsSync(file) && fs.statSync(file).isFile()) {
          res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
          fs.createReadStream(file).pipe(res);
          return;
        }
      }
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      info = { port: server.address().port, key, pid: process.pid };
      const file = infoFile();
      fs.writeFileSync(file, JSON.stringify(info), { mode: 0o600 });
      try { fs.chmodSync(file, 0o600); } catch { /* not on this file system */ }
      resolve(info);
    });
  });
}

// An event to every connected shell page (only the shell's own events).
export function shellEvent(channel, payload) {
  if (!clients.size || !SHELL_EVENT_CHANNELS.has(channel)) return;
  const data = `event: ${channel}\ndata: ${JSON.stringify(payload ?? null)}\n\n`;
  for (const res of clients) res.write(data);
}

export function stopShellApi() {
  for (const res of clients) res.end();
  clients.clear();
  server?.close();
  server = null;
  try { fs.rmSync(infoFile(), { force: true }); } catch { /* gone */ }
}
