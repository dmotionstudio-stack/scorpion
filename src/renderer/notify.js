// Notifications on Scorpion OS (the native shell host is the session's
// notification server and shows this page as a panel beside the rail):
// a card for each new one for a few seconds (urgent ones stay), and the full
// list when the bell is clicked. Buttons on a card are the app's own actions.
const api = window.scorpion;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ago = (at) => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`; };

let listOpen = false;
const pops = new Map(); // id → timer

// The host makes the panel as tall as what's shown, and hides it when empty.
function fit() {
  const h = Math.ceil(document.body.scrollHeight);
  api.host({ type: 'size', panel: 'notify', height: h, visible: listOpen || pops.size > 0 });
}

function card(n, { list = false } = {}) {
  // Actions come as [key, label, key, label…]; "default" is a click on the card.
  const acts = [];
  for (let i = 0; i + 1 < n.actions.length; i += 2) if (n.actions[i] !== 'default') acts.push([n.actions[i], n.actions[i + 1]]);
  const icon = n.icon && /^(data:|file:)/.test(n.icon) ? `<img class="nt-icon" src="${esc(n.icon)}" alt="">` : `<span class="nt-icon nt-letter">${esc((n.app || n.summary || '?').slice(0, 1).toUpperCase())}</span>`;
  return `<div class="nt-card${n.urgency >= 2 ? ' urgent' : ''}${list ? ' in-list' : ''}" data-id="${n.id}">
    ${icon}
    <div class="nt-text"><div class="nt-top"><span class="nt-app">${esc(n.app)}</span><span class="nt-when">${ago(n.at)}</span></div>
      <div class="nt-summary">${esc(n.summary)}</div>${n.body ? `<div class="nt-body">${esc(n.body)}</div>` : ''}
      ${acts.length ? `<div class="nt-acts">${acts.map(([k, l]) => `<button data-act="${esc(k)}">${esc(l)}</button>`).join('')}</div>` : ''}</div>
    <button class="nt-x" data-close title="Dismiss">×</button>
  </div>`;
}

function showPop(n) {
  if (listOpen) { renderList(); return; }
  $('#nt-pops').insertAdjacentHTML('afterbegin', card(n));
  clearTimeout(pops.get(n.id));
  pops.set(n.id, n.urgency >= 2 ? null : setTimeout(() => dropPop(n.id), 6000));
  while ($('#nt-pops').children.length > 3) dropPop(Number($('#nt-pops').lastElementChild.dataset.id));
  fit();
}
function dropPop(id) {
  clearTimeout(pops.get(id));
  pops.delete(id);
  $(`#nt-pops [data-id="${id}"]`)?.remove();
  fit();
}

async function renderList() {
  const { list = [] } = await api.notifications().catch(() => ({}));
  $('#nt-items').innerHTML = list.length ? list.map((n) => card(n, { list: true })).join('') : '<div class="nt-empty">No notifications</div>';
  fit();
}
async function toggleList(on = !listOpen) {
  listOpen = on;
  $('#nt-list').hidden = !on;
  for (const id of [...pops.keys()]) dropPop(id);
  if (on) await renderList(); else fit();
}

document.addEventListener('click', (e) => {
  const c = e.target.closest('.nt-card');
  if (e.target.id === 'nt-clear') { api.notificationAct({ action: 'clear' }).then(renderList); api.host({ type: 'notifyCloseAll' }); return; }
  if (!c) return;
  const id = Number(c.dataset.id);
  const act = e.target.closest('[data-act]');
  if (act) { api.host({ type: 'notifyAction', id, key: act.dataset.act }); dropPop(id); return; }
  if (e.target.closest('[data-close]')) { api.host({ type: 'notifyClose', id }); api.notificationAct({ action: 'dismiss', id }).then(() => listOpen && renderList()); dropPop(id); return; }
  api.host({ type: 'notifyAction', id, key: 'default' }); // the card itself: the app's default action
  dropPop(id);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && listOpen) toggleList(false); });

api.onNotify((n) => showPop(n));
api.onNotificationsChanged(() => { if (listOpen) renderList(); });
// The host relays the bell (edge.js) as a toggle.
window.scorpionPanel = { toggle: () => toggleList(), close: () => toggleList(false) };
api.state().then((st) => { if (st?.settings?.theme) document.documentElement.dataset.theme = st.settings.theme; }).catch(() => {});
api.onSettingsChanged((s) => { if (s?.theme) document.documentElement.dataset.theme = s.theme; });
fit();
