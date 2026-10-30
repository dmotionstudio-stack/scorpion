// GET /api/download?session_id=cs_...&file=win  ->  302 to the installer.
// Checks with Stripe that the order is paid and includes that file every time,
// so the link keeps working for the buyer and for nobody else's order.

import { filesForOrder } from '../lib/orders.js';
import { getCheckoutSession, json, stripeConfigured, validSessionId } from '../lib/stripe.js';

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const id = params.get('session_id');
  const key = params.get('file');
  if (!validSessionId(id)) return json({ error: 'This download link is not valid.' }, 400);
  if (!stripeConfigured()) return json({ demo: true, error: 'Payments are not switched on yet.' }, 503);

  const base = process.env.DOWNLOAD_BASE_URL;
  if (!base) return json({ error: 'Downloads are not set up yet. Please contact support.' }, 503);

  let session;
  try {
    session = await getCheckoutSession(id);
  } catch {
    return json({ error: 'We could not find this order.' }, 404);
  }
  if (session.payment_status !== 'paid') return json({ error: 'This order has not been paid yet.' }, 402);

  const { version, files } = filesForOrder(session.metadata);
  const match = files.find((f) => f.key === key);
  if (!match) return json({ error: 'That file is not part of this order.' }, 403);

  // Files live at <DOWNLOAD_BASE_URL>/<version>/<file name>.
  const target = `${base.replace(/\/+$/, '')}/${encodeURIComponent(version)}/${encodeURIComponent(match.file)}`;
  return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
}
