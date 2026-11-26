// A thin client for the two Stripe calls the store makes. Uses fetch, so the
// site needs no npm packages.

import { toForm } from './orders.js';

// STRIPE_API_BASE points the same code at a fake Stripe, for local tests.
const api = () => process.env.STRIPE_API_BASE || 'https://api.stripe.com/v1';

export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);

async function stripe(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${api()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? toForm(body).toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe returned ${res.status}`);
  return data;
}

export const createCheckoutSession = (params) =>
  stripe('/checkout/sessions', { method: 'POST', body: params });

export const getCheckoutSession = (id) =>
  stripe(`/checkout/sessions/${encodeURIComponent(id)}`);

// Every paid Checkout Session whose customer email is one of `emails` (Stripe matches the address exactly,
// capitals included, so the sign-in form's address is tried as typed as well as lowercase).
export async function listPaidOrdersByEmail(emails) {
  const found = new Map();
  for (const email of emails) {
    const query = new URLSearchParams({ 'customer_details[email]': email, status: 'complete', limit: '100' });
    const page = await stripe(`/checkout/sessions?${query}`);
    for (const session of page.data || []) if (session.payment_status === 'paid') found.set(session.id, session);
  }
  return [...found.values()];
}

// Checkout session ids look like cs_test_... or cs_live_...
export const validSessionId = (id) => typeof id === 'string' && /^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(id);

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
