// Passwordless sign-in: an email, a 6-digit code, and a signed cookie. Everything here is plain
// functions on Web Crypto, so it runs the same on Cloudflare, Vercel and Node.

const enc = new TextEncoder();

export const CODE_TTL = 600; // a code works for 10 minutes
export const MAX_ATTEMPTS = 5; // wrong guesses before a code is thrown away
export const SESSION_DAYS = 30;
export const COOKIE = 'scorpion_session';

// The address as a lowercase string, or null when it isn't an email address.
export function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// Six digits, every one equally likely (numbers that would favour small codes are redrawn).
export function makeCode() {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0xffffffff / 1e6) * 1e6;
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return String(buf[0] % 1e6).padStart(6, '0');
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

export async function hmacHex(secret, message) {
  return [...(await hmac(secret, message))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Compares two strings without stopping at the first difference.
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// What is kept to check a code: never the code itself.
export async function hashCode(code, email, secret) {
  return b64url(await hmac(secret, `code:${email}:${code}`));
}

// A session is "<payload>.<signature>": the address and when it ends, signed so it can't be edited.
export async function signSession(email, expiresAt, secret) {
  const body = b64url(enc.encode(JSON.stringify({ e: email, x: expiresAt })));
  return `${body}.${b64url(await hmac(secret, `session:${body}`))}`;
}

// The signed-in address, or null for a missing, edited or expired session.
export async function readSession(token, secret, now = Date.now()) {
  if (!token || !secret) return null;
  const [body, sig, extra] = String(token).split('.');
  if (!body || !sig || extra !== undefined) return null;
  const expected = b64url(await hmac(secret, `session:${body}`));
  if (!safeEqual(sig, expected)) return null;
  try {
    const { e, x } = JSON.parse(new TextDecoder().decode(unb64url(body)));
    return typeof e === 'string' && typeof x === 'number' && x > now ? e : null;
  } catch {
    return null;
  }
}

export function cookieOf(request, name = COOKIE) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

const secure = (request) => new URL(request.url).protocol === 'https:';

export function sessionCookie(request, token) {
  return `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure(request) ? '; Secure' : ''}`;
}

export function clearedCookie(request) {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure(request) ? '; Secure' : ''}`;
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
}

// Counts a try against `key`; false once there have been `limit` of them within `seconds`.
export async function allow(kv, key, limit, seconds) {
  const used = Number(await kv.get(key)) || 0;
  if (used >= limit) return false;
  await kv.put(key, String(used + 1), { expirationTtl: seconds });
  return true;
}

// POST bodies must be JSON: a web page on another site can't send that without the browser asking us first.
export const isJson = (request) => (request.headers.get('content-type') || '').toLowerCase().startsWith('application/json');

// Stripe signs each webhook: "t=<time>,v1=<signature>" over "<time>.<body>".
export async function verifyStripeSignature(rawBody, header, secret, now = Date.now(), toleranceSeconds = 300) {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const time = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!time || !signatures.length || Math.abs(now / 1000 - time) > toleranceSeconds) return false;
  const expected = await hmacHex(secret, `${time}.${rawBody}`);
  return signatures.some((s) => safeEqual(s, expected));
}
