// POST /api/auth-logout  ->  signs out on this browser.

import { clearedCookie } from '../lib/auth.js';

export async function POST(request) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', clearedCookie(request));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
