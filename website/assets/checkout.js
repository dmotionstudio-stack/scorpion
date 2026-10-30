// The Download page: editions, the comparison table, USB sticks, and the
// checkout dialog that hands the order to /api/checkout and on to Stripe.

import {
  CURRENT_VERSION, EDITIONS, EXTRA_FILES, PLATFORMS, SHIPPING, USB_STICKS,
  findEdition, findStick, formatPrice,
} from '../data/catalog.js';
import { escapeHtml } from './site.js';

const $ = (sel, root = document) => root.querySelector(sel);
const minShipping = Math.min(...SHIPPING.map((s) => s.price));

// Editions
$('[data-plans]').innerHTML = EDITIONS.map((e) => `
  <div class="card plan${e.featured ? ' featured' : ''}">
    ${e.featured ? '<span class="badge">Most popular</span>' : ''}
    <h3>${escapeHtml(e.name)}</h3>
    <p class="tagline">${escapeHtml(e.tagline)}</p>
    <div class="price"><strong>${formatPrice(e.price)}</strong><span>one time</span></div>
    <div class="once">${e.lifetime ? 'Every version, forever' : `Version ${CURRENT_VERSION}, forever yours`}</div>
    <ul class="checks">${e.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
    <button class="btn ${e.featured ? 'btn-gold' : ''} btn-block" data-buy-edition="${e.id}">Buy ${escapeHtml(e.name)}</button>
  </div>`).join('');

// Comparison table
const yes = '<span style="color:var(--gold)">&#10003;</span>';
const no = '<span style="color:var(--dim)">&ndash;</span>';
const rows = [
  ['Price, one time', (e) => `<b>${formatPrice(e.price)}</b>`],
  ['Installers', (e) => (e.choosePlatform ? 'Windows, Mac <i>or</i> Linux' : 'Windows, Mac and Linux')],
  ['Chat, agent, voice, memory, the ORB', () => yes],
  ['Ctrl+K; on Windows, Scorpion as your desktop', () => yes],
  [EXTRA_FILES.os.label, (e) => (e.extras.includes('os') ? yes : no)],
  [EXTRA_FILES.models.label, (e) => (e.extras.includes('models') ? yes : no)],
  ['Install with no internet', (e) => (e.extras.includes('models') ? yes : no)],
  ['Future versions', (e) => (e.lifetime ? 'All, free' : no)],
  ['Priority support', (e) => (e.lifetime ? yes : no)],
];
$('[data-compare]').innerHTML = `
  <thead><tr><th></th>${EDITIONS.map((e) => `<th>${escapeHtml(e.name)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(([label, cell]) => `<tr><td>${escapeHtml(label)}</td>${EDITIONS.map((e) => `<td>${cell(e)}</td>`).join('')}</tr>`).join('')}</tbody>`;

// USB sticks
const usbArt = `<svg viewBox="0 0 80 40" fill="none"><rect x="1" y="6" width="56" height="28" rx="6" fill="#2b2615" stroke="#c49000" stroke-width="2"/><rect x="57" y="11" width="21" height="18" rx="2" fill="#3b362d" stroke="#7a7468" stroke-width="2"/><rect x="63" y="15" width="4" height="4" fill="#7a7468"/><rect x="70" y="15" width="4" height="4" fill="#7a7468"/><path d="M14 13 l10 7 -10 7" stroke="#f4c51c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
$('[data-usb]').innerHTML = USB_STICKS.map((s) => `
  <div class="card usb-card">
    <div class="usb-art">${usbArt}</div>
    <div>
      <h3>${escapeHtml(s.name)}</h3>
      <p class="muted" style="margin-bottom:6px">${escapeHtml(s.tagline)}</p>
      <div class="price"><strong>${formatPrice(s.price)}</strong><span>+ shipping from ${formatPrice(minShipping)}</span></div>
      <ul class="checks" style="font-size:.95rem">${s.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
      <button class="btn btn-block" data-buy-usb="${s.id}">Order this stick</button>
    </div>
  </div>`).join('');

// Checkout dialog
const dialog = $('[data-checkout]');
const form = $('[data-checkout-form]');
const state = { edition: null, platform: null, usb: null };

function guessPlatform() {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'win';
  if (/Mac/i.test(ua)) return 'mac-arm';
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux';
  return null;
}

