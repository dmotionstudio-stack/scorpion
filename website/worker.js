// The website's backend on Cloudflare: one Worker that serves the /api functions (checkout, order, download, and sign-in).
// The pages and assets are served by Cloudflare itself (wrangler.toml, [assets]); only /api/* reaches this file.
//
// The API files are plain Web Request -> Response functions, so they run here unchanged. Secrets and settings
// (STRIPE_SECRET_KEY, SITE_URL, DOWNLOAD_BASE_URL) arrive as process.env (the nodejs_compat flag).
//
// Downloads: with DOWNLOAD_BASE_URL set to an https address, a paid buyer is redirected to the file there (a public
// bucket). With DOWNLOAD_BASE_URL = r2://<bucket name> and the bucket bound as DOWNLOADS (wrangler.toml), the bucket
// stays private and this Worker streams the file itself, after the payment check.

// Signing in (My downloads) is five more: an emailed code, the check of it, signing out, the list of paid orders,
// and the Stripe webhook that feeds that list. They keep their data in the KV namespace bound as AUTH_KV.
import * as authLogout from './api/auth-logout.js';
import * as authRequest from './api/auth-request.js';
import * as authVerify from './api/auth-verify.js';
import * as checkout from './api/checkout.js';
import * as download from './api/download.js';
import * as freeDownload from './api/free-download.js';
import * as latest from './api/latest.js';
import * as library from './api/library.js';
import * as order from './api/order.js';
import * as stripeWebhook from './api/stripe-webhook.js';

const routes = {
  '/api/checkout': checkout,
  '/api/download': download,
  '/api/latest': latest, // the newest release and its free installers, for the Download page
  '/api/order': order,
  '/api/auth-request': authRequest,
  '/api/auth-verify': authVerify,
  '/api/auth-logout': authLogout,
  '/api/library': library,
  '/api/stripe-webhook': stripeWebhook,
};

// Streams a file out of the bound R2 bucket (with resume support), as a download.
async function streamFromR2(request, bucket, key) {
  const object = await bucket.get(key, { range: request.headers, onlyIf: request.headers });
  if (!object) return new Response('That file is not available yet.', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, no-store');
  const name = key.split('/').pop();
  headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/octet-stream');
  if (!object.body) return new Response(null, { status: 304, headers }); // the browser's copy is still good
  if (object.range) {
    const { offset = 0, length = object.size - offset } = object.range;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // /dl/<win|mac-arm|mac-intel>: the free installers (the newest release), for everyone.
    const mod = routes[url.pathname] || (url.pathname.startsWith('/dl/') ? freeDownload : null);
    if (!mod) return env?.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    const handler = mod[request.method === 'HEAD' ? 'GET' : request.method];
    if (!handler) return new Response(null, { status: 405 });
    const response = await handler(request, env); // env carries the KV namespace (AUTH_KV)
    // A private bucket: the download function names the file as r2://<bucket>/<path>; we stream it.
    const to = response.headers.get('Location');
    if (response.status === 302 && to?.startsWith('r2://') && env?.DOWNLOADS) {
      return streamFromR2(request, env.DOWNLOADS, decodeURIComponent(new URL(to).pathname.replace(/^\/+/, '')));
    }
    return response;
  },
};
