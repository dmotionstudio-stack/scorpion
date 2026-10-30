// Apps and Files: what the Windows Start menu and File Explorer do, inside
// Scorpion, for when Scorpion is the Windows desktop (they work any time).
const svg = (paths) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ICON = {
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  file: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'),
  drive: svg('<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 13h.01M11 13h6"/>'),
  up: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  pc: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
};
const KB = 1024;
const size = (n) => (n == null ? '' : n < KB ? `${n} B` : n < KB ** 2 ? `${(n / KB).toFixed(0)} KB` : n < KB ** 3 ? `${(n / KB ** 2).toFixed(1)} MB` : `${(n / KB ** 3).toFixed(1)} GB`);

export function initDesktop({ api, $, esc, toast, errText, setView, S }) {
  const A = { apps: [], icons: {}, query: '', store: false, found: null, searching: '', installing: new Set(), storeError: '' };
  const F = { dir: null, parent: null, items: [], selected: new Set(), clip: null, hidden: false, renaming: null, history: [] };

  // ---------- Apps ----------
  // Every installed app with its own icon: the apps pinned to the taskbar
  // first, then A to Z in letter sections (a letter bar jumps to one). Search
  // shows the best matches. Right-click an app to pin it to the taskbar.
  const letterOf = (name) => { const c = name.trim().charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : '#'; };
  const pinnedIds = () => new Set((S.settings.taskbar?.pinned || []).map((p) => p.id));
  const tile = (a) => `<button type="button" class="app-tile${pinnedIds().has(a.id) ? ' pinned' : ''}" data-app="${esc(a.id)}" title="${esc(a.name)}${pinnedIds().has(a.id) ? ' (pinned to the taskbar)' : ''}">${
    A.icons[a.id] ? `<img class="app-icon" src="${esc(A.icons[a.id])}" alt="">` : `<span class="app-initial">${esc(a.name.slice(0, 1).toUpperCase())}</span>`
  }<span class="app-name">${esc(a.name)}</span></button>`;

  // Get more apps (Scorpion OS): Flathub, searched when asked (it needs the
  // internet and takes a few seconds), installed for this user.
  function renderStore() {
    const box = $('#apps-store');
    if (!box) return;
    const q = A.query.trim();
    box.hidden = !A.store || !q;
    if (box.hidden) return;
    const rows = (A.found || []).map((a) => `<div class="store-app"><span class="app-initial">${esc(a.name.slice(0, 1).toUpperCase())}</span>
        <div class="store-text"><b>${esc(a.name)}</b><span class="muted small">${esc(a.description)}</span></div>
        ${a.installed ? '<span class="muted small">Installed</span>' : A.installing.has(a.id) ? '<button class="btn small" disabled>Installing…</button>' : `<button class="btn small primary" data-get="${esc(a.id)}">Install</button>`}</div>`).join('');
    box.innerHTML = `<h2 class="apps-letter">Get more apps</h2>`
      + (A.searching === q ? '<p class="muted small">Searching Flathub…</p>'
        : A.storeError ? `<p class="muted small">${esc(A.storeError)}</p>`
          : A.found && A.foundFor === q ? (rows || '<p class="muted small">Nothing on Flathub matches that.</p>')
            : `<button class="btn small" id="store-search">Search Flathub for “${esc(q)}”</button>`);
  }
  async function searchStore() {
    const q = A.query.trim();
    if (!q) return;
    A.searching = q; A.storeError = ''; renderStore();
    try { A.found = (await api.sysApps({ action: 'find', query: q })).results; A.foundFor = q; } catch (err) { A.storeError = errText(err); }
    A.searching = ''; renderStore();
  }

  function renderApps() {
    renderStore();
    const q = A.query.trim().toLowerCase();
    if (!A.apps.length) { $('#apps-grid').innerHTML = '<p class="muted">Loading your apps…</p>'; $('#apps-letters').innerHTML = ''; return; }
    if (q) {
      // Names starting with the search first, then names containing it.
      const hits = A.apps.filter((a) => a.name.toLowerCase().includes(q))
        .sort((x, y) => (y.name.toLowerCase().startsWith(q) - x.name.toLowerCase().startsWith(q)) || x.name.localeCompare(y.name));
      $('#apps-grid').innerHTML = hits.length ? `<div class="apps-section"><div class="apps-tiles">${hits.map(tile).join('')}</div></div>` : '<p class="muted">No app matches that.</p>';
      $('#apps-letters').innerHTML = '';
      return;
    }
    const sorted = [...A.apps].sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }));
    const groups = new Map();
    for (const a of sorted) { const l = letterOf(a.name); if (!groups.has(l)) groups.set(l, []); groups.get(l).push(a); }
    const pinned = sorted.filter((a) => pinnedIds().has(a.id));
    $('#apps-grid').innerHTML = (pinned.length ? `<section class="apps-section"><h2 class="apps-letter">Pinned</h2><div class="apps-tiles">${pinned.map(tile).join('')}</div></section>` : '')
      + [...groups].map(([l, list]) => `<section class="apps-section" id="apps-${l === '#' ? 'num' : l}"><h2 class="apps-letter">${l}</h2><div class="apps-tiles">${list.map(tile).join('')}</div></section>`).join('');
    $('#apps-letters').innerHTML = [...groups.keys()].map((l) => `<button type="button" data-letter="${l === '#' ? 'num' : l}">${l}</button>`).join('');
  }

  async function showApps() {
    setView('apps');
    if (!$('#apps-page').dataset.ready) {
      $('#apps-page').dataset.ready = '1';
      $('#apps-page').innerHTML = `
        <div class="files-head"><h1>Apps</h1><span class="muted small" id="apps-count"></span><span class="spacer"></span><button class="btn small" id="apps-refresh" type="button">Refresh</button></div>
        <input class="text-input apps-search" id="apps-search" placeholder="Search your apps" aria-label="Search apps" autocomplete="off">
        <p class="muted small apps-hint">Click to open. Right-click to pin to the taskbar, or unpin.</p>
        <div class="apps-store" id="apps-store" hidden></div>
        <div class="apps-body"><div class="apps-grid" id="apps-grid"></div><nav class="apps-letters" id="apps-letters" aria-label="Jump to a letter"></nav></div>`;
      // Scorpion OS: apps from Flathub too.
      api.sysApps?.({ action: 'prepare' }).then((r) => {
        A.store = Boolean(r?.supported);
        A.live = Boolean(r?.live);
        if (!A.store) return;
        $('#apps-search').placeholder = 'Search your apps, or apps to get (Spotify, GIMP, VLC…)';
        $('.apps-hint').textContent = A.live
          ? 'Click to open. To add apps, install Scorpion OS first (the Install button on the right): apps added now would be gone at the next restart.'
          : 'Click to open. Right-click to pin to the taskbar. To add an app, search for it and choose Search Flathub.';
        renderStore();
      }).catch(() => {});
      $('#apps-store').addEventListener('click', async (e) => {
        if (e.target.closest('#store-search')) { searchStore(); return; }
        const id = e.target.closest('[data-get]')?.dataset.get;
        if (!id) return;
        const app = A.found.find((a) => a.id === id);
        A.installing.add(id); renderStore();
        toast(`Installing ${app.name}… (this can take a few minutes)`, 8000);
        try {
          await api.sysApps({ action: 'install', id });
          app.installed = true;
          toast(`${app.name} is installed.`);
          loadApps(true);
        } catch (err) { toast(errText(err), 'error'); }
        A.installing.delete(id); renderStore();
      });
      $('#apps-search').addEventListener('input', (e) => { A.query = e.target.value; renderApps(); });
      // Enter opens the first app; with none, it searches Flathub.
      $('#apps-search').addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; const first = $('#apps-grid .app-tile'); if (first) first.click(); else if (A.store) searchStore(); });
      $('#apps-refresh').onclick = () => loadApps(true);
      $('#apps-letters').addEventListener('click', (e) => {
        const l = e.target.closest('[data-letter]')?.dataset.letter;
        if (l) document.getElementById(`apps-${l}`)?.scrollIntoView({ block: 'start' });
      });
      $('#apps-grid').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-app]');
        if (!b) return;
        const app = A.apps.find((a) => a.id === b.dataset.app);
        toast(`Opening ${app.name}…`);
        try { await api.shellLaunch(app); } catch (err) { toast(errText(err), 'error'); }
      });
      // Right-click: pin to the taskbar, or unpin.
      $('#apps-grid').addEventListener('contextmenu', async (e) => {
        const b = e.target.closest('[data-app]');
        if (!b) return;
        e.preventDefault();
        const app = A.apps.find((a) => a.id === b.dataset.app);
        const on = !pinnedIds().has(app.id);
        try {
          S.settings = await api.shellPin({ id: app.id, name: app.name, on });
          toast(on ? `${app.name} is pinned to the taskbar.` : `${app.name} is unpinned.`);
          renderApps();
        } catch (err) { toast(errText(err), 'error'); }
      });
    }
    renderApps();
    $('#apps-search').value = A.query;
    $('#apps-search').focus();
    if (!A.apps.length) await loadApps(false);
  }
  async function loadApps(fresh) {
    try {
      A.apps = await api.shellApps(fresh);
      $('#apps-count').textContent = `${A.apps.length} apps`;
      renderApps();
      // The icons (from disk at once; looked up again on Refresh).
      A.icons = await api.shellAppIcons(fresh);
      renderApps();
    } catch (err) { toast(errText(err), 'error'); }
  }

  // ---------- Files ----------
  const visible = () => F.items.filter((i) => F.hidden || !i.hidden);
  const selectedItems = () => F.items.filter((i) => F.selected.has(i.path));

  function crumbs() {
    if (!F.dir) return `<button class="crumb" data-go="">This PC</button>`;
    const parts = F.dir.split('\\').filter(Boolean);
    let acc = '';
    return `<button class="crumb" data-go="">This PC</button>` + parts.map((p, i) => {
      acc = i === 0 ? `${p}\\` : `${acc}${acc.endsWith('\\') ? '' : '\\'}${p}`;
      return `<span class="crumb-sep">›</span><button class="crumb" data-go="${esc(acc)}">${esc(p)}</button>`;
    }).join('');
  }

  function renderFiles() {
    const items = visible();
    const sel = selectedItems();
    $('#files-crumbs').innerHTML = crumbs();
    $('#files-up').disabled = !F.dir;
    $('#files-paste').disabled = !F.clip || !F.dir;
    $('#files-paste').textContent = F.clip ? `Paste ${F.clip.items.length} ${F.clip.move ? '(move)' : ''}`.trim() : 'Paste';
    $('#files-new').disabled = !F.dir;
    for (const id of ['#files-copy', '#files-cut', '#files-recycle']) $(id).disabled = !sel.length || !F.dir;
    $('#files-rename').disabled = sel.length !== 1 || !F.dir;
    $('#files-list').innerHTML = items.length ? items.map((i) => {
      const icon = !F.dir && /^[A-Z]:\\$/.test(i.path) ? ICON.drive : i.dir ? ICON.folder : ICON.file;
      const name = F.renaming === i.path
        ? `<form class="files-rename" data-rename="${esc(i.path)}"><input class="text-input" value="${esc(i.name)}" aria-label="New name"><button class="btn small" type="submit">Rename</button></form>`
        : `<span class="files-name">${esc(i.name)}</span>`;
      return `<div class="files-row${F.selected.has(i.path) ? ' selected' : ''}${i.dir ? ' dir' : ''}${i.hidden ? ' faded' : ''}" data-path="${esc(i.path)}" tabindex="-1">${icon}${name}<span class="muted small files-date">${i.modified ? new Date(i.modified).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : ''}</span><span class="muted small files-size">${size(i.size)}</span></div>`;
    }).join('') : '<p class="muted">This folder is empty.</p>';
    const input = $('#files-list .files-rename input');
    if (input) { input.focus(); input.setSelectionRange(0, input.value.replace(/\.[^.]+$/, '').length || input.value.length); }
    $('#files-status').textContent = `${items.length} item${items.length === 1 ? '' : 's'}${sel.length ? ` · ${sel.length} selected` : ''}`;
  }

  async function go(dir, { select = null, remember = true } = {}) {
    try {
      const r = await api.filesList(dir || null);
      if (remember && F.dir !== r.dir) F.history.push(F.dir);
      Object.assign(F, { dir: r.dir, parent: r.parent, items: r.items, renaming: null });
      F.selected = new Set(select ? [select] : []);
      renderFiles();
      if (select) document.querySelector(`.files-row[data-path="${CSS.escape(select)}"]`)?.scrollIntoView({ block: 'center' });
    } catch (err) { toast(errText(err), 'error'); }
  }

  async function open(item) {
    if (item.dir) return go(item.path);
    try { await api.filesOpen(item.path); } catch (err) { toast(errText(err), 'error'); }
  }

  async function recycle() {
    const sel = selectedItems();
    if (!sel.length) return;
    if (!confirm(sel.length === 1 ? `Move "${sel[0].name}" to the Recycle Bin?` : `Move ${sel.length} items to the Recycle Bin?`)) return;
    try { await api.filesRecycle(sel.map((i) => i.path)); toast('Moved to the Recycle Bin'); } catch (err) { toast(errText(err), 'error'); }
    go(F.dir, { remember: false });
  }

  async function paste() {
    if (!F.clip || !F.dir) return;
    try {
      const done = await api.filesPaste({ items: F.clip.items, dir: F.dir, move: F.clip.move });
      if (F.clip.move) F.clip = null;
      go(F.dir, { remember: false, select: done[0] });
    } catch (err) { toast(errText(err), 'error'); go(F.dir, { remember: false }); }
  }

  function build() {
    $('#files-page').dataset.ready = '1';
    $('#files-page').innerHTML = `
      <div class="files-head"><h1>Files</h1><span class="spacer"></span>
        <label class="small muted files-hidden"><input type="checkbox" id="files-hidden"> Hidden items</label></div>
      <div class="files-bar">
        <button class="btn small" id="files-back" type="button" title="Back">‹</button>
        <button class="btn small" id="files-up" type="button" title="Up one folder">${ICON.up}</button>
        <div class="files-crumbs" id="files-crumbs"></div>
      </div>
      <div class="files-bar">
        <button class="btn small" id="files-new" type="button">New folder</button>
        <button class="btn small" id="files-rename" type="button">Rename</button>
        <button class="btn small" id="files-copy" type="button">Copy</button>
        <button class="btn small" id="files-cut" type="button">Cut</button>
        <button class="btn small" id="files-paste" type="button">Paste</button>
        <button class="btn small danger" id="files-recycle" type="button">Recycle Bin</button>
        <span class="spacer"></span><span class="muted small" id="files-status"></span>
      </div>
      <div class="files-list" id="files-list" tabindex="0"></div>`;
    $('#files-hidden').onchange = (e) => { F.hidden = e.target.checked; renderFiles(); };
    $('#files-back').onclick = () => { if (F.history.length) go(F.history.pop(), { remember: false }); };
    $('#files-up').onclick = () => go(F.parent || null);
    $('#files-crumbs').onclick = (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go || null); };
    $('#files-new').onclick = async () => {
      try { const p = await api.filesNewFolder({ dir: F.dir, name: 'New folder' }); await go(F.dir, { remember: false, select: p }); F.renaming = p; renderFiles(); } catch (err) { toast(errText(err), 'error'); }
    };
    $('#files-rename').onclick = () => { F.renaming = selectedItems()[0]?.path || null; renderFiles(); };
    $('#files-copy').onclick = () => { F.clip = { items: selectedItems().map((i) => i.path), move: false }; renderFiles(); toast('Copied: choose a folder, then Paste'); };
    $('#files-cut').onclick = () => { F.clip = { items: selectedItems().map((i) => i.path), move: true }; renderFiles(); toast('Cut: choose a folder, then Paste'); };
    $('#files-paste').onclick = paste;
    $('#files-recycle').onclick = recycle;

    const list = $('#files-list');
    list.addEventListener('click', (e) => {
      const row = e.target.closest('.files-row');
      if (!row || e.target.closest('.files-rename')) return;
      const p = row.dataset.path;
      if (e.ctrlKey) { if (F.selected.has(p)) F.selected.delete(p); else F.selected.add(p); }
      else F.selected = new Set([p]);
      renderFiles();
    });
    list.addEventListener('dblclick', (e) => {
      const row = e.target.closest('.files-row');
      const item = row && F.items.find((i) => i.path === row.dataset.path);
      if (item && !e.target.closest('.files-rename')) open(item);
    });
    list.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target.closest('[data-rename]');
      try { const to = await api.filesRename({ from: form.dataset.rename, name: form.querySelector('input').value }); F.renaming = null; go(F.dir, { remember: false, select: to }); } catch (err) { toast(errText(err), 'error'); }
    });
    list.addEventListener('keydown', (e) => {
      if (e.target.closest('.files-rename')) { if (e.key === 'Escape') { F.renaming = null; renderFiles(); list.focus(); } return; }
      const items = visible();
      const sel = selectedItems();
      if (e.key === 'Enter' && sel.length === 1) open(sel[0]);
      else if (e.key === 'F2' && sel.length === 1 && F.dir) { F.renaming = sel[0].path; renderFiles(); }
      else if (e.key === 'Delete' && F.dir) recycle();
      else if (e.key === 'Backspace') $('#files-up').click();
      else if (e.ctrlKey && e.key === 'c' && sel.length) $('#files-copy').click();
      else if (e.ctrlKey && e.key === 'x' && sel.length) $('#files-cut').click();
      else if (e.ctrlKey && e.key === 'v') paste();
      else if (e.ctrlKey && e.key === 'a') { F.selected = new Set(items.map((i) => i.path)); renderFiles(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const i = items.findIndex((x) => F.selected.has(x.path));
        const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (next) { F.selected = new Set([next.path]); renderFiles(); document.querySelector(`.files-row[data-path="${CSS.escape(next.path)}"]`)?.scrollIntoView({ block: 'nearest' }); }
      } else return;
      e.preventDefault();
    });
  }

  async function showFiles(dir, select) {
    setView('files');
    if (!$('#files-page').dataset.ready) build();
    if (dir !== undefined || !$('#files-list').children.length) await go(dir ?? F.dir, { select });
    $('#files-list').focus();
  }

  // ---------- Settings → Windows and taskbar ----------
  // How windows and the taskbar behave, your way: apps full screen, Stage,
  // the summon dot and the rail while Scorpion is minimized, auto-hide, what
  // the taskbar shows and which apps are pinned to it (in order).
  const TASKBAR_ITEMS = [['clock', 'Clock'], ['network', 'Network'], ['battery', 'Battery'], ['notifications', 'Notifications'], ['mail', 'Mail'], ['chat', 'Chat'], ['volume', 'Volume']];
  async function renderLayout() {
    const box = $('#layout-settings');
    if (!box) return;
    const st = await api.state().catch(() => null);
    const win = st?.platform === 'win32';
    const s = S.settings;
    const t = s.taskbar || {};
    const show = t.show || {};
    const pinned = t.pinned || [];
    const check = (attr, on, label) => `<label class="toggle"><input type="checkbox" ${attr}${on ? ' checked' : ''}><span>${label}</span></label>`;
    // Buttons for one of several (the one chosen is highlighted).
    const pick = (attr, now, options) => options.map(([v, label]) => `<button class="btn small${v === now ? ' primary' : ''}" type="button" ${attr}="${v}" aria-pressed="${v === now}">${label}</button>`).join('');
    const edge = t.edge || (t.layout === 'bar' ? 'bottom' : 'right');
    const stageSide = edge === 'left' ? 'right' : 'left'; // shell.js and stage.js say the same
    const corner = s.dotAt?.corner || (s.dotAt ? null : 'bl');
    box.innerHTML = `
      ${check('data-layout="appsFull"', s.appsFull !== false, 'Open apps full screen: an app\'s window fills the screen when it opens (its dialogs keep their size)')}
      ${check('data-layout="stage"', s.stage !== false, `Stage: touch the ${stageSide} edge of the screen and all your open apps slide in as live pictures; pick one and the window in front steps aside`)}
      ${check('data-layout="minimizeToStage"', s.minimizeToStage !== false, `Minimizing a window flies it into Stage on the ${stageSide}`)}
      ${win ? check('data-layout="summonDot"', s.summonDot !== false, 'When Scorpion is minimized, keep its summon dot on the desktop (click it, or press Win+Shift+Space anywhere, for the intent wheel)') : ''}
      ${win ? check('data-layout="railAway"', s.railAway !== false, 'And the rail with it: your open apps, clock and notifications along the taskbar\'s edge while Scorpion is minimized') : ''}
      ${check('data-taskbar="autoHide"', t.autoHide === true, 'Hide the taskbar until the pointer touches its edge')}
      <p class="small">The taskbar's place on the screen</p>
      <div class="row wrap" role="group" aria-label="The taskbar's place on the screen">${pick('data-edge', edge, [['bottom', 'Bottom'], ['top', 'Top'], ['left', 'Left'], ['right', 'Right']])}</div>
      <p class="small">The summon dot</p>
      <div class="row wrap" role="group" aria-label="The summon dot's corner">${pick('data-corner', corner, [['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']])}</div>
      <p class="muted small">Or drag it anywhere on the screen: it stays where you drop it, and dropped near a corner it settles into that corner. It grows or shrinks to suit your screen.</p>
      <p class="small">The taskbar shows</p>
      <div class="row wrap">${TASKBAR_ITEMS.map(([k, label]) => check(`data-show="${k}"`, show[k] !== false, label)).join('')}</div>
      <p class="small">Apps on the taskbar</p>
      <ol class="pin-list">${pinned.map((p, i) => `<li><span>${esc(p.name)}</span>
        <button class="btn small" type="button" data-pin-move="${i}" data-by="-1"${i ? '' : ' disabled'} aria-label="Move ${esc(p.name)} up">↑</button>
        <button class="btn small" type="button" data-pin-move="${i}" data-by="1"${i < pinned.length - 1 ? '' : ' disabled'} aria-label="Move ${esc(p.name)} down">↓</button>
        <button class="btn small" type="button" data-pin-remove="${i}">Remove</button></li>`).join('') || '<li class="muted small">None yet.</li>'}</ol>
      <div class="row"><button class="btn small" type="button" id="pin-add">Add apps…</button><span class="muted small">In Apps, right-click an app to add it; right-click an open window on the taskbar to pin it.</span></div>`;
    const save = async (patch) => { try { S.settings = await api.updateSettings(patch); } catch (err) { toast(errText(err), 'error'); } renderLayout(); };
    const saveTaskbar = (patch) => save({ taskbar: { ...(S.settings.taskbar || {}), ...patch } });
    for (const b of box.querySelectorAll('[data-layout]')) {
      b.onchange = async () => {
        if (b.dataset.layout === 'stage') { try { S.settings.stage = await api.shellStage(b.checked); } catch (err) { toast(errText(err), 'error'); } renderLayout(); return; }
        save({ [b.dataset.layout]: b.checked });
      };
    }
    for (const b of box.querySelectorAll('[data-taskbar]')) b.onchange = () => saveTaskbar({ [b.dataset.taskbar]: b.checked });
    for (const b of box.querySelectorAll('[data-show]')) b.onchange = () => saveTaskbar({ show: { ...(S.settings.taskbar?.show || {}), [b.dataset.show]: b.checked } });
    for (const b of box.querySelectorAll('[data-pin-move]')) {
      b.onclick = () => {
        const list = [...pinned];
        const i = Number(b.dataset.pinMove);
        const j = i + Number(b.dataset.by);
        [list[i], list[j]] = [list[j], list[i]];
        saveTaskbar({ pinned: list });
      };
    }
    for (const b of box.querySelectorAll('[data-pin-remove]')) b.onclick = () => saveTaskbar({ pinned: pinned.filter((_, i) => i !== Number(b.dataset.pinRemove)) });
    const add = $('#pin-add');
    if (add) add.onclick = () => showApps();
    for (const b of box.querySelectorAll('[data-edge]')) b.onclick = () => saveTaskbar({ edge: b.dataset.edge });
    for (const b of box.querySelectorAll('[data-corner]')) {
      b.onclick = async () => {
        await api.shellDot?.({ phase: 'corner', corner: b.dataset.corner }).catch(() => {});
        S.settings.dotAt = { corner: b.dataset.corner };
        renderLayout();
      };
    }
  }

  // ---------- Settings → Windows desktop ----------
  // The switch is the user's: nothing changes until they press the button.
  async function renderSettings() {
    renderLayout();
    const st = await api.shellStatus().catch(() => null);
    $('#desktop-field').classList.toggle('hidden', !st?.supported);
    if (!st?.supported) return;
    const now = st.mode === 'shell' ? ' Scorpion is your desktop right now.' : st.mode === 'bar' ? " Scorpion's taskbar is in place of the Windows one." : '';
    $('#desktop-settings').innerHTML = `
      <p>${st.isScorpion
        ? '<strong>Scorpion is your Windows desktop.</strong> When you sign in, Scorpion starts in place of the Windows taskbar, Start menu and desktop.'
        : 'When you sign in, Windows starts its own desktop (taskbar, Start menu, File Explorer).'}${now}</p>
      <div class="row">
        ${st.isScorpion
          ? '<button class="btn" id="desktop-off" type="button">Go back to the Windows desktop</button>'
          : `<button class="btn primary" id="desktop-on" type="button"${st.packaged ? '' : ' disabled title="Install Scorpion first: Windows starts the installed app"'}>Use Scorpion as my Windows desktop</button>`}
        ${st.isScorpion && st.mode !== 'shell' ? '<button class="btn" id="desktop-signout" type="button">Sign out now</button>' : ''}
        ${st.mode === 'shell' ? '<button class="btn" id="desktop-explorer" type="button">Switch to the Windows desktop now</button>' : ''}
      </div>
      <p class="muted small">Using Scorpion as your desktop changes only your own Windows account, removes nothing from Windows, and takes effect the next time you sign in. Your apps and files stay where they are: open them from Apps and Files, or ask Scorpion.</p>
      <p class="muted small">If anything goes wrong: press Ctrl+Alt+Delete, open Task Manager, choose Run new task and type <code>explorer.exe</code> to get the Windows desktop back. If Scorpion fails to start three times in a row, Windows' own desktop starts instead.</p>
      <label class="toggle"><input type="checkbox" id="taskbar-always"${S.settings.taskbarAlwaysOn ? ' checked' : ''}${st.mode === 'shell' || st.isScorpion ? ' disabled' : ''}><span>Use Scorpion's holographic taskbar instead of the Windows taskbar whenever Scorpion runs (no sign-out needed; the Windows taskbar comes back when Scorpion quits${st.isScorpion ? '; as your desktop Scorpion always has its own' : ''})</span></label>
      <label class="toggle"><input type="checkbox" data-orb-setting="orbDesktop"${S.settings.orbDesktop !== false ? ' checked' : ''}><span>Show the orb as the desktop (otherwise the Home page)</span></label>
      <label class="toggle"><input type="checkbox" data-orb-setting="orbApps"${S.settings.orbApps !== false ? ' checked' : ''}><span>Open apps inside the orb (Windows): the app in front fills a panel next to the orb; Pop out gives it its normal window</span></label>
      <label class="toggle"><input type="checkbox" data-orb-setting="orbGreet"${S.settings.orbGreet !== false ? ' checked' : ''}><span>Greet me by name when I sign in (uses the camera briefly; needs face recognition from People)</span></label>
      <label class="toggle"><input type="checkbox" data-orb-setting="orbSpeakEvents"${S.settings.orbSpeakEvents ? ' checked' : ''}><span>Say PC events out loud: low battery, finished downloads, schedules and check-ins</span></label>
      <p class="muted small">The orb: its shortcuts orbit it (Apps, Files, Library, Chats, People, Settings and your open windows). Pick one by saying its name, pointing and pinching with Gestures on, or clicking. Saying "back", or pushing your open hand toward the screen, returns to the orb. With the wake word on (in the orb's controls), saying "Scorpion" starts listening; the speech is turned into text on this computer and nothing is kept.</p>`;
    for (const box of document.querySelectorAll('[data-orb-setting]')) {
      box.onchange = async () => { S.settings = await api.updateSettings({ [box.dataset.orbSetting]: box.checked }); };
    }
    const act = (id, fn) => { const b = $(`#${id}`); if (b) b.onclick = async () => { b.disabled = true; try { await fn(); } catch (err) { toast(errText(err), 'error'); } renderSettings(); }; };
    const bar = $('#taskbar-always');
    if (bar) bar.onchange = async () => { bar.disabled = true; try { await api.shellTaskbar(bar.checked); S.settings.taskbarAlwaysOn = bar.checked; } catch (err) { toast(errText(err), 'error'); } renderSettings(); };
    act('desktop-on', async () => {
      if (!confirm('Use Scorpion as your Windows desktop?\n\nNext time you sign in, Scorpion starts instead of the Windows taskbar and Start menu. You can switch back here at any time, or with Ctrl+Alt+Delete → Task Manager → Run new task → explorer.exe.')) return;
      await api.shellSetDesktop(true);
      toast('Done. Sign out and back in to start Scorpion as your desktop.');
    });
    act('desktop-off', async () => { await api.shellSetDesktop(false); toast('Done. Next time you sign in, Windows starts its own desktop.'); });
    act('desktop-signout', async () => { if (confirm('Sign out of Windows now? Save your work in other apps first.')) await api.shellPower('signout'); });
    act('desktop-explorer', () => api.shellPower('explorer'));
  }

  return { showApps, showFiles, renderSettings };
}
