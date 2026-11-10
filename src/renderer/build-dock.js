// Build's side panel (beside the chat): Preview, a page of the server running on this
// computer (a view the main process docks into the window at this panel's place), and
// Terminal, the servers and commands running in the workspace with their output and a
// line to type commands into. Also the Trust chip: a trusted folder is built in without
// asking. The main process does the work (preview.js, devserver.js).

// The Terminal's text: ANSI colours removed, trimmed to the last part.
export const cleanOutput = (s, max = 60000) => String(s || '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r(?!\n)/g, '\n').slice(-max);
// "Trusted" or not, for the chip, from the settings.
export function trustState(settings) {
  const ws = settings.workspace;
  if (!ws) return { visible: false, trusted: false };
  const same = (a, b) => (/^[a-z]:/i.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b);
  return { visible: true, trusted: (settings.trustedFolders || []).some((t) => same(t, ws)) };
}

// ctx: { $, api, S, toast, errText, setSetting }
export function initBuildDock({ $, api, S, toast, errText, setSetting }) {
  const panel = $('#dock-panel');
  const host = $('#preview-host');
  const D = { tab: 'preview', procs: [], current: null, out: new Map(), last: '' };

  const open = (tab) => { panel.classList.remove('hidden'); if (tab) setTab(tab); sendBounds(true); };
  const toggle = () => { panel.classList.toggle('hidden'); sendBounds(true); };
  function setTab(tab) {
    D.tab = tab;
    for (const b of panel.querySelectorAll('[data-dock-tab]')) b.setAttribute('aria-selected', String(b.dataset.dockTab === tab));
    $('#dock-preview').classList.toggle('hidden', tab !== 'preview');
    $('#dock-terminal').classList.toggle('hidden', tab !== 'terminal');
    if (tab === 'terminal') refreshProcs();
    sendBounds(true);
  }

  // ---- the preview's place: sent when it moves or resizes, hidden when the panel or the chat is not showing
  function sendBounds(force = false) {
    const showing = !panel.classList.contains('hidden') && D.tab === 'preview' && !$('#view-chat').classList.contains('hidden');
    const r = host.getBoundingClientRect();
    const key = `${showing}|${Math.round(r.x)}|${Math.round(r.y)}|${Math.round(r.width)}|${Math.round(r.height)}`;
    if (!force && key === D.last) return;
    D.last = key;
    api.previewBounds({ x: r.x, y: r.y, width: r.width, height: r.height, visible: showing }).catch(() => {});
  }
  new ResizeObserver(() => sendBounds()).observe(host);
  addEventListener('resize', () => sendBounds());
  setInterval(sendBounds, 400); // the chat view opening or closing, the window moving: cheap, and only sends a change

  // ---- Preview
  const go = async (text) => {
    const t = String(text || '').trim();
    if (!t) return;
    try { await api.previewGo({ url: /^[a-z]+:\/\//i.test(t) || /^\d{2,5}$/.test(t) ? t : /^(localhost|127\.0\.0\.1|\[::1\])/i.test(t) ? t : `http://${t}` }); } catch (err) { toast(errText(err), 'error'); }
  };
  $('#preview-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(e.target.value); } });
  $('#preview-back').onclick = () => api.previewNav({ action: 'back' });
  $('#preview-forward').onclick = () => api.previewNav({ action: 'forward' });
  $('#preview-reload').onclick = () => api.previewNav({ action: 'reload' });
  $('#preview-external').onclick = () => api.previewNav({ action: 'external' });
  $('#preview-devtools').onclick = () => api.previewNav({ action: 'devtools' });
  const showState = (s) => {
    if (document.activeElement !== $('#preview-url')) $('#preview-url').value = s.url || '';
    $('#preview-back').disabled = !s.canBack;
    $('#preview-forward').disabled = !s.canForward;
    $('#preview-errors').textContent = s.errors ? `${s.errors} error${s.errors === 1 ? '' : 's'} in the page` : '';
    $('#preview-title').textContent = s.loading ? 'Loading…' : s.title || '';
  };
  api.onPreviewState?.(showState);
  api.onPreviewOpen?.(({ url }) => { $('#preview-url').value = url || ''; open('preview'); });

  // ---- Terminal
  const outBox = $('#dev-out');
  function showOutput() {
    const text = D.out.get(D.current) || '';
    outBox.textContent = cleanOutput(text);
    outBox.scrollTop = outBox.scrollHeight;
  }
  async function refreshProcs() {
    try { D.procs = await api.devList(); } catch { D.procs = []; }
    if (!D.procs.some((p) => p.id === D.current)) D.current = D.procs.at(-1)?.id ?? null;
    $('#dev-proc').innerHTML = D.procs.length
      ? D.procs.map((p) => `<option value="${p.id.replace(/"/g, '&quot;')}"${p.id === D.current ? ' selected' : ''}>${p.running ? '● ' : '○ '}${p.id.replace(/[<>&]/g, '')}${p.url ? ` (${p.url})` : ''}</option>`).join('')
      : '<option value="">Nothing running yet</option>';
    const cur = D.procs.find((p) => p.id === D.current);
    $('#dev-stop').disabled = !cur?.running;
    $('#dev-send').disabled = !cur?.running;
    if (cur && !D.out.has(cur.id)) { D.out.set(cur.id, ''); try { D.out.set(cur.id, (await api.devLogs({ name: cur.id })).output || ''); } catch { /* none yet */ } }
    showOutput();
  }
  $('#dev-proc').onchange = (e) => { D.current = e.target.value || null; refreshProcs(); };
  $('#dev-stop').onclick = () => api.devStop({ name: D.current }).then(refreshProcs).catch((err) => toast(errText(err), 'error'));
  const line = () => { const v = $('#dev-line').value; $('#dev-line').value = ''; return v; };
  $('#dev-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const command = line().trim();
    if (!command) return;
    try {
      const p = await api.devRun({ command });
      D.current = p.id;
      D.out.set(p.id, `$ ${command}\n`);
      await refreshProcs();
    } catch (err) { toast(errText(err), 'error'); }
  });
  $('#dev-send').onclick = () => { const v = line(); if (v && D.current) api.devInput({ name: D.current, text: v }).catch((err) => toast(errText(err), 'error')); };
  api.onDevData?.(({ id, text }) => {
    D.out.set(id, `${D.out.get(id) || ''}${text}`.slice(-120000));
    if (id === D.current && D.tab === 'terminal' && !panel.classList.contains('hidden')) showOutput();
  });
  api.onDevExit?.(() => refreshProcs());
  api.onDevAddress?.(({ id, url }) => { toast(`${id} is running at ${url}`, 4000); refreshProcs(); });

  // ---- wiring
  $('#toggle-dock').onclick = toggle;
  $('#dock-close').onclick = toggle;
  for (const b of panel.querySelectorAll('[data-dock-tab]')) b.onclick = () => setTab(b.dataset.dockTab);

  // ---- Trust chip
  function renderTrust() {
    const t = trustState(S.settings);
    const chip = $('#trust-chip');
    chip.classList.toggle('hidden', !t.visible);
    chip.setAttribute('aria-pressed', String(t.trusted));
    chip.textContent = t.trusted ? 'Trusted folder' : 'Trust folder';
    chip.title = t.trusted ? 'Scorpion builds in this folder without asking: file changes and commands run by themselves. Click to stop trusting it.' : 'Let Scorpion build in this folder without asking (file changes and commands run by themselves). System folders stay protected.';
  }
  $('#trust-chip').onclick = async () => {
    const ws = S.settings.workspace;
    if (!ws) return;
    const t = trustState(S.settings);
    const list = S.settings.trustedFolders || [];
    if (!t.trusted && !confirm(`Trust ${ws}?\n\nIn Build mode, Scorpion will create and change files here and run commands here (installs, servers, tests) without asking. Anything a command does is up to the command, so only trust a folder you are happy to build in.`)) return;
    await setSetting({ trustedFolders: t.trusted ? list.filter((p) => p.toLowerCase() !== ws.toLowerCase()) : [...list, ws] });
  };
  renderTrust();
  return { renderTrust, open, refreshProcs };
}
