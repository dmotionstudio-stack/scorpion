// POST /api/stripe-webhook  ->  Stripe tells us an order was paid, and it joins the customer's downloads.
// In Stripe: Developers, Webhooks, add this address with the events checkout.session.completed and
// checkout.session.async_payment_succeeded, and keep its signing secret as STRIPE_WEBHOOK_SECRET.

import { verifyStripeSignature } from '../lib/auth.js';
import { kvFor } from '../lib/kv.js';
import { indexOrder } from '../lib/library.js';
import { json } from '../lib/stripe.js';

export async function POST(request, env) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const kv = kvFor(env);
  if (!secret || !kv) return json({ error: 'The webhook is not set up yet.' }, 503);

  const raw = await request.text(); // the signature covers these exact bytes
  if (!(await verifyStripeSignature(raw, request.headers.get('stripe-signature'), secret))) {
    return json({ error: 'The signature does not match.' }, 400);
  }
  let event;
  try { event = JSON.parse(raw); } catch { return json({ error: 'That is not JSON.' }, 400); }

  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
    await indexOrder(kv, event.data?.object || {});
  }
  return json({ received: true });
}
