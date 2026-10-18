import { marked } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';

const api = window.kenzo;
const $ = (sel) => document.querySelector(sel);
const S = {
  settings: {}, models: [], catalog: [], threads: [], documents: [], memories: [], engine: {},
  thread: null, running: new Set(), pending: new Map(), downloads: {}, modelStatus: null, view: 'chat',
};

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = (text) => DOMPurify.sanitize(marked.parse(text || '', { breaks: true, gfm: true }));
const base = (p) => String(p || '').split(/[\\/]/).pop();
const gb = (bytes) => (bytes / 1024 ** 3 >= 1 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);

function toast(text, ms = 4000) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), ms);
}

async function refresh() {
  Object.assign(S, await api.state());
  renderAll();
}

// ---------- sidebar ----------
function renderThreads() {
  $('#threads').innerHTML = S.threads.map((t) => `
    <div class="thread ${S.thread?.id === t.id ? 'active' : ''}" data-id="${t.id}">
      ${S.running.has(t.id) ? '<span class="dot"></span>' : ''}
      <span class="t" title="${esc(t.title)}">${esc(t.title)}</span>
      <button class="x" data-del="${t.id}" title="Delete chat">✕</button>
    </div>`).join('') || '<div class="muted small" style="padding:8px">No chats yet</div>';
}

function setView(view) {
  S.view = view;
  for (const v of ['chat', 'models', 'docs', 'memory', 'settings']) $(`#view-${v}`).classList.toggle('hidden', v !== view);
  document.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
}

// ---------- top bar ----------
function renderTopbar() {
  const st = S.modelStatus;
  const loaded = S.engine?.chatModel;
  let cls = '', label = 'No model — open Models';
  if (st?.loading) { cls = 'loading'; label = `Loading ${base(st.name)}${st.progress != null ? ` ${Math.round(st.progress * 100)}%` : '…'}`; }
  else if (loaded) { cls = 'ready'; label = base(loaded).replace(/\.gguf$/i, ''); }
  else if (S.settings.chatModel) label = `${base(S.settings.chatModel).replace(/\.gguf$/i, '')} (not loaded)`;
  $('#model-pill').innerHTML = `<span class="status ${cls}"></span>${esc(label)}`;
  $('#workspace-chip').textContent = S.settings.workspace ? `📁 ${base(S.settings.workspace)}` : '📁 No workspace';
  $('#workspace-chip').title = S.settings.workspace || 'Choose a folder the agent can work in';
  $('#plan-mode').checked = !!S.settings.planMode;
  $('#auto-approve').checked = !!S.settings.autoApprove;
}

// ---------- messages ----------
const STATUS = { running: '⏳ running', ok: '✓ done', error: '✕ failed' };
const TOOL_LABEL = { remember: '🧷 remembered', forget: '🧷 forgot', search_past_chats: '🔎 past chats', search_documents: '🔎 documents' };

function renderPlanSteps(steps) {
  const mark = { done: '✓', in_progress: '▶', pending: '○' };
  return `<ol>${(steps || []).map((s) => `<li class="step ${esc(s.status)}"><span class="mark">${mark[s.status] || '○'}</span><span>${esc(s.title)}</span></li>`).join('')}</ol>`;
}

function renderBlocks(msg, live) {
  const parts = [];
  for (const b of msg.blocks || []) {
    if (b.type === 'text') parts.push(`<div class="md">${md(b.text)}</div>`);
    else if (b.type === 'thought') parts.push(`<details class="thought"${live ? ' open' : ''}><summary>Thinking</summary><div class="body">${esc(b.text)}</div></details>`);
    else if (b.type === 'plan') parts.push(`<div class="plan-block"><div class="title">PLAN</div>${renderPlanSteps(b.steps)}</div>`);
    else if (b.type === 'tool') {
      const approval = S.pending.get(b.id);
      parts.push(`<details class="tool ${b.status}"><summary><span class="name">${esc(TOOL_LABEL[b.name] || b.name)}</span><span class="sum">${esc(b.summary)}</span><span class="st">${approval ? '⏸ waiting' : STATUS[b.status] || ''}</span></summary>${b.output ? `<pre>${esc(b.output)}</pre>` : ''}</details>`);
      if (approval) {
        const detail = b.name === 'write_file' ? b.args.content : b.name === 'edit_file' ? `- ${b.args.find}\n+ ${b.args.replace}` : b.summary;
        parts.push(`<div class="approval"><strong>${b.access === 'exec' ? 'Run this command?' : 'Allow this change?'}</strong>
          <div class="muted small">${esc(b.name)} · ${esc(b.args.path || b.args.subdir || '')}</div>
          <pre>${esc(detail)}</pre>
          <div class="row"><button class="btn primary small" data-approve="${b.id}">Allow</button><button class="btn small" data-deny="${b.id}">Deny</button></div></div>`);
      }
    }
  }
  if (live && !(msg.blocks || []).length) parts.push('<div class="md cursor muted"></div>');
  else if (live && msg.blocks.at(-1)?.type === 'text') parts[parts.length - 1] = parts.at(-1).replace('<div class="md">', '<div class="md cursor">');
  if (msg.error) parts.push(`<div class="err">⚠ ${esc(msg.error)}</div>`);
  if (msg.stopped) parts.push('<div class="muted small">Stopped.</div>');
  return parts.join('');
}

