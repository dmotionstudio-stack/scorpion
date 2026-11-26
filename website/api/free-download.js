// GET /dl/<key>  (win, mac-arm, mac-intel)  ->  302 to the newest installer. Free, for everyone.
// From our own Cloudflare bucket when the installer has been copied there (the release workflow does that), else from the
// GitHub release. The Worker (worker.js) turns an r2:// address into the file itself.

import { PLATFORMS } from '../data/catalog.js';
import { freeFiles, latestRelease } from '../lib/latest.js';

const text = (message, status) => new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function GET(request, env) {
  const key = decodeURIComponent(new URL(request.url).pathname.split('/').pop() || '');
  if (!PLATFORMS[key] || key === 'linux') return text('That download does not exist.', 404);
  let release;
  try { release = await latestRelease(env); } catch { return text('The latest release could not be read. Please try again in a minute.', 502); }
  const file = freeFiles(release).find((f) => f.key === key);
  if (!file) return text('That installer is not in the latest release yet.', 404);
  // Our bucket first (the same name the release workflow gives the file there).
  const bucket = process.env.DOWNLOAD_BASE_URL?.startsWith('r2://') ? process.env.DOWNLOAD_BASE_URL : '';
  const ours = PLATFORMS[key].files(release.version)[0].file;
  if (bucket && env?.DOWNLOADS && (await env.DOWNLOADS.head(`${release.version}/${ours}`))) {
    return new Response(null, { status: 302, headers: { Location: `${bucket.replace(/\/+$/, '')}/${encodeURIComponent(release.version)}/${encodeURIComponent(ours)}`, 'Cache-Control': 'no-store' } });
  }
  return new Response(null, { status: 302, headers: { Location: file.url, 'Cache-Control': 'public, max-age=300' } });
}
