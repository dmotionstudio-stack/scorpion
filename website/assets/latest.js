// The free downloads on the Download page: the newest version and a button for each installer, from /api/latest.
const box = document.querySelector('[data-latest]');
const note = document.querySelector('[data-latest-note]');
const FALLBACK = 'https://github.com/dmotionstudio-stack/scorpion/releases/latest';

const size = (bytes) => (bytes >= 1e9 ? (bytes / 1e9).toFixed(1) + ' GB' : Math.round(bytes / 1e6) + ' MB');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function load() {
  if (!box) return;
  try {
    const res = await fetch('/api/latest');
    const data = await res.json();
    if (!res.ok || !data.files?.length) throw new Error(data.error || 'no files');
    const when = data.published ? new Date(data.published).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    if (note) note.textContent = `Version ${data.version}${when ? ', released ' + when : ''}. Everything runs on your computer.`;
    box.innerHTML = data.files.map((f) => `<div class="card" style="text-align:center">
      <h3 style="margin-top:0">${esc(f.short)}</h3>
      <p class="note" style="margin:0 0 14px">${esc(f.label)}</p>
      <a class="btn btn-gold btn-block" href="${esc(f.href)}" download>Download ${esc(size(f.size))}</a>
    </div>`).join('');
  } catch {
    if (note) note.textContent = 'The newest version is on our release page.';
    box.innerHTML = `<div class="card" style="grid-column:1/-1;text-align:center"><a class="btn btn-gold" href="${FALLBACK}">Open the latest release</a></div>`;
  }
}
load();
