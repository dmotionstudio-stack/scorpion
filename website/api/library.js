// GET /api/library  ->  the signed-in customer's paid orders, each with its download links (401 when signed out).

import { cookieOf, readSession } from '../lib/auth.js';
import { kvFor } from '../lib/kv.js';
import { ordersFor } from '../lib/library.js';
import { json } from '../lib/stripe.js';

export async function GET(request, env) {
  const secret = process.env.SESSION_SECRET;
  const kv = kvFor(env);
  if (!secret || !kv) return json({ demo: true, error: 'Signing in is not switched on yet.' }, 503);

  const email = await readSession(cookieOf(request), secret);
  if (!email) return json({ error: 'Please sign in.' }, 401);

  try {
    return json({ email, orders: await ordersFor(kv, email) });
  } catch (err) {
    console.error('library lookup failed:', err.message);
    return json({ error: 'We could not load your downloads right now. Please try again in a moment.' }, 502);
  }
}
