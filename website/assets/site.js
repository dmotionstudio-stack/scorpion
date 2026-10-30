// Shared header, footer and small helpers for every page.

const NAV = [
  ['features.html', 'Features'],
  ['orb.html', 'The ORB'],
  ['os.html', 'Scorpion OS'],
  ['download.html', 'Pricing'],
  ['updates.html', 'Updates'],
  ['guide.html', 'Guide'],
];

const here = location.pathname.split('/').pop() || 'index.html';

function header() {
  const links = NAV.map(([href, label]) => {
    const current = href === here ? ' aria-current="page"' : '';
    return `<a href="${href}"${current}>${label}</a>`;
  }).join('');
  return `
    <div class="wrap">
      <a class="brand" href="index.html"><img src="assets/icon.png" alt="" width="32" height="32">Scorpion</a>
      <nav class="nav" id="site-nav" aria-label="Main">
        ${links}
        <span class="nav-mobile-actions">
          <a class="btn btn-sm btn-outline-gold" href="download.html#usb">Order USB</a>
          <a class="btn btn-gold btn-sm" href="download.html">Download</a>
        </span>
      </nav>
      <div class="header-actions">
        <a class="btn btn-sm btn-outline-gold" href="download.html#usb">Order USB</a>
        <a class="btn btn-gold btn-sm" href="download.html">Download</a>
      </div>
      <button class="menu-btn" aria-expanded="false" aria-controls="site-nav">Menu</button>
    </div>`;
}

function footer() {
  const year = new Date().getFullYear();
  return `
    <div class="wrap">
      <div class="footer-grid">
        <div>
          <a class="brand" href="index.html"><img src="assets/icon.png" alt="" width="28" height="28">Scorpion</a>
          <p style="margin-top:12px;max-width:320px">The AI assistant and agent that runs on your own computer, and a whole operating system of its own. No account, no API key, no internet needed.</p>
        </div>
        <div>
          <h4>Product</h4>
          <ul>
            <li><a href="features.html">Features</a></li>
            <li><a href="orb.html">The ORB</a></li>
            <li><a href="os.html">Scorpion OS</a></li>
            <li><a href="download.html">Pricing and download</a></li>
            <li><a href="download.html#usb">Order a USB stick</a></li>
          </ul>
        </div>
        <div>
          <h4>Learn</h4>
          <ul>
            <li><a href="updates.html">Updates</a></li>
            <li><a href="guide.html">Install guide</a></li>
            <li><a href="guide.html#faq">FAQ</a></li>
          </ul>
        </div>
        <div>
          <h4>Help</h4>
          <ul>
            <li><a href="guide.html#requirements">System requirements</a></li>
            <li><a href="mailto:support@scorpion.app">support@scorpion.app</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <span>&copy; ${year} Scorpion. Pay once, yours forever.</span>
        <span>Your chats never leave your computer.</span>
      </div>
    </div>`;
}

const headerEl = document.querySelector('[data-site-header]');
if (headerEl) {
  headerEl.innerHTML = header();
  const btn = headerEl.querySelector('.menu-btn');
  const nav = headerEl.querySelector('.nav');
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
  });
}
const footerEl = document.querySelector('[data-site-footer]');
if (footerEl) footerEl.innerHTML = footer();

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function formatDate(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