function renderFields() {
  const edition = findEdition(state.edition);
  let html = '';

  if (edition?.choosePlatform) {
    html += `<div class="field"><span class="label">Which computer is it for?</span><div class="options">
      ${Object.entries(PLATFORMS).map(([key, p]) => `
        <label class="option"><input type="radio" name="platform" value="${key}" ${state.platform === key ? 'checked' : ''} required>
          <span class="grow">${escapeHtml(p.short)}<small>${escapeHtml(p.label)}</small></span></label>`).join('')}
      </div><p class="note" style="margin-top:8px">Not sure which Mac? Apple menu, About This Mac: "Chip" means Apple Silicon.</p></div>`;
  }

  const usbLabel = edition ? 'Also ship it on a USB stick?' : 'Which stick?';
  const none = edition ? `
    <label class="option"><input type="radio" name="usb" value="" ${!state.usb ? 'checked' : ''}>
      <span class="grow">No stick, download only</span><span class="amt">${formatPrice(0)}</span></label>` : '';
  html += `<div class="field"><span class="label">${usbLabel}</span><div class="options">${none}
    ${USB_STICKS.map((s) => `
      <label class="option"><input type="radio" name="usb" value="${s.id}" ${state.usb === s.id ? 'checked' : ''}>
        <span class="grow">${escapeHtml(s.name)}<small>${escapeHtml(s.tagline)}</small></span><span class="amt">+${formatPrice(s.price)}</span></label>`).join('')}
    </div></div>`;

  $('[data-co-fields]').innerHTML = html;
}

function renderSummary() {
  const edition = findEdition(state.edition);
  const stick = findStick(state.usb);
  const lines = [];
  if (edition) lines.push([`Scorpion ${edition.name}`, edition.price]);
  if (stick) lines.push([stick.name, stick.price]);
  const total = lines.reduce((sum, [, amount]) => sum + amount, 0);
  $('[data-co-summary]').innerHTML = `
    ${lines.map(([label, amount]) => `<div class="summary-row"><span>${escapeHtml(label)}</span><span>${formatPrice(amount)}</span></div>`).join('')}
    ${stick ? `<div class="summary-row"><span>Shipping</span><span>from ${formatPrice(minShipping)}, chosen next</span></div>` : ''}
    <div class="summary-row total"><span>${stick ? 'Total before shipping' : 'Total, one time'}</span><span>${formatPrice(total)}</span></div>
    ${edition ? '<p class="note">You can download right after paying. Your link keeps working.</p>' : '<p class="note">You will enter your shipping address and pick a shipping speed on the next page.</p>'}`;
}

function showAlert(kind, text) {
  $('[data-co-alert]').innerHTML = text ? `<div class="alert ${kind}">${escapeHtml(text)}</div>` : '';
}

function open({ edition = null, usb = null }) {
  state.edition = edition;
  state.usb = usb;
  state.platform = findEdition(edition)?.choosePlatform ? guessPlatform() : null;
  const e = findEdition(edition);
  $('[data-co-eyebrow]').textContent = e ? 'Buy once, keep forever' : 'Order a USB stick';
  $('[data-co-title]').textContent = e ? `Scorpion ${e.name}` : 'Scorpion on a USB stick';
  renderFields();
  renderSummary();
  showAlert();
  setBusy(false);
  dialog.showModal();
}

function setBusy(busy) {
  const btn = $('[data-co-pay]');
  btn.disabled = busy;
  btn.textContent = busy ? 'Opening secure payment...' : 'Continue to secure payment';
}

form.addEventListener('change', (e) => {
  if (e.target.name === 'platform') state.platform = e.target.value;
  if (e.target.name === 'usb') state.usb = e.target.value || null;
  renderSummary();
  showAlert();
});

form.addEventListener('submit', async (e) => {
  if (e.submitter?.value === 'cancel') return;
  e.preventDefault();
  if (findEdition(state.edition)?.choosePlatform && !state.platform) {
    showAlert('error', 'Choose Windows, Mac or Linux first.');
    return;
  }
  setBusy(true);
  showAlert();
  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edition: state.edition, platform: state.platform, usb: state.usb }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) {
      location.href = data.url;
      return;
    }
    if (data.demo) {
      showAlert('info', 'Payments are not switched on for this site yet. Once the store owner adds a Stripe key, this button opens the secure payment page.');
    } else {
      showAlert('error', data.error || 'Something went wrong. Please try again.');
    }
  } catch {
    showAlert('error', 'Could not reach the payment server. Check your connection and try again.');
  }
  setBusy(false);
});

document.addEventListener('click', (e) => {
  const ed = e.target.closest('[data-buy-edition]');
  if (ed) open({ edition: ed.dataset.buyEdition });
  const usb = e.target.closest('[data-buy-usb]');
  if (usb) open({ usb: usb.dataset.buyUsb });
});

// Links like download.html?edition=complete open that edition straight away.
const params = new URLSearchParams(location.search);
if (params.get('cancelled')) $('[data-cancelled]').hidden = false;
// The cards above render after load, so jump to #usb again now they're in.
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'instant' });
if (findEdition(params.get('edition'))) open({ edition: params.get('edition') });
else if (findStick(params.get('usb'))) open({ usb: params.get('usb') });
