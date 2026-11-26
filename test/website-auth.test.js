import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeCode, normalizeEmail, readSession, signSession, verifyStripeSignature } from '../website/lib/auth.js';
import { resetMemoryKV } from '../website/lib/kv.js';
import * as authRequest from '../website/api/auth-request.js';
import * as authVerify from '../website/api/auth-verify.js';
import * as authLogout from '../website/api/auth-logout.js';
import * as library from '../website/api/library.js';
import * as order from '../website/api/order.js';
import * as webhook from '../website/api/stripe-webhook.js';
import worker from '../website/worker.js';

const SECRET = 'a-long-test-secret';
const WEBHOOK_SECRET = 'whsec_test';
const BUYER = 'jane@mail.com';

const paidSession = (id, email, extra = {}) => ({
  id, payment_status: 'paid', status: 'complete', created: 1790000000,
  customer_details: { email },
  metadata: { edition: 'standard', platform: 'win', version: '0.1.8' },
  ...extra,
});

let mails;
let stripeSessions;
let realFetch;

// Stripe (matching an address exactly, capitals included, as the real API does) and Resend, both fake.
function fakeFetch(url, init) {
  const u = new URL(url);
  if (u.hostname === 'api.resend.com') {
    mails.push(JSON.parse(init.body));
    return Promise.resolve(new Response('{"id":"1"}', { status: 200 }));
  }
  if (u.hostname === 'api.stripe.com' && u.pathname === '/v1/checkout/sessions') {
    const email = u.searchParams.get('customer_details[email]');
    const data = stripeSessions.filter((s) => s.customer_details.email === email);
    return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));
  }
  const id = u.pathname.split('/').pop();
  const found = stripeSessions.find((s) => s.id === id);
  return Promise.resolve(new Response(JSON.stringify(found || { error: { message: 'No such session' } }), { status: found ? 200 : 404 }));
}

beforeEach(() => {
  resetMemoryKV();
  mails = [];
  stripeSessions = [paidSession('cs_test_abcdefghij1234567890', BUYER)];
  Object.assign(process.env, { SESSION_SECRET: SECRET, STRIPE_SECRET_KEY: 'sk_test_x', RESEND_API_KEY: 're_x', MAIL_FROM: 'Scorpion <login@scorpionai.tech>' });
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_API_BASE;
  delete process.env.RESEND_API_BASE;
  realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
});
import { afterEach } from 'node:test';
afterEach(() => { globalThis.fetch = realFetch; });

const post = (mod, body, { url = 'https://site.test/api/x', headers = {}, env } = {}) =>
  mod.POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4', ...headers }, body: JSON.stringify(body) }), env);
const getLibrary = (cookie, env) => library.GET(new Request('https://site.test/api/library', { headers: cookie ? { cookie } : {} }), env);
const cookieFrom = (res) => (res.headers.get('set-cookie') || '').split(';')[0];
const lastCode = () => /\b(\d{6})\b/.exec(mails.at(-1).text)[1];

test('emails are lowercased and checked, and codes are six digits', () => {
  assert.equal(normalizeEmail('  Jane@Mail.COM '), 'jane@mail.com');
  for (const bad of ['', 'jane', 'jane@', '@mail.com', 'a b@mail.com', 'jane@mail', null]) assert.equal(normalizeEmail(bad), null, String(bad));
  for (let i = 0; i < 200; i += 1) assert.match(makeCode(), /^\d{6}$/);
});

test('a session is valid until it ends, and an edited or foreign one is not', async () => {
  const token = await signSession(BUYER, Date.now() + 60000, SECRET);
  assert.equal(await readSession(token, SECRET), BUYER);
  assert.equal(await readSession(token, 'another-secret'), null);
  assert.equal(await readSession(`${token.slice(0, -2)}xx`, SECRET), null);
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ e: 'boss@mail.com', x: Date.now() + 60000 })).toString('base64url');
  assert.equal(await readSession(`${forged}.${sig}`, SECRET), null);
  assert.equal(await readSession(`${body}.${sig}.extra`, SECRET), null);
  assert.equal(await readSession(await signSession(BUYER, Date.now() - 1, SECRET), SECRET), null);
  assert.equal(await readSession(null, SECRET), null);
});

test('Stripe signatures: right secret, fresh time, exact body', async () => {
  const body = '{"type":"x"}';
  const t = Math.floor(Date.now() / 1000);
  const sign = (secret, time, text) => createHmac('sha256', secret).update(`${time}.${text}`).digest('hex');
  assert.equal(await verifyStripeSignature(body, `t=${t},v1=${sign(WEBHOOK_SECRET, t, body)}`, WEBHOOK_SECRET), true);
  assert.equal(await verifyStripeSignature(body, `t=${t},v1=${sign('wrong', t, body)}`, WEBHOOK_SECRET), false);
  assert.equal(await verifyStripeSignature(`${body} `, `t=${t},v1=${sign(WEBHOOK_SECRET, t, body)}`, WEBHOOK_SECRET), false);
  const old = t - 3600;
  assert.equal(await verifyStripeSignature(body, `t=${old},v1=${sign(WEBHOOK_SECRET, old, body)}`, WEBHOOK_SECRET), false);
  assert.equal(await verifyStripeSignature(body, null, WEBHOOK_SECRET), false);
});

test('a buyer is emailed a code; a stranger gets the very same answer and no email', async () => {
  const yes = await post(authRequest, { email: 'Jane@Mail.com' });
  assert.equal(yes.status, 200);
  const sent = await yes.json();
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].to, [BUYER]);
  assert.match(mails[0].subject, /sign-in code/);
  assert.match(lastCode(), /^\d{6}$/);

  const no = await post(authRequest, { email: 'stranger@mail.com' });
  assert.equal(no.status, 200);
  assert.deepEqual(await no.json(), sent);
  assert.equal(mails.length, 1); // nothing was sent to the stranger
});

