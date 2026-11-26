// GET /api/order?session_id=cs_...  ->  what was bought and what it can download.
// The success page calls this after Stripe sends the buyer back; it also puts the order in the customer's
// downloads (the same list they see when they sign in).

import { kvFor } from '../lib/kv.js';
import { indexOrder } from '../lib/library.js';
import { orderView } from '../lib/orders.js';
import { getCheckoutSession, json, stripeConfigured, validSessionId } from '../lib/stripe.js';

export async function GET(request, env) {
  const id = new URL(request.url).searchParams.get('session_id');
  if (!validSessionId(id)) return json({ error: 'This download link is not valid.' }, 400);
  if (!stripeConfigured()) return json({ demo: true, error: 'Payments are not switched on yet.' }, 503);

  let session;
  try {
    session = await getCheckoutSession(id);
  } catch {
    return json({ error: 'We could not find this order.' }, 404);
  }
  if (session.payment_status !== 'paid') {
    return json({ error: 'This order has not been paid yet.', status: session.payment_status }, 402);
  }

  const kv = kvFor(env);
  if (kv) await indexOrder(kv, { ...session, id }).catch((err) => console.error('could not index the order:', err.message));
  return json(orderView(session, id));
}
