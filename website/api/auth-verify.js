// POST /api/auth-verify  { email, code }  ->  signs the customer in (a cookie) when the code is right.

import { MAX_ATTEMPTS, SESSION_DAYS, allow, clientIp, hashCode, isJson, normalizeEmail, safeEqual, sessionCookie, signSession } from '../lib/auth.js';
import { kvFor } from '../lib/kv.js';
import { json } from '../lib/stripe.js';

export async function POST(request, env) {
  const secret = process.env.SESSION_SECRET;
  const kv = kvFor(env);
  if (!secret || !kv) return json({ demo: true, error: 'Signing in is not switched on yet.' }, 503);
  if (!isJson(request)) return json({ error: 'Send the code as JSON.' }, 415);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send the code as JSON.' }, 400); }

  const email = normalizeEmail(body?.email);
  const code = String(body?.code ?? '').replace(/\s+/g, '');
  if (!email || !/^\d{6}$/.test(code)) return json({ error: 'Enter the 6-digit code from the email.' }, 400);
  if (!(await allow(kv, `limit:verify:${clientIp(request)}`, 30, 3600))) {
    return json({ error: 'Too many tries. Please wait a while and try again.' }, 429);
  }

  const key = `code:${email}`;
  const record = JSON.parse((await kv.get(key)) || 'null');
  if (!record) return json({ error: 'That code has expired, or none was sent. Ask for a new one.' }, 400);

  if (!safeEqual(await hashCode(code, email, secret), record.h)) {
    record.a += 1;
    if (record.a >= MAX_ATTEMPTS) {
      await kv.delete(key);
      return json({ error: 'Too many wrong codes. Ask for a new one.' }, 429);
    }
    await kv.put(key, JSON.stringify(record), { expirationTtl: Math.max(60, Math.ceil((record.x - Date.now()) / 1000)) });
    const left = MAX_ATTEMPTS - record.a;
    return json({ error: `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` }, 400);
  }

  await kv.delete(key); // a code works once
  const token = await signSession(email, Date.now() + SESSION_DAYS * 86400000, secret);
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', sessionCookie(request, token));
  return new Response(JSON.stringify({ ok: true, email }), { status: 200, headers });
}
