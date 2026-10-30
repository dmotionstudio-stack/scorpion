// GET /api/order?session_id=cs_...  ->  what was bought and what it can download.
// The success page calls this after Stripe sends the buyer back.

import { findEdition, findStick } from '../data/catalog.js';
import { filesForOrder } from '../lib/orders.js';
import { getCheckoutSession, json, stripeConfigured, validSessionId } from '../lib/stripe.js';

export async function GET(request) {
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

  const meta = session.metadata || {};
  const edition = findEdition(meta.edition);
  const stick = findStick(meta.usb);
  const { version, files } = filesForOrder(meta);
  const shipping = session.shipping_details || session.collected_information?.shipping_details || null;

  return json({
    email: session.customer_details?.email || null,
    edition: edition ? { name: edition.name, lifetime: edition.lifetime } : null,
    version,
    files: files.map(({ key, label, file }) => ({
      label,
      file,
      href: `/api/download?session_id=${encodeURIComponent(id)}&file=${encodeURIComponent(key)}`,
    })),
    usb: stick ? { name: stick.name, shipTo: shipping?.address?.city ? `${shipping.name}, ${shipping.address.city}, ${shipping.address.country}` : null } : null,
  });
}