function messageHtml(m, i, msgs) {
  if (m.role === 'user') return `<div class="msg user"><div class="bubble">${esc(m.text)}</div></div>`;
  const live = S.running.has(S.thread.id) && i === msgs.length - 1;
  return `<div class="msg assistant"><div class="meta">Kenzo${m.model ? ` · ${esc(m.model)}` : ''}</div>${renderBlocks(m, live)}</div>`;
}

const SUGGESTIONS = [
  'Explain how a neural network learns, simply.',
  'List the files in my workspace and summarize the project.',
  'Write a Python script that renames photos by date, and save it to the workspace.',
  'Summarize my documents and list the key points.',
];

function renderMessages(keepScroll) {
  const box = $('#messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  if (!S.thread || !S.thread.messages.length) {
    box.innerHTML = `<div class="empty"><h2>What should we work on?</h2>
      <div>Everything runs on your computer. No internet, no API key.</div>
      <div class="suggestions">${SUGGESTIONS.map((s) => `<button class="suggestion">${esc(s)}</button>`).join('')}</div></div>`;
  } else {
    box.innerHTML = S.thread.messages.map(messageHtml).join('');
    box.querySelectorAll('.md pre').forEach((pre) => {
      const b = document.createElement('button');
      b.className = 'copy'; b.textContent = 'Copy'; b.type = 'button';
      b.onclick = () => { navigator.clipboard.writeText(pre.querySelector('code')?.innerText ?? pre.innerText); b.textContent = 'Copied'; };
      pre.appendChild(b);
    });
  }
  if (!keepScroll || nearBottom) box.scrollTop = box.scrollHeight;
  renderPlanPanel();
  const busy = S.thread && S.running.has(S.thread.id);
  $('#send').classList.toggle('hidden', !!busy);
  $('#stop').classList.toggle('hidden', !busy);
}

function renderPlanPanel() {
  const plans = (S.thread?.messages || []).flatMap((m) => (m.blocks || []).filter((b) => b.type === 'plan'));
  const latest = plans.at(-1);
  $('#plan-list').outerHTML = latest ? renderPlanSteps(latest.steps).replace('<ol>', '<ol id="plan-list">') : '<ol id="plan-list"><li class="muted">The agent\'s step-by-step plan appears here for multi-step tasks.</li></ol>';
  if (latest && !renderPlanPanel.shown) { $('#plan-panel').classList.remove('hidden'); renderPlanPanel.shown = true; }
}

let frame = 0;
function scheduleRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; renderMessages(true); });
}

