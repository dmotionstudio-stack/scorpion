// Settings → General → The orb's bubbles: which of Scorpion's places orbit
// the orb and in what order, bubbles of your own (an app, a folder, a
// website or one of Scorpion's actions, each with a label and, if you like,
// a colour), the open windows on the outer ring, and the bubbles' size and the
// rings' speed. Saved as settings.orbBubbles (orb-bubbles.js says what it holds).
import { normalizeBubbles, MAX_CUSTOM, siteUrl } from './orb-bubbles.js';
import { intentsFor } from '/shared/intents.js';
import { PLATFORM } from './palette.js';

const PLACE_LABELS = { apps: 'Apps', files: 'Files', library: 'Library', chats: 'Chats', people: 'People', settings: 'Settings' };
const KIND_LABELS = { app: 'App', folder: 'Folder', site: 'Website', action: 'Scorpion action' };
const IS_WINDOWS = navigator.userAgent.includes('Windows');

export function initOrbBubbles({ api, $, esc, S, toast, errText }) {
  const draft = { kind: 'app', target: '', label: '', color: null };
  let apps = null; // the installed apps, asked for once

  const save = async (b) => {
    try { S.settings = await api.updateSettings({ orbBubbles: b }); } catch (err) { toast(errText(err), 'error'); }
    render();
  };
  const move = (list, i, by) => { const out = [...list]; const j = i + by; [out[i], out[j]] = [out[j], out[i]]; return out; };
  const pick = (attr, now, options) => options.map(([v, label]) => `<button class="btn small${v === now ? ' primary' : ''}" type="button" ${attr}="${v}" aria-pressed="${v === now}">${label}</button>`).join('');

  // What the bubble you're adding points at: chosen the way its kind needs.
  function targetField() {
    if (draft.kind === 'app') {
      if (!apps) return '<span class="muted small">Loading your apps…</span>';
      return `<select id="ob-target" aria-label="App">${['<option value="">Choose an app…</option>', ...apps.map((a) => `<option value="${esc(a.id)}"${a.id === draft.target ? ' selected' : ''}>${esc(a.name)}</option>`)].join('')}</select>`;
    }
    if (draft.kind === 'folder') return `<button class="btn small" type="button" id="ob-folder">Choose a folder…</button><span class="muted small ob-path">${esc(draft.target || 'None chosen')}</span>`;
    if (draft.kind === 'site') return `<input id="ob-target" type="text" placeholder="example.com" value="${esc(draft.target)}" aria-label="Web address">`;
    const acts = intentsFor(PLATFORM, { live: Boolean(S.live) });
    return `<select id="ob-target" aria-label="Scorpion action">${['<option value="">Choose an action…</option>', ...acts.map((a) => `<option value="${esc(a.id)}"${a.id === draft.target ? ' selected' : ''}>${esc(a.group)}: ${esc(a.label)}</option>`)].join('')}</select>`;
  }

  function render() {
    const box = $('#orb-bubbles');
    if (!box) return;
    const b = normalizeBubbles(S.settings.orbBubbles);
    const places = b.places.filter((p) => IS_WINDOWS || (p.id !== 'apps' && p.id !== 'files'));
    const describe = (c) => (c.kind === 'action' ? intentsFor(PLATFORM).find((a) => a.id === c.target)?.label || c.target : c.target);
    box.innerHTML = `
      <p class="small">Scorpion's places</p>
      <ol class="pin-list">${places.map((p, i) => `<li>
        <label class="toggle"><input type="checkbox" data-place-on="${p.id}"${p.on ? ' checked' : ''}><span>${PLACE_LABELS[p.id]}</span></label><span></span>
        <button class="btn small" type="button" data-place-move="${p.id}" data-by="-1"${i ? '' : ' disabled'} aria-label="Move ${PLACE_LABELS[p.id]} earlier">↑</button>
        <button class="btn small" type="button" data-place-move="${p.id}" data-by="1"${i < places.length - 1 ? '' : ' disabled'} aria-label="Move ${PLACE_LABELS[p.id]} later">↓</button></li>`).join('')}</ol>
      <p class="small">Your own bubbles</p>
      <ol class="pin-list">${b.custom.map((c, i) => `<li>
        <span class="ob-swatch" style="background:${c.color || 'var(--accent)'}" title="${c.color ? 'Its own colour' : "The theme's colour"}"></span>
        <span><strong>${esc(c.label)}</strong> <span class="muted small">${KIND_LABELS[c.kind]}: ${esc(describe(c))}</span></span>
        <input type="color" data-own-color="${i}" value="${c.color || '#f5c518'}" aria-label="${esc(c.label)}'s colour" title="Its colour">
        ${c.color ? `<button class="btn small" type="button" data-own-theme="${i}" title="Back to the theme's colour">Theme</button>` : ''}
        <button class="btn small" type="button" data-own-move="${i}" data-by="-1"${i ? '' : ' disabled'} aria-label="Move ${esc(c.label)} earlier">↑</button>
        <button class="btn small" type="button" data-own-move="${i}" data-by="1"${i < b.custom.length - 1 ? '' : ' disabled'} aria-label="Move ${esc(c.label)} later">↓</button>
        <button class="btn small" type="button" data-own-remove="${i}">Remove</button></li>`).join('') || '<li class="muted small">None yet: add one below.</li>'}</ol>
      ${b.custom.length < MAX_CUSTOM ? `<div class="ob-add">
        <div class="row wrap" role="group" aria-label="Kind of bubble">${pick('data-ob-kind', draft.kind, Object.entries(KIND_LABELS))}</div>
        <div class="row wrap">${targetField()}</div>
        <div class="row wrap">
          <input id="ob-label" type="text" maxlength="40" placeholder="Its name (said to open it, too)" value="${esc(draft.label)}" aria-label="Name">
          <label class="ob-color-pick">Colour <input id="ob-color" type="color" value="${draft.color || '#f5c518'}"></label>
          <label class="toggle"><input type="checkbox" id="ob-own-color"${draft.color ? ' checked' : ''}><span>Its own colour</span></label>
          <button class="btn small primary" type="button" id="ob-add">Add the bubble</button>
        </div></div>` : `<p class="muted small">That's the most bubbles of your own (${MAX_CUSTOM}).</p>`}
      <p class="small">Open windows</p>
      <div class="row wrap">
        <label class="toggle"><input type="checkbox" id="ob-windows"${b.windows ? ' checked' : ''}><span>Show the open windows on the outer ring</span></label>
        <label>At most <select id="ob-max">${[4, 6, 8, 12, 16].map((n) => `<option${n === b.maxWindows ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <p class="small">Their look</p>
      <div class="row wrap" role="group" aria-label="Bubble size"><span class="muted small">Size</span>${pick('data-ob-size', b.size, [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']])}</div>
      <div class="row wrap" role="group" aria-label="How fast the rings turn"><span class="muted small">Turning</span>${pick('data-ob-speed', b.speed, [['still', 'Still'], ['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']])}</div>
      <p class="muted small">Point at a bubble and pinch, click it, or say its name to open it. Apps open inside the orb; folders in Files; websites in your browser.</p>`;

    // Places.
    for (const el of box.querySelectorAll('[data-place-on]')) el.onchange = () => save({ ...b, places: b.places.map((p) => (p.id === el.dataset.placeOn ? { ...p, on: el.checked } : p)) });
    for (const el of box.querySelectorAll('[data-place-move]')) {
      el.onclick = () => {
        const i = b.places.findIndex((p) => p.id === el.dataset.placeMove);
        // Step over places this system doesn't show.
        let j = i + Number(el.dataset.by);
        while (b.places[j] && !places.some((p) => p.id === b.places[j].id)) j += Number(el.dataset.by);
        if (!b.places[j]) return;
        const out = [...b.places]; [out[i], out[j]] = [out[j], out[i]];
        save({ ...b, places: out });
      };
    }
    // Your own.
    for (const el of box.querySelectorAll('[data-own-move]')) el.onclick = () => save({ ...b, custom: move(b.custom, Number(el.dataset.ownMove), Number(el.dataset.by)) });
    for (const el of box.querySelectorAll('[data-own-remove]')) el.onclick = () => save({ ...b, custom: b.custom.filter((_, i) => i !== Number(el.dataset.ownRemove)) });
    for (const el of box.querySelectorAll('[data-own-color]')) el.onchange = () => save({ ...b, custom: b.custom.map((c, i) => (i === Number(el.dataset.ownColor) ? { ...c, color: el.value } : c)) });
    for (const el of box.querySelectorAll('[data-own-theme]')) el.onclick = () => save({ ...b, custom: b.custom.map((c, i) => (i === Number(el.dataset.ownTheme) ? { ...c, color: null } : c)) });
    // Adding one.
    for (const el of box.querySelectorAll('[data-ob-kind]')) el.onclick = () => { draft.kind = el.dataset.obKind; draft.target = ''; render(); };
    const target = $('#ob-target');
    if (target) {
      target.oninput = target.onchange = () => {
        draft.target = target.value;
        // The name follows what was chosen, until one is typed.
        if (!draft.labelTyped && target.tagName === 'SELECT') { draft.label = target.selectedOptions[0]?.value ? target.selectedOptions[0].textContent.replace(/^[^:]*: /, '') : ''; const l = $('#ob-label'); if (l) l.value = draft.label; }
      };
    }
    const folder = $('#ob-folder');
    if (folder) folder.onclick = async () => {
      const dir = await api.chooseFolder().catch(() => null);
      if (!dir) return;
      draft.target = dir;
      if (!draft.labelTyped) draft.label = dir.split(/[\\/]/).filter(Boolean).pop() || dir;
      render();
    };
    const label = $('#ob-label');
    if (label) label.oninput = () => { draft.label = label.value; draft.labelTyped = Boolean(label.value); };
    const color = $('#ob-color');
    const own = $('#ob-own-color');
    if (color) color.oninput = () => { draft.color = color.value; if (own) own.checked = true; };
    if (own) own.onchange = () => { draft.color = own.checked ? (color?.value || '#f5c518') : null; };
    const add = $('#ob-add');
    if (add) add.onclick = () => {
      const name = draft.label.trim();
      if (!draft.target.trim()) { toast(draft.kind === 'site' ? 'Type a web address' : `Choose ${draft.kind === 'folder' ? 'a folder' : draft.kind === 'app' ? 'an app' : 'an action'}`, 'error'); return; }
      if (draft.kind === 'site' && !siteUrl(draft.target)) { toast(`${draft.target} isn't a web address`, 'error'); return; }
      if (!name) { toast('Give the bubble a name', 'error'); return; }
      const bubble = { id: `b${Date.now().toString(36)}`, kind: draft.kind, label: name, target: draft.target.trim(), color: draft.color };
      Object.assign(draft, { target: '', label: '', labelTyped: false, color: null });
      save({ ...b, custom: [...b.custom, bubble] });
    };
    // Windows, look.
    $('#ob-windows').onchange = (e) => save({ ...b, windows: e.target.checked });
    $('#ob-max').onchange = (e) => save({ ...b, maxWindows: Number(e.target.value) });
    for (const el of box.querySelectorAll('[data-ob-size]')) el.onclick = () => save({ ...b, size: el.dataset.obSize });
    for (const el of box.querySelectorAll('[data-ob-speed]')) el.onclick = () => save({ ...b, speed: el.dataset.obSpeed });

    // The installed apps, for adding an app bubble.
    if (draft.kind === 'app' && !apps) {
      api.shellApps().then((list) => { apps = [...list].sort((x, y) => x.name.localeCompare(y.name)); render(); }).catch(() => { apps = []; render(); });
    }
  }

  return { render };
}
