// A customer's paid orders, for the My downloads page.
//
// Orders are kept in an index (KV) by lowercase email: a Stripe webhook adds each one the moment it is paid, and the
// payment-success page adds the one just bought. Stripe is asked too when the index can't be trusted yet (no webhook
// set up, or the index has nothing for this address), because Stripe's email search is exact about capital letters.

import { orderView } from './orders.js';
import { listPaidOrdersByEmail } from './stripe.js';

const ordersKey = (email) => `orders:${email}`;
const orderKey = (id) => `order:${id}`;

export async function indexOrder(kv, session) {
  const email = String(session.customer_details?.email || '').trim().toLowerCase();
  if (!email || !session.id || session.payment_status !== 'paid') return false;
  await kv.put(orderKey(session.id), JSON.stringify(orderView(session)));
  const ids = JSON.parse((await kv.get(ordersKey(email))) || '[]');
  if (!ids.includes(session.id)) {
    ids.unshift(session.id);
    await kv.put(ordersKey(email), JSON.stringify(ids.slice(0, 50)));
  }
  return true;
}

const newestFirst = (a, b) => String(b.created || '').localeCompare(String(a.created || ''));

// `email` is lowercase; `asTyped` is the address as the customer typed it (it may differ in capitals).
export async function ordersFor(kv, email, asTyped = email) {
  const ids = JSON.parse((await kv.get(ordersKey(email))) || '[]');
  const indexed = (await Promise.all(ids.map(async (id) => JSON.parse((await kv.get(orderKey(id))) || 'null')))).filter(Boolean);
  if (indexed.length && process.env.STRIPE_WEBHOOK_SECRET) return indexed.sort(newestFirst); // the webhook keeps it complete

  let sessions = [];
  try {
    sessions = await listPaidOrdersByEmail([...new Set([email, asTyped])]);
  } catch (err) {
    if (!indexed.length) throw err; // nothing to show, and no way to look: let the caller say so
  }
  await Promise.all(sessions.map((s) => indexOrder(kv, s)));
  const byId = new Map(indexed.map((o) => [o.id, o]));
  for (const s of sessions) byId.set(s.id, orderView(s));
  return [...byId.values()].sort(newestFirst);
}
