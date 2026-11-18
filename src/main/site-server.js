// A small static file server for the pages Scorpion builds (Build mode). When the model writes an .html file, Scorpion serves the
// folder itself and opens the page in the preview, so the model does not spend several slow steps starting a server, finding its
// address and opening it. Localhost only; one server per folder; it only reads files inside that folder.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.map': 'application/json',
};
export const typeOf = (file) => TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';

// The file a request path means inside root, or null (a path that leaves the folder, a folder with no index.html...).
export function resolveRequest(root, urlPath) {
  let rel;
  try { rel = decodeURIComponent(String(urlPath || '/').split('?')[0].split('#')[0]); } catch { return null; }
  if (rel.includes('\0')) return null;
  const base = path.resolve(root);
  let file = path.resolve(base, `.${path.posix.normalize(`/${rel.replace(/\\/g, '/')}`)}`);
  if (file !== base && !file.startsWith(base + path.sep)) return null;
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    return fs.statSync(file).isFile() ? file : null;
  } catch { return null; }
}

const servers = new Map(); // folder -> Promise<{ port, server }>

export function serveFolder(root) {
  const key = path.resolve(root);
  if (servers.has(key)) return servers.get(key);
  const p = new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const file = resolveRequest(key, req.url);
      if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': typeOf(file), 'Cache-Control': 'no-store' }); // always the newest file: the page is being rewritten
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, server }));
  });
  p.catch(() => servers.delete(key));
  servers.set(key, p);
  return p;
}

// The address of a file inside a served folder.
export async function urlFor(root, file) {
  const { port } = await serveFolder(root);
  const rel = path.relative(path.resolve(root), path.resolve(file)).split(path.sep).map(encodeURIComponent).join('/');
  return `http://127.0.0.1:${port}/${rel}`;
}

export async function stopAll() {
  const all = [...servers.values()];
  servers.clear();
  await Promise.all(all.map((p) => p.then(({ server }) => new Promise((r) => server.close(r))).catch(() => {})));
}