// ---------- models page ----------
function renderModels() {
  const e = S.engine || {};
  $('#engine-info').innerHTML = e.error ? `<span class="err">Engine error: ${esc(e.error)}</span>` : `Hardware acceleration: <strong>${esc(e.gpu === 'cpu' ? 'CPU only' : String(e.gpu).toUpperCase())}</strong>`;
  $('#local-models').innerHTML = S.models.map((m) => {
    const selected = m.path === S.settings.chatModel || m.path === S.settings.embedModel;
    return `<div class="card ${selected ? 'selected' : ''}">
      <div class="title">${esc(m.name)}</div>
      <div><span class="tag">${m.kind === 'embedding' ? 'documents' : 'chat'}</span><span class="tag">${gb(m.bytes)}</span><span class="tag">${m.source}</span>${selected ? '<span class="tag on">in use</span>' : ''}</div>
      <div class="row">${selected ? '' : `<button class="btn small primary" data-use="${esc(m.path)}" data-kind="${m.kind}">Use</button>`}
      ${m.source === 'library' ? `<button class="btn small" data-delmodel="${esc(m.path)}">Delete</button>` : ''}</div></div>`;
  }).join('') || '<div class="muted">No models yet. Download one below or import a .gguf file.</div>';

  const names = S.models.map((m) => m.name.toLowerCase());
  const have = { has: (file) => names.includes(file) };
  $('#catalog').innerHTML = S.catalog.map((c) => {
    const file = c.uri.split('/').pop().replace(/\.gguf$/i, '').toLowerCase();
    const d = S.downloads[c.id];
    const pct = d?.totalSize ? Math.round((d.downloadedSize / d.totalSize) * 100) : 0;
    return `<div class="card"><div class="title">${esc(c.name)}</div>
      <div><span class="tag">${c.kind === 'embedding' ? 'documents' : 'chat'}</span><span class="tag">${esc(c.size)}</span></div>
      <div class="muted small">${esc(c.note)}</div>
      ${have.has(file) ? '<div class="small" style="color:var(--accent)">✓ Installed</div>'
        : d ? `<div class="progress"><div style="width:${pct}%"></div></div><div class="row"><span class="small muted">${pct}% of ${d.totalSize ? gb(d.totalSize) : '…'}</span><button class="btn small" data-cancel="${c.id}">Cancel</button></div>`
        : `<div class="row"><button class="btn small" data-download="${c.id}">Download</button></div>`}
    </div>`;
  }).join('');
}

// ---------- documents page ----------
function renderDocs() {
  $('#doc-list').innerHTML = S.documents.map((d) => `<div class="card"><div class="title">${esc(d.name)}</div>
    <div class="muted small">${d.chunks} passages · ${Math.round(d.chars / 1000)}k characters · added ${new Date(d.addedAt).toLocaleDateString()}</div>
    <div class="row"><button class="btn small" data-deldoc="${d.id}">Remove</button></div></div>`).join('')
    || `<div class="muted">No documents yet.${S.settings.embedModel ? '' : ' First download “Nomic Embed” in Models.'}</div>`;
}

// ---------- memory page ----------
function renderMemory() {
  const list = [...S.memories].reverse();
  $('#memory-list').innerHTML = list.map((m) => `<div class="memory" data-id="${m.id}">
      <div class="text" contenteditable="true" spellcheck="false" title="Click to edit">${esc(m.text)}</div>
      <span class="meta" title="${new Date(m.createdAt).toLocaleString()}">${m.source === 'agent' ? 'learned in chat' : 'added by you'}</span>
      <button data-delmem="${m.id}" title="Delete memory">✕</button></div>`).join('')
    || '<div class="muted">Nothing remembered yet. Tell Kenzo about yourself in a chat, or add a memory above.</div>';
  $('#clear-memory').classList.toggle('hidden', !list.length);
}

async function reloadMemories() {
  S.memories = await api.listMemories();
  renderMemory();
}

// ---------- settings page ----------
function renderSettings() {
  $('#ws-path').textContent = S.settings.workspace || 'Not set';
  $('#ctx-size').value = String(S.settings.contextSize);
  $('#temperature').value = S.settings.temperature;
  $('#temp-val').textContent = S.settings.temperature;
  $('#memory-enabled').checked = !!S.settings.memoryEnabled;
  $('#recall-enabled').checked = !!S.settings.recallEnabled;
  $('#recall-enabled').disabled = !S.settings.memoryEnabled;
  if (document.activeElement !== $('#system-prompt')) $('#system-prompt').value = S.settings.systemPrompt || '';
}

function renderAll() {
  renderThreads(); renderTopbar(); renderModels(); renderDocs(); renderMemory(); renderSettings(); renderMessages();
}

// ---------- actions ----------
async function openThread(id) {
  S.thread = await api.getThread(id);
  renderPlanPanel.shown = false;
  setView('chat');
  renderThreads();
  renderMessages();
}

async function newThread() {
  S.thread = await api.createThread();
  S.threads.unshift({ id: S.thread.id, title: S.thread.title, updatedAt: Date.now() });
  renderPlanPanel.shown = false;
  setView('chat'); renderThreads(); renderMessages();
  $('#input').focus();
}

