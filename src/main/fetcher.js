// Downloads for the agent (download_file, download_model, add_agent): a web
// address in, a file out, with its size and checksum reported. What may be
// downloaded is the person's call: Scorpion asks first, or does it by itself
// in Unrestricted mode (Settings → Privacy), where each one is written to the
// activity log. Plain functions, tested in test/fetcher.test.js.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Only web addresses: never a file on this computer (file:), a script (javascript:) or anything else.
export function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new Error('That is not a web address.'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https addresses can be downloaded.');
  return u;
}
// A file name that is safe to write here: no folders, nothing Windows refuses, never empty.
export function safeName(name, fallback = 'download') {
  const base = decodeURIComponent(String(name || '')).split(/[\\/]/).pop().replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/^\.+/, '').replace(/[ .]+$/, '').slice(0, 150);
  return base || fallback;
}
// The name a download wants: its Content-Disposition, else the end of its address.
export function nameFor(url, disposition) {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(String(disposition || ''));
  return safeName(m ? m[1] : url.pathname, 'download');
}
// A name that is free in a folder: "file (2).zip" if "file.zip" is there.
export function freeName(dir, name, exists = fs.existsSync) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; n < 1000; n++) {
    const candidate = `${stem}${n > 1 ? ` (${n})` : ''}${ext}`;
    if (!exists(path.join(dir, candidate))) return candidate;
  }
  throw new Error(`Too many files named ${name}`);
}

// Download url into dir. Written under a temporary name and moved into place
// when complete, so a stopped download never leaves something that looks whole.
// opts: { signal, name, fetchImpl, maxBytes, onProgress({ done, total }) }
export async function downloadFile(rawUrl, dir, opts = {}) {
  const { signal, fetchImpl = fetch, maxBytes = Infinity, onProgress } = opts;
  const url = checkUrl(rawUrl);
  fs.mkdirSync(dir, { recursive: true });
  const res = await fetchImpl(url, { signal, redirect: 'follow', headers: { 'User-Agent': 'Scorpion' } });
  if (!res.ok) throw new Error(`The server answered ${res.status} ${res.statusText || ''}`.trim());
  const total = Number(res.headers.get('content-length')) || 0;
  if (total && total > maxBytes) throw new Error(`It is ${(total / 1e9).toFixed(1)} GB, over the limit.`);
  const name = freeName(dir, opts.name ? safeName(opts.name) : nameFor(new URL(res.url || url), res.headers.get('content-disposition')));
  const final = path.join(dir, name);
  const part = `${final}.part`;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(part);
  let done = 0;
  try {
    for await (const chunk of res.body) {
      done += chunk.length;
      if (done > maxBytes) throw new Error('It is bigger than the limit.');
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
      onProgress?.({ done, total });
    }
    await new Promise((resolve, reject) => { out.end((err) => (err ? reject(err) : resolve())); });
    if (total && done !== total) throw new Error(`The download stopped at ${done} of ${total} bytes.`);
    fs.renameSync(part, final);
  } catch (err) {
    out.destroy();
    fs.rmSync(part, { force: true });
    throw err;
  }
  return { path: final, name, bytes: done, sha256: hash.digest('hex'), url: String(url) };
}

// A small JSON document (an agent's definition), capped in size.
export async function fetchJson(rawUrl, { signal, fetchImpl = fetch, maxBytes = 200_000 } = {}) {
  const url = checkUrl(rawUrl);
  const res = await fetchImpl(url, { signal, redirect: 'follow', headers: { 'User-Agent': 'Scorpion', Accept: 'application/json' } });
  if (!res.ok) throw new Error(`The server answered ${res.status}`);
  const text = await res.text();
  if (text.length > maxBytes) throw new Error('That file is too big to be an agent.');
  try { return JSON.parse(text); } catch { throw new Error('That address is not a JSON file.'); }
}

export const humanSize = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
