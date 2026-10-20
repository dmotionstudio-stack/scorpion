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

export function initDesktop({ api, $, esc, toast, errText, setView }) {
  const A = { apps: [], query: '' };
  const F = { dir: null, parent: null, items: [], selected: new Set(), clip: null, hidden: false, renaming: null, history: [] };

  // ---------- Apps ----------
  function renderApps() {
    const q = A.query.trim().toLowerCase();
    const list = q ? A.apps.filter((a) => a.name.toLowerCase().includes(q)) : A.apps;
    $('#apps-grid').innerHTML = list.length
      ? list.map((a) => `<button type="button" class="app-tile" data-app="${esc(a.id)}" title="${esc(a.name)}"><span class="app-initial">${esc(a.name.slice(0, 1).toUpperCase())}</span><span class="app-name">${esc(a.name)}</span></button>`).join('')
      : `<p class="muted">${A.apps.length ? 'No app matches that.' : 'Loading your apps…'}</p>`;
  }
  async function showApps() {
    setView('apps');
    if (!$('#apps-page').dataset.ready) {
      $('#apps-page').dataset.ready = '1';
      $('#apps-page').innerHTML = `
        <div class="files-head"><h1>Apps</h1><span class="spacer"></span><button class="btn small" id="apps-refresh" type="button">Refresh</button></div>
        <input class="text-input apps-search" id="apps-search" placeholder="Search your apps" aria-label="Search apps" autocomplete="off">
        <div class="apps-grid" id="apps-grid"></div>`;
      $('#apps-search').addEventListener('input', (e) => { A.query = e.target.value; renderApps(); });
      $('#apps-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#apps-grid .app-tile')?.click(); });
      $('#apps-refresh').onclick = () => loadApps(true);
      $('#apps-grid').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-app]');
        if (!b) return;
        const app = A.apps.find((a) => a.id === b.dataset.app);
        toast(`Opening ${app.name}…`);
        try { await api.shellLaunch(app); } catch (err) { toast(errText(err), 'error'); }
      });
    }
    renderApps();
    $('#apps-search').value = A.query;
    $('#apps-search').focus();
    if (!A.apps.length) await loadApps(false);
  }
  async function loadApps(fresh) {
    try { A.apps = await api.shellApps(fresh); renderApps(); } catch (err) { toast(errText(err), 'error'); }
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

  // ---------- Settings → Windows desktop ----------
  // The switch is the user's: nothing changes until they press the button.
  async function renderSettings() {
    const st = await api.shellStatus().catch(() => null);
    $('#desktop-field').classList.toggle('hidden', !st?.supported);
    if (!st?.supported) return;
    const now = st.mode === 'shell' ? ' Scorpion is your desktop right now.' : st.mode === 'preview' ? ' The taskbar preview is showing.' : '';
    $('#desktop-settings').innerHTML = `
      <p>${st.isScorpion
        ? '<strong>Scorpion is your Windows desktop.</strong> When you sign in, Scorpion starts in place of the Windows taskbar, Start menu and desktop.'
        : 'When you sign in, Windows starts its own desktop (taskbar, Start menu, File Explorer).'}${now}</p>
      <div class="row">
        ${st.mode === 'shell' ? '' : `<button class="btn" id="desktop-preview" type="button">${st.mode === 'preview' ? 'End the preview' : 'Preview the taskbar'}</button>`}
        ${st.isScorpion
          ? '<button class="btn" id="desktop-off" type="button">Go back to the Windows desktop</button>'
          : `<button class="btn primary" id="desktop-on" type="button"${st.packaged ? '' : ' disabled title="Install Scorpion first: Windows starts the installed app"'}>Use Scorpion as my Windows desktop</button>`}
        ${st.isScorpion && st.mode !== 'shell' ? '<button class="btn" id="desktop-signout" type="button">Sign out now</button>' : ''}
        ${st.mode === 'shell' ? '<button class="btn" id="desktop-explorer" type="button">Switch to the Windows desktop now</button>' : ''}
      </div>
      <p class="muted small">Preview shows Scorpion's taskbar over your normal desktop and changes nothing. Using Scorpion as your desktop changes only your own Windows account, removes nothing from Windows, and takes effect the next time you sign in. Your apps and files stay where they are: open them from Apps and Files, or ask Scorpion.</p>
      <p class="muted small">If anything goes wrong: press Ctrl+Alt+Delete, open Task Manager, choose Run new task and type <code>explorer.exe</code> to get the Windows desktop back. If Scorpion fails to start three times in a row, Windows' own desktop starts instead.</p>`;
    const act = (id, fn) => { const b = $(`#${id}`); if (b) b.onclick = async () => { b.disabled = true; try { await fn(); } catch (err) { toast(errText(err), 'error'); } renderSettings(); }; };
    act('desktop-preview', () => api.shellPreview(st.mode !== 'preview'));
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
