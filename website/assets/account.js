// My downloads: sign in with an email and a 6-digit code, then see every paid order with its download links.

import { escapeHtml } from './site.js';

const $ = (sel, root = document) => root.querySelector(sel);
const views = Object.fromEntries([...document.querySelectorAll('[data-view]')].map((el) => [el.dataset.view, el]));
const show = (name) => { for (const [key, el] of Object.entries(views)) el.hidden = key !== name; };
const say = (view, text) => { $('[data-error]', views[view]).innerHTML = text ? `<div class="alert error">${escapeHtml(text)}</div>` : ''; };

let email = '';
let waitTimer = null;

// Calls the site's own functions. A static copy of the site (no server) answers 404 or 405.
async function call(path, options) {
  let res;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...options });
  } catch {
    return { ok: false, status: 0, data: { error: 'We could not reach the server. Check your connection and try again.' } };
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 404 || res.status === 405) data.error = 'Signing in is not available on this copy of the site.';
  return { ok: res.ok, status: res.status, data };
}
const postJson = (path, body) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function startWait(seconds = 60) {
  clearInterval(waitTimer);
  const resend = $('[data-resend]');
  const wait = $('[data-wait]');
  let left = seconds;
  resend.disabled = true;
  const tick = () => {
    if (left <= 0) { clearInterval(waitTimer); resend.disabled = false; wait.textContent = 'ready'; return; }
    wait.textContent = `in ${left}s`;
    left -= 1;
  };
  tick();
  waitTimer = setInterval(tick, 1000);
}

async function requestCode() {
  const { ok, data } = await postJson('/api/auth-request', { email });
  return { ok, error: ok ? '' : data.error || 'Something went wrong. Please try again.' };
}

views.email.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('button[type=submit]', views.email);
  email = views.email.email.value.trim();
  say('email', '');
  if (!email) { say('email', 'Enter your email address.'); return; }
  button.disabled = true;
  button.textContent = 'Sending...';
  const result = await requestCode();
  button.disabled = false;
  button.textContent = 'Email me a code';
  if (!result.ok) { say('email', result.error); return; }
  $('[data-sent-to]').textContent = email;
  views.code.code.value = '';
  say('code', '');
  show('code');
  startWait();
  views.code.code.focus();
});

views.code.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('button[type=submit]', views.code);
  const code = views.code.code.value.replace(/\s+/g, '');
  say('code', '');
  if (!/^\d{6}$/.test(code)) { say('code', 'Enter the 6-digit code from the email.'); return; }
  button.disabled = true;
  button.textContent = 'Checking...';
  const { ok, data } = await postJson('/api/auth-verify', { email, code });
  button.disabled = false;
  button.textContent = 'Sign in';
  if (!ok) { say('code', data.error || 'Something went wrong. Please try again.'); return; }
  await loadLibrary();
});

// A code typed or pasted with spaces ("123 456") is tidied as it goes in, and sent when all six digits are there.
views.code.code.addEventListener('input', () => {
  const field = views.code.code;
  field.value = field.value.replace(/[^\d\s]/g, '');
  if (field.value.replace(/\s+/g, '').length === 6) views.code.requestSubmit();
});

$('[data-resend]').addEventListener('click', async () => {
  say('code', '');
  const result = await requestCode();
  if (!result.ok) { say('code', result.error); return; }
  startWait();
  views.code.code.focus();
});

$('[data-change]').addEventListener('click', () => { clearInterval(waitTimer); show('email'); views.email.email.focus(); });

$('[data-signout]').addEventListener('click', async () => {
  await postJson('/api/auth-logout', {});
  show('email');
});

const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '');

function renderOrders(orders) {
  if (!orders.length) {
    $('[data-orders]').innerHTML = '<div class="card"><p class="muted" style="margin:0">No paid orders were found for this address.</p></div>';
    return;
  }
  $('[data-orders]').innerHTML = orders.map((o) => `
    <section class="card order">
      <div class="order-head">
        <h2>${o.edition ? `Scorpion ${escapeHtml(o.edition.name)}` : 'Scorpion USB stick'}</h2>
        <span class="muted small">${escapeHtml(when(o.created))}${o.version ? ` &middot; version ${escapeHtml(o.version)}` : ''}</span>
      </div>
      ${o.edition?.lifetime ? '<p class="note" style="margin:0 0 10px">Lifetime: these links always give you the newest version.</p>' : ''}
      <div class="files">${o.files.map((f) => `
        <div class="card file">
          <div><b>${escapeHtml(f.label)}</b><small>${escapeHtml(f.file)}</small></div>
          <a class="btn btn-gold btn-sm" href="${escapeHtml(f.href)}">Download</a>
        </div>`).join('')}</div>
      ${o.usb ? `<p class="muted" style="margin:10px 0 0"><b>${escapeHtml(o.usb.name)}</b>${o.usb.shipTo ? `, shipping to ${escapeHtml(o.usb.shipTo)}` : ''}. We'll email the tracking number when it ships.</p>` : ''}
    </section>`).join('');
}

async function loadLibrary() {
  const { ok, status, data } = await call('/api/library');
  if (ok) {
    $('[data-who]').textContent = data.email;
    renderOrders(data.orders);
    show('library');
    return;
  }
  if (status === 401) { show('email'); return; }
  show('email');
  say('email', data.demo ? 'Signing in is not switched on yet. Please check back soon.' : data.error || 'Something went wrong. Please try again.');
}

loadLibrary();
