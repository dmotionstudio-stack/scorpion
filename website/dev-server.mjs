// Local preview: serves the site and runs the /api functions the same way
// Vercel does (Web Request in, Response out).
//   node dev-server.mjs            -> http://localhost:4321
// Set STRIPE_SECRET_KEY (a sk_test_ key) and DOWNLOAD_BASE_URL to try real checkout.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT) || 4321;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z-]/g, '');
      const mod = await import(pathToFileURL(join(root, 'api', `${name}.js`)).href);
      const handler = mod[req.method];
      if (!handler) { res.writeHead(405).end(); return; }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (!path || path.endsWith('/') || path.endsWith('\\')) path += 'index.html';
    if (path.startsWith('..') || /^(lib|api)[/\\]/.test(path)) { res.writeHead(404).end('Not found'); return; }
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }).end(body);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ERR_MODULE_NOT_FOUND') { res.writeHead(404).end('Not found'); return; }
    console.error(err);
    res.writeHead(500).end('Server error');
  }
}).listen(port, () => {
  console.log(`Scorpion site on http://localhost:${port}`);
  if (!process.env.STRIPE_SECRET_KEY) console.log('STRIPE_SECRET_KEY not set: checkout runs in demo mode.');
});
