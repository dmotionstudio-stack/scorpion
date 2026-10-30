// POST /api/checkout  { edition?, platform?, usb? }  ->  { url }
// Prices the order from the catalog and opens a Stripe Checkout page for it.

import { checkoutSessionParams, priceOrder } from '../lib/orders.js';
import { createCheckoutSession, json, stripeConfigured } from '../lib/stripe.js';

export async function POST(request) {
  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Send the order as JSON.' }, 400);
  }

  const priced = priceOrder(input);
  if (!priced.ok) return json({ error: priced.error }, 400);

  if (!stripeConfigured()) {
    return json({ demo: true, error: 'Payments are not switched on yet: STRIPE_SECRET_KEY is not set.' }, 503);
  }

  const origin = process.env.SITE_URL || new URL(request.url).origin;
  try {
    const session = await createCheckoutSession(checkoutSessionParams(priced.order, origin));
    return json({ url: session.url });
  } catch (err) {
    console.error('checkout failed:', err.message);
    return json({ error: 'Could not start the payment. Please try again.' }, 502);
  }
}
