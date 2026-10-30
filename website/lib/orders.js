// Turns what the buyer picked into a priced order, and a paid order into the
// files it may download. Prices always come from the catalog, never from the
// browser, so a tampered request can't change what is charged.

import {
  CURRENCY, CURRENT_VERSION, EXTRA_FILES, PLATFORMS, SHIPPING, SHIP_COUNTRIES,
  findEdition, findStick,
} from '../data/catalog.js';

// input: { edition?, platform?, usb?, shipping? }
// Returns { ok: true, order } or { ok: false, error }.
export function priceOrder(input = {}) {
  const edition = input.edition ? findEdition(input.edition) : null;
  const stick = input.usb ? findStick(input.usb) : null;
  if (input.edition && !edition) return { ok: false, error: 'Unknown edition.' };
  if (input.usb && !stick) return { ok: false, error: 'Unknown USB stick.' };
  if (!edition && !stick) return { ok: false, error: 'Choose an edition or a USB stick.' };

  let platform = null;
  if (edition?.choosePlatform) {
    if (!PLATFORMS[input.platform]) return { ok: false, error: 'Choose Windows, Mac or Linux.' };
    platform = input.platform;
  }

  const items = [];
  if (edition) {
    items.push({
      name: `Scorpion ${edition.name}`,
      description: platform
        ? `${PLATFORMS[platform].short}, version ${CURRENT_VERSION}. One-time purchase.`
        : `All platforms, version ${CURRENT_VERSION}${edition.lifetime ? ' and every future version' : ''}. One-time purchase.`,
      amount: edition.price,
    });
  }
  if (stick) {
    items.push({ name: stick.name, description: stick.tagline, amount: stick.price });
  }

  return {
    ok: true,
    order: {
      items,
      subtotal: items.reduce((sum, i) => sum + i.amount, 0),
      ships: Boolean(stick),
      metadata: {
        edition: edition?.id || '',
        platform: platform || '',
        usb: stick?.id || '',
        version: CURRENT_VERSION,
      },
    },
  };
}

// Stripe's API takes form encoding with bracketed keys: a[b][0][c]=d.
export function toForm(value, prefix = '', out = new URLSearchParams()) {
  if (value === undefined || value === null) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => toForm(v, `${prefix}[${i}]`, out));
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) toForm(v, prefix ? `${prefix}[${k}]` : k, out);
  } else {
    out.append(prefix, String(value));
  }
  return out;
}

export function checkoutSessionParams(order, origin) {
  const params = {
    mode: 'payment',
    success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/download.html?cancelled=1`,
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    line_items: order.items.map((item) => ({
      quantity: 1,
      price_data: {
        currency: CURRENCY,
        unit_amount: item.amount,
        product_data: { name: item.name, description: item.description },
      },
    })),
    metadata: order.metadata,
    payment_intent_data: { metadata: order.metadata },
  };
  if (order.ships) {
    params.shipping_address_collection = { allowed_countries: SHIP_COUNTRIES };
    params.phone_number_collection = { enabled: true };
    params.shipping_options = SHIPPING.map((s) => ({
      shipping_rate_data: {
        type: 'fixed_amount',
        display_name: `${s.label} (${s.detail})`,
        fixed_amount: { amount: s.price, currency: CURRENCY },
      },
    }));
  }
  return params;
}

// What a paid order may download. Standard gets its one platform; the others
// get every installer plus their extras. Lifetime follows the newest version.
export function filesForOrder(metadata = {}) {
  const edition = findEdition(metadata.edition);
  if (!edition) return { version: null, files: [] };
  const version = edition.lifetime ? CURRENT_VERSION : (metadata.version || CURRENT_VERSION);
  const platformKeys = edition.choosePlatform
    ? (PLATFORMS[metadata.platform] ? [metadata.platform] : [])
    : Object.keys(PLATFORMS);
  const files = [
    ...platformKeys.flatMap((key) => PLATFORMS[key].files(version)),
    ...edition.extras.map((key) => ({ key, label: EXTRA_FILES[key].label, file: EXTRA_FILES[key].file(version) })),
  ];
  return { version, files };
}
