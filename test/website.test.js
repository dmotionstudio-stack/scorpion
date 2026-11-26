import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_VERSION, EDITIONS, USB_STICKS } from '../website/data/catalog.js';
import { checkoutSessionParams, filesForOrder, priceOrder, toForm } from '../website/lib/orders.js';

test('prices come from the catalog, not the request', () => {
  const r = priceOrder({ edition: 'complete', price: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.order.subtotal, EDITIONS.find((e) => e.id === 'complete').price);
});

test('standard needs a platform, the others do not', () => {
  assert.equal(priceOrder({ edition: 'standard' }).ok, false);
  assert.equal(priceOrder({ edition: 'standard', platform: 'beos' }).ok, false);
  assert.equal(priceOrder({ edition: 'standard', platform: 'mac-arm' }).ok, true);
  assert.equal(priceOrder({ edition: 'lifetime', platform: 'nonsense' }).order.metadata.platform, '');
});

test('unknown items and empty orders are refused', () => {
  assert.equal(priceOrder({}).ok, false);
  assert.equal(priceOrder({ edition: 'gold' }).ok, false);
  assert.equal(priceOrder({ usb: 'usb-1tb' }).ok, false);
});

test('an edition with a USB stick charges both and collects a shipping address', () => {
  const stick = USB_STICKS[0];
  const r = priceOrder({ edition: 'complete', usb: stick.id });
  assert.equal(r.order.items.length, 2);
  assert.equal(r.order.ships, true);
  const params = checkoutSessionParams(r.order, 'https://example.com');
  assert.ok(params.shipping_address_collection.allowed_countries.includes('US'));
  assert.ok(params.shipping_options.length > 0);
  assert.equal(params.success_url, 'https://example.com/success.html?session_id={CHECKOUT_SESSION_ID}');
});

test('download-only orders do not ask for an address', () => {
  const params = checkoutSessionParams(priceOrder({ edition: 'lifetime' }).order, 'https://example.com');
  assert.equal(params.shipping_address_collection, undefined);
});

test('Stripe form encoding uses bracketed keys', () => {
  const form = toForm({ line_items: [{ price_data: { unit_amount: 2900 } }], mode: 'payment' });
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '2900');
  assert.equal(form.get('mode'), 'payment');
});

test('Standard downloads only its platform, at the version bought', () => {
  const { version, files } = filesForOrder({ edition: 'standard', platform: 'win', version: '0.1.5' });
  assert.equal(version, '0.1.5');
  assert.deepEqual(files.map((f) => f.key), ['win']);
  assert.equal(files[0].file, 'Scorpion Setup 0.1.5.exe');
});

test('Linux buyers get the .deb and the AppImage', () => {
  const { files } = filesForOrder({ edition: 'standard', platform: 'linux', version: '0.1.8' });
  assert.deepEqual(files.map((f) => f.file), ['scorpion_0.1.8_amd64.deb', 'Scorpion-0.1.8.AppImage']);
});

test('Complete gets every installer, the model pack and Scorpion OS; Lifetime follows the newest version', () => {
  const complete = filesForOrder({ edition: 'complete', version: '0.1.5' });
  assert.deepEqual(complete.files.map((f) => f.key), ['win', 'mac-arm', 'mac-intel', 'linux-deb', 'linux-appimage', 'models', 'os']);
  assert.equal(filesForOrder({ edition: 'lifetime', version: '0.1.5' }).version, CURRENT_VERSION);
});

test('a USB-only order has nothing to download', () => {
  assert.deepEqual(filesForOrder({ usb: 'usb-64' }).files, []);
});

test('the website orb is an exact copy of the app orb', async () => {
  const { readFile } = await import('node:fs/promises');
  const [app, site] = await Promise.all([
    readFile(new URL('../src/renderer/orb.js', import.meta.url), 'utf8'),
    readFile(new URL('../website/assets/orb/orb.js', import.meta.url), 'utf8'),
  ]);
  assert.equal(site, app, 'copy src/renderer/orb.js to website/assets/orb/orb.js');
});

test('the website humanoid is an exact copy of the app humanoid', async () => {
  const { readFile } = await import('node:fs/promises');
  const [app, site] = await Promise.all([
    readFile(new URL('../src/renderer/humanoid.js', import.meta.url), 'utf8'),
    readFile(new URL('../website/assets/orb/humanoid.js', import.meta.url), 'utf8'),
  ]);
  assert.equal(site, app, 'copy src/renderer/humanoid.js to website/assets/orb/humanoid.js');
});

test('every page link and image on the website points at a file that exists', async () => {
  const { readdir, readFile, access } = await import('node:fs/promises');
  const root = new URL('../website/', import.meta.url);
  const pages = (await readdir(root)).filter((f) => f.endsWith('.html'));
  const missing = [];
  for (const page of pages) {
    const html = await readFile(new URL(page, root), 'utf8');
    for (const [, ref] of html.matchAll(/(?:href|src)="([^"#?]+)(?:[#?][^"]*)?"/g)) {
      if (/^(https?:|mailto:|data:)/.test(ref) || ref.includes('${')) continue; // placeholders filled in by scripts
      await access(new URL(ref, root)).catch(() => missing.push(`${page} -> ${ref}`));
    }
  }
  assert.deepEqual(missing, []);
});

test('every USB stick on sale has a product image', async () => {
  const { access } = await import('node:fs/promises');
  for (const stick of USB_STICKS) {
    await access(new URL(`../website/assets/${stick.id}.svg`, import.meta.url));
  }
});

test('every USB stick on sale has a white-background listing image too', async () => {
  const { access } = await import('node:fs/promises');
  for (const stick of USB_STICKS) {
    await access(new URL(`../website/assets/${stick.id}-listing.svg`, import.meta.url));
  }
});