test('bad requests: not JSON, not an email, not switched on', async () => {
  const plain = await authRequest.POST(new Request('https://site.test/api/x', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'email=a@b.co' }));
  assert.equal(plain.status, 415);
  assert.equal((await post(authRequest, { email: 'nope' })).status, 400);
  delete process.env.RESEND_API_KEY;
  const off = await post(authRequest, { email: BUYER });
  assert.equal(off.status, 503);
  assert.equal((await off.json()).demo, true);
  assert.equal(mails.length, 0);
});

test('the whole way in: code, cookie, then the downloads', async () => {
  await post(authRequest, { email: BUYER });
  const res = await post(authVerify, { email: BUYER, code: lastCode() }, { url: 'https://site.test/api/auth-verify' });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);

  const lib = await getLibrary(cookieFrom(res));
  assert.equal(lib.status, 200);
  const { email, orders } = await lib.json();
  assert.equal(email, BUYER);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].edition.name, 'Standard');
  assert.match(orders[0].files[0].href, /^\/api\/download\?session_id=cs_test_abcdefghij1234567890&file=win$/);

  assert.equal((await getLibrary(null)).status, 401);
  assert.equal((await getLibrary(`scorpion_session=${cookieFrom(res).split('=')[1]}x`)).status, 401);
});

test('a code works once, and five wrong guesses throw it away', async () => {
  await post(authRequest, { email: BUYER });
  const code = lastCode();
  assert.equal((await post(authVerify, { email: BUYER, code })).status, 200);
  const again = await post(authVerify, { email: BUYER, code });
  assert.equal(again.status, 400); // already used

  resetMemoryKV();
  await post(authRequest, { email: BUYER });
  const real = lastCode();
  const wrong = real === '000000' ? '111111' : '000000';
  for (let i = 1; i <= 4; i += 1) {
    const r = await post(authVerify, { email: BUYER, code: wrong });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /not right/);
  }
  assert.equal((await post(authVerify, { email: BUYER, code: wrong })).status, 429);
  assert.equal((await post(authVerify, { email: BUYER, code: real })).status, 400); // gone, even the right one
});

test('sixth code request for one address within the hour is turned away; a second within a minute sends nothing', async () => {
  const first = await post(authRequest, { email: BUYER });
  assert.equal(first.status, 200);
  await post(authRequest, { email: BUYER });
  assert.equal(mails.length, 1);
  for (let i = 0; i < 3; i += 1) await post(authRequest, { email: BUYER });
  const sixth = await post(authRequest, { email: BUYER });
  assert.equal(sixth.status, 429);
});

test('the signed-in page finds an order whatever capitals the customer typed (the webhook index)', async () => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  stripeSessions = [paidSession('cs_test_capitals1234567890', 'Jane@Mail.com')]; // Stripe would not match 'jane@mail.com'
  const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: stripeSessions[0] } });
  const t = Math.floor(Date.now() / 1000);
  const signature = `t=${t},v1=${createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${event}`).digest('hex')}`;

  const bad = await webhook.POST(new Request('https://site.test/api/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=00' }, body: event }));
  assert.equal(bad.status, 400);
  const good = await webhook.POST(new Request('https://site.test/api/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': signature }, body: event }));
  assert.equal(good.status, 200);

  await post(authRequest, { email: 'jane@mail.com' });
  assert.equal(mails.length, 1);
  const res = await post(authVerify, { email: 'jane@mail.com', code: lastCode() });
  const { orders } = await (await getLibrary(cookieFrom(res))).json();
  assert.equal(orders[0].id, 'cs_test_capitals1234567890');
});

test('an unpaid order is never listed or indexed', async () => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const unpaid = paidSession('cs_test_unpaid1234567890', 'unpaid@mail.com', { payment_status: 'unpaid' });
  const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: unpaid } });
  const t = Math.floor(Date.now() / 1000);
  const signature = `t=${t},v1=${createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${event}`).digest('hex')}`;
  await webhook.POST(new Request('https://site.test/api/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': signature }, body: event }));
  stripeSessions = [unpaid];
  await post(authRequest, { email: 'unpaid@mail.com' });
  assert.equal(mails.length, 0);
});

test('the payment-success page adds the order to the downloads too, and signing out clears the cookie', async () => {
  const res = await order.GET(new Request('https://site.test/api/order?session_id=cs_test_abcdefghij1234567890'));
  assert.equal(res.status, 200);
  const { orders } = await (await (async () => {
    await post(authRequest, { email: BUYER });
    const verify = await post(authVerify, { email: BUYER, code: lastCode() });
    return getLibrary(cookieFrom(verify));
  })()).json();
  assert.equal(orders.length, 1);

  const out = await authLogout.POST(new Request('https://site.test/api/auth-logout', { method: 'POST' }));
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
});

test('on Cloudflare, signing in refuses to run without its KV namespace and runs with it', async () => {
  const off = await worker.fetch(new Request('https://site.test/api/auth-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: BUYER }) }), {});
  assert.equal(off.status, 503);

  const store = new Map();
  const AUTH_KV = {
    async get(k) { return store.get(k) ?? null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
  };
  const on = await worker.fetch(new Request('https://site.test/api/auth-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: BUYER }) }), { AUTH_KV });
  assert.equal(on.status, 200);
  assert.equal(mails.length, 1);
  assert.ok([...store.keys()].some((k) => k.startsWith('code:')));
  assert.ok(![...store.values()].some((v) => v.includes(lastCode())), 'the code itself is never stored');
});