async function sendMessage(text) {
  text = text.trim();
  if (!text) return;
  if (!S.settings.chatModel) { toast('Pick or download a chat model first.'); setView('models'); return; }
  if (!S.thread) await newThread();
  const thread = S.thread;
  if (S.running.has(thread.id)) return;
  thread.messages.push({ role: 'user', text }, { role: 'assistant', blocks: [], model: base(S.engine?.chatModel || S.settings.chatModel).replace(/\.gguf$/i, '') });
  S.running.add(thread.id);
  $('#input').value = ''; autosize();
  renderThreads(); renderMessages();
  try { await api.send({ threadId: thread.id, text }); } catch (err) {
    S.running.delete(thread.id);
    thread.messages.at(-1).error = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    renderMessages();
  }
}

function applyChatEvent(ev) {
  if (ev.type === 'approval') { S.pending.set(ev.id, ev); }
  if (ev.type === 'memory') { reloadMemories(); return; }
  if (ev.type === 'done') {
    S.running.delete(ev.threadId);
    for (const [id, p] of S.pending) if (p.threadId === ev.threadId) S.pending.delete(id);
    const t = S.threads.find((x) => x.id === ev.threadId);
    if (t && ev.title) t.title = ev.title;
    renderThreads();
    api.state().then((s) => { S.engine = s.engine; renderTopbar(); });
  }
  if (S.thread?.id !== ev.threadId) return;
  const msg = S.thread.messages.at(-1);
  if (!msg || msg.role !== 'assistant') return;
  const blocks = msg.blocks;
  const last = blocks.at(-1);
  switch (ev.type) {
    case 'text': case 'thought':
      if (last?.type === ev.type) last.text += ev.delta; else blocks.push({ type: ev.type, text: ev.delta });
      break;
    case 'tool': blocks.push({ type: 'tool', id: ev.id, name: ev.name, access: ev.access, summary: ev.summary, args: ev.args, status: 'running' }); break;
    case 'tool-result': {
      const b = blocks.find((x) => x.type === 'tool' && x.id === ev.id);
      if (b) Object.assign(b, { status: ev.ok ? 'ok' : 'error', output: ev.output });
      S.pending.delete(ev.id);
      break;
    }
    case 'plan': {
      const p = blocks.find((x) => x.type === 'plan');
      if (p) p.steps = ev.steps; else blocks.push({ type: 'plan', steps: ev.steps });
      break;
    }
    case 'done': if (ev.error) msg.error = ev.error; if (ev.stopped) msg.stopped = true; break;
  }
  scheduleRender();
}

