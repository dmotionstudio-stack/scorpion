// POST /api/auth-request  { email }  ->  emails a 6-digit sign-in code, if that address has a paid order.
//
// The answer is the same whether or not the address has bought anything, so this can't be used to find out who
// the customers are, and no code is ever sent to an address that hasn't bought (nobody can use this to spam people).

import { CODE_TTL, allow, clientIp, hashCode, isJson, makeCode, normalizeEmail } from '../lib/auth.js';
import { kvFor } from '../lib/kv.js';
import { ordersFor } from '../lib/library.js';
import { mailConfigured, sendSignInCode } from '../lib/mailer.js';
import { json, stripeConfigured } from '../lib/stripe.js';

const REPLY = { ok: true, message: 'If that address has a purchase, we have emailed it a 6-digit code. It works for 10 minutes.' };

export async function POST(request, env) {
  const secret = process.env.SESSION_SECRET;
  const kv = kvFor(env);
  if (!secret || !kv || !mailConfigured() || !stripeConfigured()) {
    return json({ demo: true, error: 'Signing in is not switched on yet.' }, 503);
  }
  if (!isJson(request)) return json({ error: 'Send the email as JSON.' }, 415);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send the email as JSON.' }, 400); }

  const typed = String(body?.email ?? '').trim();
  const email = normalizeEmail(typed);
  if (!email) return json({ error: 'Enter a valid email address.' }, 400);

  const withinLimits = (await allow(kv, `limit:ip:${clientIp(request)}`, 20, 3600))
    && (await allow(kv, `limit:email:${email}`, 5, 3600));
  if (!withinLimits) return json({ error: 'Too many tries. Please wait a while and try again.' }, 429);

  // A code went out in the last minute: the same answer, and nothing more is sent.
  if (await kv.get(`sent:${email}`)) return json(REPLY);

  let orders;
  try {
    orders = await ordersFor(kv, email, typed);
  } catch (err) {
    console.error('order lookup failed:', err.message);
    return json({ error: 'We could not check right now. Please try again in a moment.' }, 502);
  }

  if (orders.length) {
    const code = makeCode();
    const expires = Date.now() + CODE_TTL * 1000;
    await kv.put(`code:${email}`, JSON.stringify({ h: await hashCode(code, email, secret), a: 0, x: expires }), { expirationTtl: CODE_TTL });
    await kv.put(`sent:${email}`, '1', { expirationTtl: 60 });
    try {
      if (!(await sendSignInCode(email, code))) console.error('the sign-in email was refused by the mail service');
    } catch (err) {
      console.error('the sign-in email failed:', err.message);
    }
  }
  return json(REPLY);
}
