// Settings tabs for what Scorpion learned from OpenClaw: Skills, Personality
// (SOUL.md and check-ins), Connections (model sources, MCP tool servers, the
// agent's browser, phone chats) and the Memory page's standing intents and
// dreaming.
export function initExtras({ api, $, esc, toast, errText, S, setView, reloadMemories, renderAll }) {
  const X = {
    skills: S.skills || [], editingSkill: null,
    persona: null,
    presets: {}, sources: S.sources || [], editingSource: null, sourceModels: [],
    mcp: [], editingMcp: null,
    telegram: null,
    intents: [], dreams: null,
  };
  const run = async (fn, done) => {
    try { const r = await fn(); done?.(r); return r; } catch (err) { toast(errText(err), 7000); return undefined; }
  };
  const when = (t) => (t ? new Date(t).toLocaleString() : 'never');

  // ================= Skills =================
  function renderSkills() {
    const e = X.editingSkill;
    $('#skills-page').innerHTML = `<h1>Skills</h1>
      <p class="muted">Step-by-step guides that teach Scorpion how to do a kind of job the way you like it. Scorpion only sees each skill's name and description until a task matches, then reads the whole guide, so many skills cost little. You can also ask Scorpion in a chat to "make a skill" from something you just did together. Same format as OpenClaw and Claude skills: a folder with a SKILL.md.</p>
      <div class="row">
        <button class="btn primary" data-sk="new">New skill</button>
        <button class="btn" data-sk="import">Import a skill folder…</button>
        <button class="btn" data-sk="folder">Open skills folder</button>
      </div>
      ${e ? `<div class="card skill-editor">
        <div class="title">${e.original ? `Edit ${esc(e.original)}` : 'New skill'}${e.fromBundled ? ' <span class="tag">your copy replaces the built-in one</span>' : ''}</div>
        <label class="small muted">Name (lowercase words with dashes)</label>
        <input class="text-input" id="sk-name" value="${esc(e.name)}" placeholder="weekly-sales-report" maxlength="64">
        <label class="small muted">When to use it (one sentence; this is what Scorpion sees)</label>
        <input class="text-input" id="sk-desc" value="${esc(e.description)}" placeholder="Build the weekly sales report from the CSV files in Reports/" maxlength="300">
        <label class="small muted">Instructions (Markdown)</label>
        <textarea id="sk-body" rows="14" class="code-area" placeholder="1. Read every CSV in Reports/ from the last 7 days.\n2. ...">${esc(e.body)}</textarea>
        <div class="row"><button class="btn primary" data-sk="save">Save</button><button class="btn" data-sk="cancel">Cancel</button></div>
      </div>` : ''}
      <div class="skill-list">${X.skills.map((s) => `<div class="card skill-card${s.enabled ? '' : ' off'}">
        <div class="row space"><div class="title">${esc(s.name)}</div>
          <label class="toggle"><input type="checkbox" data-sk-enable="${esc(s.name)}"${s.enabled ? ' checked' : ''}><span>On</span></label></div>
        <div class="small muted">${esc(s.description || '(no description)')}</div>
        <div><span class="tag">${s.source === 'bundled' ? 'built in' : s.overrides ? 'yours, replaces built-in' : 'yours'}</span></div>
        <div class="row">
          <button class="btn small" data-sk-edit="${esc(s.name)}">${s.source === 'bundled' ? 'View / customize' : 'Edit'}</button>
          ${s.versions ? `<button class="btn small" data-sk-undo="${esc(s.name)}" title="Put back the version before the last change">Undo last change</button>` : ''}
          ${s.source === 'user' ? `<button class="btn small" data-sk-delete="${esc(s.name)}">Delete</button>` : ''}
        </div></div>`).join('') || '<p class="muted">No skills yet.</p>'}</div>`;
  }

  async function reloadSkills() {
    X.skills = await api.skillsList();
    renderSkills();
  }

  $('#skills-page').addEventListener('click', async (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    const act = t.dataset.sk;
    if (act === 'new') { X.editingSkill = { name: '', description: '', body: '' }; renderSkills(); $('#sk-name').focus(); return; }
    if (act === 'cancel') { X.editingSkill = null; renderSkills(); return; }
    if (act === 'folder') { api.skillsOpenFolder(); return; }
    if (act === 'import') {
      const r = await run(() => api.skillsImport());
      if (r?.imported?.length) { toast(`Imported: ${r.imported.join(', ')}`); X.skills = r.skills; renderSkills(); }
      return;
    }
    if (act === 'save') {
      const e = X.editingSkill;
      const input = { name: $('#sk-name').value, description: $('#sk-desc').value, body: $('#sk-body').value, previousName: e.fromBundled ? null : e.original };
      await run(() => api.skillSave(input), (list) => { X.skills = list; X.editingSkill = null; renderSkills(); toast('Skill saved.'); });
      return;
    }
    if (t.dataset.skEdit) {
      const s = await run(() => api.skillGet(t.dataset.skEdit));
      if (!s) return;
      X.editingSkill = { name: s.name, description: s.description, body: s.body, original: s.name, fromBundled: s.source === 'bundled' };
      renderSkills();
      $('#skills-page').scrollTop = 0;
      return;
    }
    if (t.dataset.skUndo) { await run(() => api.skillUndo(t.dataset.skUndo), (list) => { X.skills = list; renderSkills(); toast('Previous version restored.'); }); return; }
    if (t.dataset.skDelete && confirm(`Delete the skill "${t.dataset.skDelete}"?`)) {
      await run(() => api.skillDelete(t.dataset.skDelete), (list) => { X.skills = list; renderSkills(); });
    }
  });
  $('#skills-page').addEventListener('change', async (ev) => {
    const name = ev.target.dataset.skEnable;
    if (name) X.skills = await api.skillEnable({ name, on: ev.target.checked });
    renderSkills();
  });

  // ================= Personality =================
  const SOUL_EXAMPLE = `Direct and warm. Have opinions and say them; don't hedge.
Short answers unless I ask for detail. No filler, no flattery.
A little dry humour is fine.
When I'm wrong, tell me plainly and show why.
If I write in Haitian Creole, answer in Haitian Creole.`;

  function renderPersonality() {
    const p = X.persona || { soul: '', checklist: '', heartbeat: {} };
    const s = S.settings;
    const last = p.heartbeat?.lastRun ? `Last check-in: ${when(p.heartbeat.lastRun)} (${{ ok: 'all clear', alert: 'sent you a note', error: 'failed' }[p.heartbeat.lastResult] || '—'})` : 'No check-in yet.';
    $('#personality-page').innerHTML = `<h1>Personality</h1>
      <div class="field">
        <label for="soul">How Scorpion should sound (SOUL.md)</label>
        <p class="muted small">Tone, opinions, how brief, humour, boundaries. Short and sharp works best: every line here changes how every chat feels. Leave empty for Scorpion's normal voice.</p>
        <textarea id="soul" rows="8" placeholder="${esc(SOUL_EXAMPLE)}">${esc(p.soul)}</textarea>
        <div class="row"><button class="btn primary" data-ps="save-soul">Save</button><button class="btn" data-ps="example">Use the example</button></div>
      </div>
      <div class="field">
        <label>Check-ins</label>
        <label class="toggle"><input type="checkbox" data-ps="hb-enabled"${s.heartbeatEnabled ? ' checked' : ''}><span>Let Scorpion check in on its own</span></label>
        <p class="muted small">On a timer, Scorpion goes through your checklist. It may look at files and folders but never change anything. If nothing needs you, it stays quiet and leaves no trace. Otherwise you get a notification, and the note waits in the "Check-ins" chat. While this is on, closing the window keeps Scorpion running in the tray.</p>
        <div class="row">
          <span>Every</span>
          <select data-ps="hb-minutes">${[15, 30, 60, 120, 240, 480].map((m) => `<option value="${m}"${Number(s.heartbeatMinutes) === m ? ' selected' : ''}>${m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`}</option>`).join('')}</select>
          <span>between</span>
          <input class="text-input narrow" data-ps="hb-hours" value="${esc(s.heartbeatHours || '08:00-22:00')}" title="Active hours, like 08:00-22:00">
        </div>
        <label for="checklist" class="sub">Checklist (HEARTBEAT.md)</label>
        <textarea id="checklist" rows="7" placeholder="- Is anything in my Downloads folder older than 30 days? Tell me how much space it takes.&#10;- Did last night's backup in D:\\Backups finish (is there a file from today)?&#10;- If I have unsaved notes in Documents\\Inbox.md, remind me to sort them.">${esc(p.checklist)}</textarea>
        <div class="row"><button class="btn primary" data-ps="save-checklist">Save checklist</button><button class="btn" data-ps="check-now">Check now</button><span class="muted small">${esc(last)}</span></div>
      </div>`;
  }

  async function reloadPersona() {
    X.persona = await api.personaGet();
    renderPersonality();
  }

  $('#personality-page').addEventListener('click', async (ev) => {
    const act = ev.target.closest('button')?.dataset.ps;
    if (act === 'example') { $('#soul').value = SOUL_EXAMPLE; return; }
    if (act === 'save-soul') { await run(() => api.personaSaveSoul($('#soul').value), () => toast('Personality saved. It applies from the next message.')); return; }
    if (act === 'save-checklist') { await run(() => api.personaSaveChecklist($('#checklist').value), () => toast('Checklist saved.')); return; }
    if (act === 'check-now') {
      await run(() => api.personaSaveChecklist($('#checklist').value));
      if (!$('#checklist').value.trim()) { toast('Write a checklist first.'); return; }
      toast('Checking in…', 2500);
      const r = await run(() => api.personaCheckNow());
      if (r) toast(r.error ? `Check-in failed: ${r.error}` : r.ok ? 'All clear: nothing needs you right now.' : 'Scorpion has a note for you in the Check-ins chat.', 6000);
      reloadPersona();
    }
  });
  $('#personality-page').addEventListener('change', async (ev) => {
    const act = ev.target.dataset.ps;
    const patch = act === 'hb-enabled' ? { heartbeatEnabled: ev.target.checked }
      : act === 'hb-minutes' ? { heartbeatMinutes: Number(ev.target.value) }
        : act === 'hb-hours' ? { heartbeatHours: ev.target.value.trim() } : null;
    if (!patch) return;
    if (patch.heartbeatHours && !/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(patch.heartbeatHours)) { toast('Write the hours like 08:00-22:00'); return; }
    S.settings = await api.updateSettings(patch);
    if (patch.heartbeatEnabled && !$('#checklist').value.trim()) toast('Now write a checklist below, so Scorpion knows what to check.', 6000);
  });

  // ================= Connections =================
  const isLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.|192\.168\.|[^/]+\.local)[:/]?/.test(url || '');

  function sourceForm() {
    const e = X.editingSource;
    if (!e) return '';
    const preset = X.presets[e.kind] || {};
    return `<div class="card">
      <div class="title">${e.id ? `Edit ${esc(e.name)}` : 'Add a model source'}</div>
      <div class="row"><span class="small muted">Kind</span><select data-src-kind>${Object.entries(X.presets).map(([k, p]) => `<option value="${k}"${k === e.kind ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <label class="small muted">Name</label><input class="text-input" id="src-name" value="${esc(e.name)}">
      <label class="small muted">Server address</label><input class="text-input" id="src-url" value="${esc(e.baseUrl)}" placeholder="http://localhost:11434/v1">
      <label class="small muted">API key ${preset.needsKey ? '(needed)' : '(only if the server asks for one)'}${e.hasKey ? ' · one is saved; leave empty to keep it' : ''}</label>
      <input class="text-input" id="src-key" type="password" autocomplete="off" placeholder="${e.hasKey ? '••••••••' : ''}">
      <label class="small muted">Model</label>
      <div class="row"><input class="text-input" id="src-model" list="src-models" value="${esc(e.model)}" placeholder="qwen3:4b"><datalist id="src-models">${X.sourceModels.map((m) => `<option value="${esc(m)}">`).join('')}</datalist><button class="btn small" data-src="load-models">List the server's models</button></div>
      <label class="small muted">Context size (tokens)</label><input class="text-input narrow" id="src-ctx" type="number" min="2048" step="1024" value="${esc(e.contextSize || 32768)}">
      ${!isLocal($('#src-url')?.value || e.baseUrl) && (e.baseUrl || '') ? '<p class="small warn">This is a cloud service: chats that use it are sent to it, with your messages and file contents the agent reads.</p>' : ''}
      <div class="row"><button class="btn primary" data-src="save">Save</button><button class="btn" data-src="cancel">Cancel</button></div>
    </div>`;
  }

  function mcpForm() {
    const e = X.editingMcp;
    if (!e) return '';
    return `<div class="card">
      <div class="title">${e.id ? `Edit ${esc(e.name)}` : 'Add an MCP server'}</div>
      <label class="small muted">Name (its tools show as mcp_name_tool)</label><input class="text-input" id="mcp-name" value="${esc(e.name)}" placeholder="github">
      <div class="row"><span class="small muted">How to reach it</span><select data-mcp-transport>
        <option value="stdio"${e.transport === 'stdio' ? ' selected' : ''}>Start a program on this computer (stdio)</option>
        <option value="http"${e.transport === 'http' ? ' selected' : ''}>Web address (Streamable HTTP)</option>
        <option value="sse"${e.transport === 'sse' ? ' selected' : ''}>Web address (older SSE)</option></select></div>
      ${e.transport === 'stdio' ? `<label class="small muted">Command</label><input class="text-input" id="mcp-command" value="${esc(e.command)}" placeholder="npx">
      <label class="small muted">Arguments</label><input class="text-input" id="mcp-args" value="${esc(e.args)}" placeholder="-y @modelcontextprotocol/server-filesystem C:\\Users\\me\\Documents">
      <label class="small muted">Environment (KEY=value per line; stored encrypted)${e.hasEnv ? ' · saved; leave empty to keep' : ''}</label><textarea id="mcp-env" rows="2" placeholder="GITHUB_TOKEN=..."></textarea>`
    : `<label class="small muted">URL</label><input class="text-input" id="mcp-url" value="${esc(e.url)}" placeholder="https://example.com/mcp">
      <label class="small muted">Headers (Name: value per line; stored encrypted)${e.hasHeaders ? ' · saved; leave empty to keep' : ''}</label><textarea id="mcp-headers" rows="2" placeholder="Authorization: Bearer ..."></textarea>`}
      <label class="toggle"><input type="checkbox" id="mcp-trusted"${e.trusted ? ' checked' : ''}><span>Trust this server: its tools that change things run without asking each time</span></label>
      <div class="row"><button class="btn primary" data-mcp="save">Save and connect</button><button class="btn" data-mcp="cancel">Cancel</button></div>
    </div>`;
  }

  function telegramSection() {
    const t = X.telegram || { state: 'off', allowed: [], pending: [] };
    const state = { on: `Connected as @${esc(t.bot || '?')}`, connecting: 'Connecting…', error: `Problem: ${esc(t.error || 'unknown')}`, off: 'Off' }[t.state] || 'Off';
    return `<h2>Phone (Telegram)</h2>
      <p class="muted small">Talk to Scorpion from your phone through your own Telegram bot: text or voice messages, answered by Scorpion on this computer with your files and models. Phone chats appear here as "Phone: name" chats. Changes and commands ask you with Allow / Deny buttons on the phone. Scorpion keeps running in the tray while this is on. Messages travel through Telegram's servers, and this needs internet even when Online mode is off.</p>
      <ol class="small muted steps"><li>In Telegram, open <b>@BotFather</b>, send <code>/newbot</code>, pick a name, and copy the token it gives you.</li><li>Paste it below and turn it on.</li><li>Message your bot from your phone, then approve yourself here with the code it shows.</li></ol>
      <div class="row"><input class="text-input" id="tg-token" type="password" autocomplete="off" placeholder="${t.hasToken ? 'Token saved (paste a new one to replace it)' : '123456789:ABC…'}"><button class="btn" data-tg="save">Save token</button></div>
      <div class="row"><label class="toggle"><input type="checkbox" data-tg="enabled"${t.enabled ? ' checked' : ''}${t.hasToken ? '' : ' disabled'}><span>On</span></label><span class="small ${t.state === 'error' ? 'warn' : 'muted'}">${state}</span></div>
      ${t.pending.length ? `<div class="small"><b>Waiting for approval</b></div>${t.pending.map((p) => `<div class="row card-row"><span>${esc(p.name)}${p.username ? ` (@${esc(p.username)})` : ''} · code <code>${esc(p.code)}</code></span><button class="btn small primary" data-tg-approve="${p.chatId}">Approve</button><button class="btn small" data-tg-deny="${p.chatId}">Ignore</button></div>`).join('')}` : ''}
      ${t.allowed.length ? `<div class="small"><b>Can talk to Scorpion</b></div>${t.allowed.map((a) => `<div class="row card-row"><span>${esc(a.name)}${a.username ? ` (@${esc(a.username)})` : ''}</span><button class="btn small" data-tg-remove="${a.chatId}">Remove</button></div>`).join('')}` : ''}`;
  }

  function renderConnections() {
    const s = S.settings;
    const sources = X.sources;
    const fallbackOptions = [['', 'Nothing (show the error)'], ['local', 'The model on this computer'], ...sources.map((p) => [p.id, `${p.model || '?'} · ${p.name}`])];
    $('#connections-page').innerHTML = `<h1>Connections</h1>
      <h2>Model sources</h2>
      <p class="muted small">Besides the models on this computer, Scorpion can use a model server: Ollama or LM Studio on this computer, or a cloud service with your own key (OpenAI, OpenRouter, or anything OpenAI-compatible). Pick which one answers in the model menu at the top of a chat.</p>
      <div class="list">${sources.map((p) => `<div class="card">
        <div class="row space"><div class="title">${esc(p.name)} <span class="tag">${p.local ? 'this computer / network' : 'cloud'}</span>${s.chatSource === p.id ? '<span class="tag on">in use</span>' : ''}</div></div>
        <div class="small muted">${esc(p.model || 'no model chosen')} · ${esc(p.baseUrl)}${p.hasKey ? ' · key saved' : ''}</div>
        <div class="row">${s.chatSource === p.id ? '' : `<button class="btn small primary" data-src-use="${esc(p.id)}">Use for chats</button>`}<button class="btn small" data-src-test="${esc(p.id)}">Test</button><button class="btn small" data-src-edit="${esc(p.id)}">Edit</button><button class="btn small" data-src-delete="${esc(p.id)}">Remove</button></div>
      </div>`).join('')}</div>
      ${s.chatSource && s.chatSource !== 'local' ? '<div class="row"><button class="btn small" data-src="use-local">Use the model on this computer again</button></div>' : ''}
      ${X.editingSource ? sourceForm() : '<div class="row"><button class="btn" data-src="add">Add a model source</button></div>'}
      <div class="field"><label>If the chosen model fails before answering, use</label>
        <select data-src-fallback>${fallbackOptions.map(([v, l]) => `<option value="${esc(v)}"${(s.fallbackSource || '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>

      <h2>Tool servers (MCP)</h2>
      <p class="muted small">MCP servers give Scorpion new tools from other programs: GitHub, Notion, databases, file servers and hundreds more. Tools a server marks read-only run freely; the rest ask you first, like file changes, unless you trust the server. Their tools are used in Build and Plan mode.</p>
      <div class="list">${X.mcp.map((m) => `<div class="card">
        <div class="row space"><div class="title">${esc(m.name)} <span class="tag ${m.status === 'connected' ? 'on' : ''}">${{ connected: `${m.tools.length} tools`, error: 'not connected', connecting: 'connecting', off: 'off' }[m.status] || m.status}</span>${m.trusted ? '<span class="tag">trusted</span>' : ''}</div>
          <label class="toggle"><input type="checkbox" data-mcp-enable="${esc(m.id)}"${m.enabled ? ' checked' : ''}><span>On</span></label></div>
        <div class="small muted">${esc(m.transport === 'stdio' ? `${m.command} ${m.args}` : m.url)}</div>
        ${m.error ? `<div class="small warn">${esc(m.error)}</div>` : ''}
        ${m.tools.length ? `<details><summary class="small">Tools</summary><ul class="small muted">${m.tools.map((t) => `<li><b>${esc(t.name)}</b>${t.readOnly ? ' (read-only)' : ''}: ${esc(t.description)}</li>`).join('')}</ul></details>` : ''}
        <div class="row"><button class="btn small" data-mcp-reconnect="${esc(m.id)}">Reconnect</button><button class="btn small" data-mcp-edit="${esc(m.id)}">Edit</button><button class="btn small" data-mcp-delete="${esc(m.id)}">Remove</button></div>
      </div>`).join('')}</div>
      ${X.editingMcp ? mcpForm() : '<div class="row"><button class="btn" data-mcp="add">Add an MCP server</button></div>'}

      <h2>Scorpion's browser</h2>
      <label class="toggle"><input type="checkbox" data-br="enabled"${s.browserEnabled ? ' checked' : ''}><span>In Online mode, let the agent use its own browser window</span></label>
      <p class="muted small">For sites that need clicking, forms or a login, the agent opens pages in a separate Scorpion browser window (its own cookies and logins, never your normal browser). You can watch it and take over. Typing into a site, and buttons like Buy, Send, Delete or Sign up, ask you first. Downloads and pop-ups are blocked.${s.online ? '' : ' Online mode is off, so it is not used now.'}</p>
      <div class="row"><button class="btn small" data-br="show">Show the browser</button><button class="btn small" data-br="close">Close it</button><button class="btn small" data-br="clear">Sign out of everything in it</button></div>

      ${telegramSection()}`;
  }

  async function reloadConnections() {
    const st = await api.state();
    S.settings = st.settings;
    X.sources = st.sources || [];
    X.presets = await api.sourcesPresets();
    X.mcp = await api.mcpList();
    X.telegram = await api.telegramStatus();
    renderConnections();
  }

  const readSourceForm = () => ({
    provider: { ...X.editingSource, name: $('#src-name').value, baseUrl: $('#src-url').value, model: $('#src-model').value, contextSize: Number($('#src-ctx').value) },
    key: $('#src-key').value || (X.editingSource.id ? null : ''),
  });

  $('#connections-page').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    // model sources
    if (d.src === 'add') { X.editingSource = { kind: 'ollama', ...X.presets.ollama, model: '', contextSize: 32768 }; X.sourceModels = []; renderConnections(); return; }
    if (d.src === 'cancel') { X.editingSource = null; renderConnections(); return; }
    if (d.src === 'load-models') {
      const { provider, key } = readSourceForm();
      X.editingSource = provider;
      const list = await run(() => api.sourceModels(provider.id && !key ? { id: provider.id } : { provider, key }));
      if (list) { X.sourceModels = list; renderConnections(); toast(list.length ? `${list.length} models found. Pick one in the Model box.` : 'The server has no models yet.'); }
      return;
    }
    if (d.src === 'save') {
      const { provider, key } = readSourceForm();
      if (!provider.model.trim()) { toast('Choose a model (List the server\'s models helps).'); return; }
      await run(() => api.sourceSave({ provider, key }), (list) => { X.sources = list; X.editingSource = null; renderConnections(); toast('Saved. Pick it in the model menu at the top of a chat.'); });
      return;
    }
    if (d.src === 'use-local') { S.settings = await api.updateSettings({ chatSource: 'local' }); renderAll(); renderConnections(); return; }
    if (d.srcUse) { S.settings = await api.updateSettings({ chatSource: d.srcUse }); renderAll(); renderConnections(); return; }
    if (d.srcEdit) { X.editingSource = { ...X.sources.find((p) => p.id === d.srcEdit) }; X.sourceModels = []; renderConnections(); return; }
    if (d.srcDelete && confirm('Remove this model source? Its saved key is deleted too.')) { await run(() => api.sourceDelete(d.srcDelete), (list) => { X.sources = list; reloadConnections(); }); return; }
    if (d.srcTest) {
      toast('Testing…', 2000);
      await run(() => api.sourceTest(d.srcTest), (r) => toast(`It answered in ${(r.ms / 1000).toFixed(1)} s: "${r.text}"`, 7000));
      return;
    }
    // MCP
    if (d.mcp === 'add') { X.editingMcp = { name: '', transport: 'stdio', command: 'npx', args: '', url: '', trusted: false }; renderConnections(); return; }
    if (d.mcp === 'cancel') { X.editingMcp = null; renderConnections(); return; }
    if (d.mcp === 'save') {
      const e = X.editingMcp;
      const server = { ...e, name: $('#mcp-name').value, command: $('#mcp-command')?.value ?? e.command, args: $('#mcp-args')?.value ?? e.args, url: $('#mcp-url')?.value ?? e.url, trusted: $('#mcp-trusted').checked, enabled: e.enabled !== false };
      const env = $('#mcp-env')?.value || (e.id ? null : '');
      const headers = $('#mcp-headers')?.value || (e.id ? null : '');
      b.disabled = true;
      b.textContent = 'Connecting…';
      await run(() => api.mcpSave({ server, env, headers }), (list) => {
        X.mcp = list;
        X.editingMcp = null;
        renderConnections();
        const m = list.find((x) => x.name === server.name.trim());
        toast(m?.status === 'connected' ? `${m.name} connected: ${m.tools.length} tools.` : `Saved, but it didn't connect: ${m?.error || 'unknown problem'}`, 8000);
      });
      renderConnections();
      return;
    }
    if (d.mcpReconnect) { toast('Connecting…', 2000); await run(() => api.mcpReconnect(d.mcpReconnect), (list) => { X.mcp = list; renderConnections(); }); return; }
    if (d.mcpEdit) { X.editingMcp = { ...X.mcp.find((m) => m.id === d.mcpEdit) }; renderConnections(); return; }
    if (d.mcpDelete && confirm('Remove this MCP server?')) { await run(() => api.mcpDelete(d.mcpDelete), (list) => { X.mcp = list; renderConnections(); }); return; }
    // browser
    if (d.br === 'show') { await run(() => api.browserShow()); return; }
    if (d.br === 'close') { await run(() => api.browserClose()); return; }
    if (d.br === 'clear' && confirm('Sign Scorpion\'s browser out of every site (clears its cookies and saved data)?')) { await run(() => api.browserClear(), () => toast('Done.')); return; }
    // phone
    if (d.tg === 'save') {
      const token = $('#tg-token').value.trim();
      if (!token) { toast('Paste the token from @BotFather first.'); return; }
      await run(() => api.telegramSave({ token, enabled: true }), (t) => { X.telegram = t; renderConnections(); toast(t.state === 'on' ? `Connected as @${t.bot}. Now message your bot from your phone.` : `Saved, but: ${t.error || 'not connected'}`, 8000); });
      return;
    }
    if (d.tgApprove) { await run(() => api.telegramApprove(Number(d.tgApprove)), (t) => { X.telegram = t; renderConnections(); }); return; }
    if (d.tgDeny) { await run(() => api.telegramDeny(Number(d.tgDeny)), (t) => { X.telegram = t; renderConnections(); }); return; }
    if (d.tgRemove && confirm('Stop this person from talking to Scorpion?')) { await run(() => api.telegramRemove(Number(d.tgRemove)), (t) => { X.telegram = t; renderConnections(); }); }
  });

  $('#connections-page').addEventListener('change', async (ev) => {
    const el = ev.target;
    if ('srcKind' in el.dataset) {
      const p = X.presets[el.value];
      X.editingSource = { ...X.editingSource, kind: el.value, name: p.name, baseUrl: p.baseUrl || X.editingSource.baseUrl };
      renderConnections();
      return;
    }
    if ('srcFallback' in el.dataset) { S.settings = await api.updateSettings({ fallbackSource: el.value || null }); return; }
    if ('mcpTransport' in el.dataset) { X.editingMcp = { ...X.editingMcp, name: $('#mcp-name').value, transport: el.value }; renderConnections(); return; }
    if (el.dataset.mcpEnable) {
      const m = X.mcp.find((x) => x.id === el.dataset.mcpEnable);
      await run(() => api.mcpSave({ server: { ...m, enabled: el.checked } }), (list) => { X.mcp = list; renderConnections(); });
      return;
    }
    if (el.dataset.br === 'enabled') { S.settings = await api.updateSettings({ browserEnabled: el.checked }); return; }
    if (el.dataset.tg === 'enabled') { await run(() => api.telegramSave({ enabled: el.checked }), (t) => { X.telegram = t; renderConnections(); }); }
  });

  api.onTelegramStatus?.((t) => { X.telegram = t; if (S.view === 'connections') renderConnections(); });
  api.onOpenView?.((view) => setView(view));

  // ================= Memory page: standing intents and dreaming =================
  function renderMemoryExtras() {
    const d = X.dreams || { last: 0, diary: [] };
    $('#memory-extras').innerHTML = `<h2>When something comes up</h2>
      <p class="muted small">Standing intents: things to do when a topic comes up, not at a time. Say it in a chat, for example "when the launch comes up, remind me to ask who owns rollback".</p>
      <div class="memory-list">${X.intents.map((i) => `<div class="memory"><div class="text">When <b>${esc(i.trigger)}</b> comes up: ${esc(i.action)}${i.once ? ' <span class="tag">once</span>' : ''}</div><span class="meta">${i.fired ? `used ${i.fired}×` : 'not used yet'}</span><button data-intent-del="${esc(i.id)}" title="Delete">✕</button></div>`).join('') || '<div class="muted small">None yet.</div>'}</div>
      <h2>Dreaming</h2>
      <label class="toggle"><input type="checkbox" data-dream="enabled"${S.settings.dreamingEnabled !== false ? ' checked' : ''}><span>Once a day, while the computer is idle, turn what I said into lasting memories</span></label>
      <p class="muted small">Scorpion rereads what you told it since the last time and keeps up to five lasting facts (they show above as "learned while dreaming"; delete any you don't want). It only uses a model on this computer or your own network, never a cloud service. Last dream: ${esc(when(d.last))}.</p>
      <div class="row"><button class="btn small" data-dream="now">Dream now</button></div>
      ${d.diary.length ? `<details><summary class="small">Dream diary</summary>${d.diary.slice(0, 10).map((e) => `<div class="small muted">${esc(when(e.at))}: read ${e.read} messages, ${e.added.length ? `kept ${e.added.map((a) => `"${esc(a.text)}"`).join(', ')}` : 'nothing new'}</div>`).join('')}</details>` : ''}`;
  }

  async function reloadMemoryExtras() {
    X.intents = await api.intentsList();
    X.dreams = await api.memoryDreams();
    renderMemoryExtras();
  }

  $('#memory-extras').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.intentDel) { X.intents = await api.intentsDelete(b.dataset.intentDel); renderMemoryExtras(); return; }
    if (b.dataset.dream === 'now') {
      b.disabled = true;
      b.textContent = 'Dreaming…';
      const e = await run(() => api.memoryDreamNow());
      if (e) toast(e.added.length ? `Kept ${e.added.length} new memor${e.added.length === 1 ? 'y' : 'ies'}.` : `Read ${e.read} messages; nothing new to keep.`, 6000);
      await reloadMemories();
      reloadMemoryExtras();
    }
  });
  $('#memory-extras').addEventListener('change', async (ev) => {
    if (ev.target.dataset.dream === 'enabled') S.settings = await api.updateSettings({ dreamingEnabled: ev.target.checked });
  });
  api.onMemoryChanged?.(() => { reloadMemories(); reloadMemoryExtras(); });

  return {
    show(view) {
      if (view === 'skills') reloadSkills();
      if (view === 'personality') reloadPersona();
      if (view === 'connections') reloadConnections();
      if (view === 'memory') reloadMemoryExtras();
    },
  };
}