function autosize() {
  const t = $('#input');
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight, 220)}px`;
}

async function setSetting(patch) {
  S.settings = await api.updateSettings(patch);
  renderAll();
}

// ---------- wiring ----------
function wire() {
  $('#new-chat').onclick = newThread;
  document.querySelectorAll('.navbtn').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  $('#threads').onclick = async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      if (!confirm('Delete this chat?')) return;
      await api.deleteThread(del.dataset.del);
      S.threads = S.threads.filter((t) => t.id !== del.dataset.del);
      if (S.thread?.id === del.dataset.del) S.thread = null;
      renderThreads(); renderMessages();
      return;
    }
    const row = e.target.closest('.thread');
    if (row) openThread(row.dataset.id);
  };

  $('#composer').onsubmit = (e) => { e.preventDefault(); sendMessage($('#input').value); };
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage($('#input').value); }
  });
  $('#input').addEventListener('input', autosize);
  $('#stop').onclick = () => S.thread && api.stop(S.thread.id);

  $('#messages').onclick = (e) => {
    const s = e.target.closest('.suggestion');
    if (s) return sendMessage(s.textContent);
    const ok = e.target.closest('[data-approve]');
    const no = e.target.closest('[data-deny]');
    const id = ok?.dataset.approve || no?.dataset.deny;
    if (id) { api.approve({ id, approved: !!ok }); S.pending.delete(id); scheduleRender(); }
  };

  $('#workspace-chip').onclick = async () => { S.settings = await api.chooseWorkspace(); renderAll(); };
  $('#choose-ws').onclick = $('#workspace-chip').onclick;
  $('#open-ws').onclick = () => api.openWorkspace();
  $('#plan-mode').onchange = (e) => setSetting({ planMode: e.target.checked });
  $('#auto-approve').onchange = (e) => {
    if (e.target.checked && !confirm('Auto-approve lets the agent edit files and run commands in your workspace without asking. Turn it on?')) { e.target.checked = false; return; }
    setSetting({ autoApprove: e.target.checked });
  };
  $('#toggle-plan').onclick = () => $('#plan-panel').classList.toggle('hidden');

  $('#import-model').onclick = async () => {
    const file = await api.importModel().catch((err) => toast(err.message));
    if (file) { toast(`Imported ${base(file)}`); refresh(); }
  };
  $('#view-models').onclick = async (e) => {
    const t = e.target;
    if (t.dataset.use) {
      await setSetting(t.dataset.kind === 'embedding' ? { embedModel: t.dataset.use } : { chatModel: t.dataset.use });
    } else if (t.dataset.delmodel) {
      if (confirm(`Delete ${base(t.dataset.delmodel)} from disk?`)) { await api.deleteModel(t.dataset.delmodel); refresh(); }
    } else if (t.dataset.download) {
      const id = t.dataset.download;
      S.downloads[id] = { downloadedSize: 0, totalSize: 0 }; renderModels();
      try { await api.downloadModel(id); toast('Download complete.'); } catch (err) { if (!/abort/i.test(err.message)) toast(`Download failed: ${err.message}`); }
      delete S.downloads[id];
      refresh();
    } else if (t.dataset.cancel) api.cancelDownload(t.dataset.cancel);
  };

  $('#add-docs').onclick = async () => {
    if (!S.settings.embedModel) { toast('Download or choose an embedding model (Nomic Embed) in Models first.'); return; }
    const { added, errors } = await api.addDocuments();
    if (added.length) toast(`Added ${added.length} document${added.length > 1 ? 's' : ''}.`);
    if (errors.length) toast(errors.join('\n'), 8000);
    refresh();
  };
  $('#doc-list').onclick = async (e) => {
    const id = e.target.dataset.deldoc;
    if (id) { await api.removeDocument(id); refresh(); }
  };

  $('#memory-form').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('#memory-input').value.trim();
    if (!text) return;
    await api.addMemory(text);
    $('#memory-input').value = '';
    reloadMemories();
  };
  $('#memory-list').onclick = async (e) => {
    const id = e.target.dataset.delmem;
    if (id) { await api.deleteMemory(id); reloadMemories(); }
  };
  $('#memory-list').addEventListener('focusout', async (e) => {
    const row = e.target.closest('.memory');
    if (!row || !e.target.classList.contains('text')) return;
    const text = e.target.innerText.trim();
    const m = S.memories.find((x) => x.id === row.dataset.id);
    if (!m || text === m.text) return;
    if (!text) await api.deleteMemory(m.id); else await api.updateMemory({ id: m.id, text });
    reloadMemories();
  });
  $('#memory-list').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('text')) { e.preventDefault(); e.target.blur(); }
  });
  $('#clear-memory').onclick = async () => {
    if (!confirm('Delete everything Kenzo remembers about you? Past chats are not deleted.')) return;
    await api.clearMemories();
    reloadMemories();
  };
  $('#memory-enabled').onchange = (e) => setSetting({ memoryEnabled: e.target.checked });
  $('#recall-enabled').onchange = (e) => setSetting({ recallEnabled: e.target.checked });

  $('#ctx-size').onchange = (e) => setSetting({ contextSize: Number(e.target.value) });
  $('#temperature').oninput = (e) => { $('#temp-val').textContent = e.target.value; };
  $('#temperature').onchange = (e) => setSetting({ temperature: Number(e.target.value) });
  $('#save-prompt').onclick = () => { setSetting({ systemPrompt: $('#system-prompt').value }); toast('Saved.'); };

  api.onChatEvent(applyChatEvent);
  api.onModelStatus((st) => {
    S.modelStatus = st;
    if (st.info) S.engine = st.info;
    if (st.error) toast(`Could not load model: ${st.error}`, 8000);
    renderTopbar();
  });
  api.onDownload((p) => { S.downloads[p.id] = p; if (S.view === 'models') renderModels(); });
  api.onDocsProgress((p) => { $('#docs-progress').textContent = p ? `Indexing ${p.name}: ${p.done}/${p.total}` : ''; });
}

wire();
await refresh();
if (S.threads[0]) await openThread(S.threads[0].id);
if (S.settings.chatModel && !S.engine?.chatModel) api.loadModel().catch(() => {});
