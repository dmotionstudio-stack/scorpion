import { marked } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';
import { applyEvent } from '/shared/events.js';

const api = window.scorpion;
const $ = (sel) => document.querySelector(sel);
const S = {
  settings: {}, models: [], catalog: [], threads: [], documents: [], memories: [], agents: [], tools: [], schedules: [], engine: {},
  thread: null, running: new Set(), pending: new Map(), downloads: {}, modelStatus: null, view: 'chat',
  newChatAgent: 'scorpion', newChatMode: savedMode(), editingAgent: null, editingSchedule: null,
};
function savedMode() {
  try { const m = localStorage.getItem('scorpion.mode'); return ['chat', 'plan', 'build'].includes(m) ? m : 'build'; } catch { return 'build'; }
}
const agentById = (id) => S.agents.find((a) => a.id === id) || S.agents[0] || { id: 'scorpion', name: 'Scorpion', icon: '✨' };
const VIEWS = ['chat', 'models', 'docs', 'memory', 'agents', 'schedules', 'settings'];

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = (text) => DOMPurify.sanitize(marked.parse(text || '', { breaks: true, gfm: true }));
const base = (p) => String(p || '').split(/[\\/]/).pop();
const modelName = (p) => S.models.find((m) => m.path === p)?.name || base(p).replace(/\.gguf$/i, '').replace(/^hf_[^_]+_/, '');
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

// Everything except the chat lives under Settings, as tabs.
function setView(view) {
  S.view = view;
  const inSettings = view !== 'chat';
  if (inSettings) S.lastSettingsView = view;
  for (const v of VIEWS) $(`#view-${v}`).classList.toggle('hidden', v !== view);
  $('#settings-header').classList.toggle('hidden', !inSettings);
  document.querySelectorAll('.stab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#open-settings').classList.toggle('active', inSettings);
}

// ---------- top bar ----------
function renderTopbar() {
  renderModelSwitch();
  $('#workspace-chip').textContent = S.settings.workspace ? `📁 ${base(S.settings.workspace)}` : '📁 No workspace';
  $('#workspace-chip').title = S.settings.workspace || 'Choose a folder the agent can work in';
  $('#auto-approve').checked = !!S.settings.autoApprove;
  renderModes();
  const current = S.thread?.agentId || (S.thread ? 'scorpion' : S.newChatAgent);
  $('#agent-picker').innerHTML = S.agents.map((a) => `<option value="${esc(a.id)}"${a.id === current ? ' selected' : ''}>${esc(a.icon)} ${esc(a.name)}</option>`).join('');
  $('#agent-picker').title = agentById(current).description || '';
}

// Model switcher: every chat model in Scorpion's library (and bundled ones).
function renderModelSwitch() {
  const st = S.modelStatus;
  const selected = S.settings.chatModel;
  const chatModels = S.models.filter((m) => m.kind === 'chat');
  // The active model may live outside the scanned folders; list it anyway so
  // the picker never shows a different model than the one actually in use.
  if (selected && !chatModels.some((m) => m.path === selected)) {
    chatModels.unshift({ path: selected, name: modelName(selected), bytes: 0, source: 'other' });
  }
  let cls = '', note = '';
  if (st?.loading) { cls = 'loading'; note = st.progress != null ? `loading ${Math.round(st.progress * 100)}%` : 'loading…'; }
  else if (st?.error) { cls = 'error'; note = 'failed to load'; }
  else if (S.engine?.chatModel && S.engine.chatModel === selected) cls = 'ready';
  else if (selected) note = 'not loaded';
  const sel = $('#model-picker');
  sel.innerHTML = chatModels.length
    ? chatModels.map((m) => `<option value="${esc(m.path)}"${m.path === selected ? ' selected' : ''}>${esc(m.name)}${m.bytes ? ` · ${gb(m.bytes)}` : ''}</option>`).join('')
      + '<option value="__manage">Manage models…</option>'
    : '<option value="__manage">No models — get one…</option>';
  sel.disabled = Boolean(st?.loading) || S.running.size > 0;
  sel.title = st?.error || (S.running.size ? 'Wait for the answer to finish before switching models' : 'Switch the model used for chatting');
  $('#model-status').className = `status ${cls}`;
  $('#model-note').textContent = note;
}

// Modes are per chat; a chat that hasn't been created yet uses the composer's choice.
const MODE_HINTS = {
  chat: 'Just talking. No files or commands.',
  plan: 'Read-only. Scorpion explores and writes a plan.',
  build: 'Scorpion builds it: writes files, runs and fixes them.',
};
function currentMode() {
  return S.thread?.mode || S.newChatMode;
}
function renderModes() {
  const mode = currentMode();
  document.querySelectorAll('#modes [data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  const needsWs = mode !== 'chat' && !S.settings.workspace;
  $('#mode-hint').textContent = needsWs ? `${MODE_HINTS[mode]} Choose a workspace folder first (📁).` : MODE_HINTS[mode];
}

// Spell the plan out so the model starts building instead of assuming the
// steps it proposed are already finished.
function buildPlanMessage() {
  const plans = (S.thread?.messages || []).flatMap((m) => (m.blocks || []).filter((b) => b.type === 'plan'));
  const steps = plans.at(-1)?.steps || [];
  const list = steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n');
  return `Build the plan now. None of these steps are done yet:\n${list}\n\nWork through every step with your tools: write the files, run and test them, fix any errors, and mark each step done as you finish it.`;
}

async function setMode(mode) {
  if (S.thread && S.running.has(S.thread.id)) { toast('Wait for the current answer to finish.'); return; }
  S.newChatMode = mode;
  try { localStorage.setItem('scorpion.mode', mode); } catch { /* storage unavailable */ }
  if (S.thread) S.thread = { ...S.thread, ...(await api.setThreadMode({ id: S.thread.id, mode })) };
  renderModes();
  renderMessages(true);
}

// ---------- messages ----------
const STATUS = { running: '⏳ running', ok: '✓ done', error: '✕ failed' };
const TOOL_LABEL = {
  remember: '🧷 remembered', forget: '🧷 forgot', search_past_chats: '🔎 past chats', search_documents: '🔎 documents',
  run_code: '▶ run code', calculator: '🧮 calculator', read_spreadsheet: '📊 spreadsheet', read_document: '📄 document', move_file: '🗂️ move',
};

function approvalHtml(b) {
  const detail = b.name === 'write_file' ? b.args.content
    : b.name === 'edit_file' ? `- ${b.args.find}\n+ ${b.args.replace}`
    : b.name === 'run_code' ? b.args.code
    : b.summary;
  const q = b.access === 'exec' ? (b.name === 'run_code' ? 'Run this program?' : 'Run this command?') : 'Allow this change?';
  return `<div class="approval"><strong>${q}</strong>
    <div class="muted small">${esc(b.name)} · ${esc(b.args.path || b.args.subdir || b.args.language || '')}</div>
    <pre>${esc(detail)}</pre>
    <div class="row"><button class="btn primary small" data-approve="${b.id}">Allow</button><button class="btn small" data-deny="${b.id}">Deny</button></div></div>`;
}

function toolHtml(b, live) {
  const approval = S.pending.get(b.id);
  const label = b.name === 'ask_agent' ? `${b.agentIcon || '🤝'} ${esc(b.args?.agent || 'agent')}` : esc(TOOL_LABEL[b.name] || b.name);
  const summary = b.name === 'ask_agent' ? b.args?.task : b.summary;
  // A helper agent's own steps and answer render nested inside its card.
  const inner = b.children?.length
    ? `<div class="helper">${renderBlockList(b.children, live && b.status === 'running')}</div>`
    : b.output ? `<pre>${esc(b.output)}</pre>` : '';
  const open = b.name === 'ask_agent' && (b.status === 'running' || hasPending(b.children)) ? ' open' : '';
  return `<details class="tool ${b.status} ${b.name === 'ask_agent' ? 'delegate' : ''}"${open}><summary><span class="name">${label}</span><span class="sum">${esc(summary)}</span><span class="st">${approval ? '⏸ waiting' : STATUS[b.status] || ''}</span></summary>${inner}</details>${approval ? approvalHtml(b) : ''}`;
}

function hasPending(blocks) {
  return (blocks || []).some((x) => S.pending.has(x.id) || hasPending(x.children));
}

function renderBlockList(blocks, live) {
  return blocks.map((b) => {
    if (b.type === 'text') return `<div class="md">${md(b.text)}</div>`;
    if (b.type === 'thought') return `<details class="thought"${live ? ' open' : ''}><summary>Thinking</summary><div class="body">${esc(b.text)}</div></details>`;
    if (b.type === 'plan') return `<div class="plan-block"><div class="title">PLAN</div>${renderPlanSteps(b.steps)}</div>`;
    if (b.type === 'tool') return toolHtml(b, live);
    return '';
  }).join('');
}

function renderPlanSteps(steps) {
  const mark = { done: '✓', in_progress: '▶', pending: '○' };
  return `<ol>${(steps || []).map((s) => `<li class="step ${esc(s.status)}"><span class="mark">${mark[s.status] || '○'}</span><span>${esc(s.title)}</span></li>`).join('')}</ol>`;
}

function renderBlocks(msg, live) {
  const blocks = msg.blocks || [];
  let html = renderBlockList(blocks, live);
  if (live && !blocks.length) html += '<div class="md cursor muted"></div>';
  else if (live && blocks.at(-1)?.type === 'text') html = html.replace(/<div class="md">(?![\s\S]*<div class="md">)/, '<div class="md cursor">');
  if (msg.error) html += `<div class="err">⚠ ${esc(msg.error)}</div>`;
  if (msg.stopped) html += '<div class="muted small">Stopped.</div>';
  return html;
}

function messageHtml(m, i, msgs) {
  if (m.role === 'user') return `<div class="msg user"><div class="bubble">${esc(m.text)}</div></div>`;
  const live = S.running.has(S.thread.id) && i === msgs.length - 1;
  const a = agentById(m.agentId || S.thread.agentId || 'scorpion');
  const modeTag = m.mode && m.mode !== 'build' ? ` <span class="mode-tag">${m.mode === 'plan' ? '📝 plan' : '💬 chat'}</span>` : '';
  // After a plan is written in Plan mode, offer to build it in one click.
  const offerBuild = !live && i === msgs.length - 1 && m.mode === 'plan' && (m.blocks || []).some((b) => b.type === 'plan');
  return `<div class="msg assistant"><div class="meta">${esc(a.icon)} ${esc(a.name)}${m.model ? ` · ${esc(m.model)}` : ''}${modeTag}</div>${renderBlocks(m, live)}${offerBuild ? '<div class="build-plan"><button class="btn primary small" data-build-plan="1">🔨 Build this plan</button></div>' : ''}</div>`;
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
const FIT = {
  fast: ['fit-fast', '⚡ Fast here', 'Fits entirely in the graphics memory of this PC.'],
  ok: ['fit-ok', '✓ Runs here', 'Fits in shared graphics memory.'],
  slow: ['fit-slow', '🐢 Slower here', 'Too big for the graphics card, so part of it runs on the CPU.'],
  'too-big': ['fit-big', '⛔ Too big', 'Likely too large for the memory of this PC.'],
};
const SKILL = {
  agent: ['skill-agent', '🛠 Agent-ready', 'Passed the calculator and Build-mode file tests: can plan, write files and run code.'],
  tools: ['skill-tools', '🔧 Simple tools', 'Uses simple tools (like the calculator) but struggles with multi-step Build tasks.'],
  chat: ['skill-chat', '💬 Chat only', 'Did not use tools reliably in testing. Best for conversation.'],
};
const skillTag = (skill) => (SKILL[skill] ? `<span class="tag ${SKILL[skill][0]}" title="${SKILL[skill][2]}">${SKILL[skill][1]}</span>` : '');
const fitTag = (fit) => (FIT[fit] ? `<span class="tag ${FIT[fit][0]}" title="${FIT[fit][2]}">${FIT[fit][1]}</span>` : '');

function renderModels() {
  const e = S.engine || {};
  $('#engine-info').innerHTML = e.error ? `<span class="err">Engine error: ${esc(e.error)}</span>` : `Hardware acceleration: <strong>${esc(e.gpu === 'cpu' ? 'CPU only' : String(e.gpu).toUpperCase())}</strong>${e.totalLayers ? ` · ${e.gpuLayers} of ${e.totalLayers} layers on GPU · ${e.contextSize} token context${e.flashAttention ? ' · flash attention' : ''}` : ''}${S.hardware?.dedicatedVram ? ` · ${gb(S.hardware.dedicatedVram)} graphics memory` : ''}`;
  $('#local-models').innerHTML = S.models.map((m) => {
    const selected = m.path === S.settings.chatModel || m.path === S.settings.embedModel;
    return `<div class="card ${selected ? 'selected' : ''}">
      <div class="title">${esc(m.name)}</div>
      <div><span class="tag">${m.kind === 'embedding' ? 'documents' : 'chat'}</span><span class="tag">${gb(m.bytes)}</span><span class="tag">${m.source}</span>${fitTag(m.fit)}${skillTag(m.skill)}${selected ? '<span class="tag on">in use</span>' : ''}</div>
      <div class="row">${selected ? '' : `<button class="btn small primary" data-use="${esc(m.path)}" data-kind="${m.kind}">Use</button>`}
      ${m.source === 'library' ? `<button class="btn small" data-delmodel="${esc(m.path)}" data-size="${m.bytes}">Uninstall</button>` : '<span class="muted small">Comes with the installer</span>'}</div></div>`;
  }).join('') || '<div class="muted">No models installed. Download one below (⚡ runs best on this PC) or import a .gguf file.</div>';

  const installed = (c) => {
    const want = c.uri.split('/').pop().replace(/\.gguf$/i, '').toLowerCase();
    return S.models.find((m) => m.source === 'library' && m.name.toLowerCase() === want);
  };
  $('#catalog').innerHTML = S.catalog.map((c) => {
    const d = S.downloads[c.id];
    const pct = d?.totalSize ? Math.round((d.downloadedSize / d.totalSize) * 100) : 0;
    const local = installed(c);
    return `<div class="card${local ? ' selected' : ''}"><div class="title">${esc(c.name)}</div>
      <div><span class="tag">${c.kind === 'embedding' ? 'documents' : 'chat'}</span><span class="tag">${esc(c.size)}</span>${fitTag(c.fit)}${skillTag(c.skill)}</div>
      <div class="muted small">${esc(c.note)}</div>
      ${d ? `<div class="progress"><div style="width:${pct}%"></div></div><div class="row"><span class="small muted">${pct}% of ${d.totalSize ? gb(d.totalSize) : '…'}</span><button class="btn small" data-cancel="${c.id}">Cancel</button></div>`
        : local ? `<div class="row"><span class="small installed">✓ Installed</span><button class="btn small" data-uninstall="${c.id}" data-size="${local.bytes}">Uninstall</button><button class="btn small" data-reinstall="${c.id}" title="Delete and download a fresh copy">Reinstall</button></div>`
        : `<div class="row"><button class="btn small primary" data-download="${c.id}">Download</button></div>`}
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
    || '<div class="muted">Nothing remembered yet. Tell Scorpion about yourself in a chat, or add a memory above.</div>';
  $('#clear-memory').classList.toggle('hidden', !list.length);
}

async function reloadMemories() {
  S.memories = await api.listMemories();
  renderMemory();
}

// ---------- agents page ----------
const ACCESS_LABEL = { read: 'reads', write: 'changes files', exec: 'runs programs', memory: 'memory', plan: 'planning', agent: 'teamwork' };

function renderAgents() {
  $('#agent-list').innerHTML = S.agents.map((a) => {
    const tools = a.tools.includes('*') ? 'All tools' : `${a.tools.length} tools`;
    return `<div class="card agent-card">
      <div class="title"><span class="agent-icon">${esc(a.icon)}</span> ${esc(a.name)} ${a.builtin ? '' : '<span class="tag">custom</span>'}</div>
      <div class="muted small">${esc(a.description)}</div>
      <div class="small muted">${esc(tools)}</div>
      <div class="row">
        <button class="btn small primary" data-chat-agent="${esc(a.id)}">Chat</button>
        ${a.builtin ? `<button class="btn small" data-dup-agent="${esc(a.id)}">Duplicate</button>`
          : `<button class="btn small" data-edit-agent="${esc(a.id)}">Edit</button><button class="btn small" data-del-agent="${esc(a.id)}">Delete</button>`}
      </div></div>`;
  }).join('');
  renderAgentEditor();
}

function renderAgentEditor() {
  const a = S.editingAgent;
  $('#agent-editor').classList.toggle('hidden', !a);
  if (!a) return;
  $('#agent-editor-title').textContent = a.id ? `Edit ${a.name}` : 'New agent';
  $('#ae-name').value = a.name || '';
  $('#ae-icon').value = a.icon || '🤖';
  $('#ae-description').value = a.description || '';
  $('#ae-instructions').value = a.instructions || '';
  $('#ae-temp').value = a.temperature ?? 0.6;
  $('#ae-temp-val').textContent = a.temperature ?? 0.6;
  const all = a.tools?.includes('*');
  $('#ae-all-tools').checked = !!all;
  $('#ae-tools').innerHTML = S.tools.map((t) => `<label class="toggle tool-choice" title="${esc(t.description)}">
      <input type="checkbox" value="${esc(t.name)}"${all || a.tools?.includes(t.name) ? ' checked' : ''}${all ? ' disabled' : ''}>
      <span><code>${esc(t.name)}</code> <span class="muted small">${esc(ACCESS_LABEL[t.access] || t.access)}</span></span></label>`).join('');
}

function readAgentEditor() {
  const all = $('#ae-all-tools').checked;
  return {
    id: S.editingAgent?.id,
    name: $('#ae-name').value,
    icon: $('#ae-icon').value,
    description: $('#ae-description').value,
    instructions: $('#ae-instructions').value,
    temperature: Number($('#ae-temp').value),
    tools: all ? ['*'] : [...document.querySelectorAll('#ae-tools input:checked')].map((i) => i.value),
  };
}

// ---------- schedules page ----------
function describeTrigger(t) {
  if (t.type === 'interval') return t.minutes % 60 === 0 ? `Every ${t.minutes / 60} hour${t.minutes === 60 ? '' : 's'}` : `Every ${t.minutes} minutes`;
  if (t.type === 'daily') return `Every day at ${t.time}`;
  return `When files change in ${base(t.folder)}`;
}

function renderSchedules() {
  $('#schedule-list').innerHTML = S.schedules.map((s) => {
    const a = agentById(s.agentId);
    const status = s.lastStatus === 'running' ? '<span class="tag on">running…</span>'
      : s.lastStatus?.startsWith('error') ? `<span class="tag err-tag" title="${esc(s.lastStatus)}">last run failed</span>`
      : s.lastRunAt ? `<span class="tag">last run ${esc(new Date(s.lastRunAt).toLocaleString())}</span>` : '<span class="tag">never run</span>';
    const next = s.nextRunAt && s.enabled ? `<span class="tag">next ${esc(new Date(s.nextRunAt).toLocaleString())}</span>` : '';
    return `<div class="card schedule ${s.enabled ? '' : 'disabled'}">
      <div class="title">⏰ ${esc(s.name)}</div>
      <div class="small">${esc(a.icon)} ${esc(a.name)} · ${esc(describeTrigger(s.trigger))}${s.allowChanges ? ' · may change files' : ' · read-only'}</div>
      <div class="muted small clamp">${esc(s.prompt)}</div>
      <div>${status}${next}</div>
      <div class="row">
        <button class="btn small primary" data-run-sched="${s.id}"${s.lastStatus === 'running' ? ' disabled' : ''}>Run now</button>
        ${s.threadId ? `<button class="btn small" data-open-sched="${s.threadId}">Results</button>` : ''}
        <button class="btn small" data-edit-sched="${s.id}">Edit</button>
        <label class="toggle small"><input type="checkbox" data-toggle-sched="${s.id}"${s.enabled ? ' checked' : ''}><span>On</span></label>
        <button class="btn small" data-del-sched="${s.id}">Delete</button>
      </div></div>`;
  }).join('') || '<div class="muted">No scheduled agents yet.</div>';
  $('#open-at-login').checked = !!S.openAtLogin;
  renderScheduleEditor();
}

function renderScheduleEditor() {
  const s = S.editingSchedule;
  $('#schedule-editor').classList.toggle('hidden', !s);
  if (!s) return;
  $('#schedule-editor-title').textContent = s.id ? `Edit ${s.name}` : 'New scheduled agent';
  $('#se-name').value = s.name || '';
  $('#se-agent').innerHTML = S.agents.map((a) => `<option value="${esc(a.id)}"${a.id === (s.agentId || 'scorpion') ? ' selected' : ''}>${esc(a.icon)} ${esc(a.name)}</option>`).join('');
  $('#se-prompt').value = s.prompt || '';
  const t = s.trigger || { type: 'daily', time: '08:00' };
  $('#se-trigger').value = t.type;
  $('#se-minutes').value = t.minutes || 60;
  $('#se-time').value = t.time || '08:00';
  $('#se-folder').textContent = t.folder || 'No folder chosen';
  $('#se-folder').dataset.path = t.folder || '';
  $('#se-workspace').textContent = s.workspace || 'Same as Settings';
  $('#se-workspace').dataset.path = s.workspace || '';
  $('#se-allow').checked = !!s.allowChanges;
  showTriggerFields();
}

function showTriggerFields() {
  const type = $('#se-trigger').value;
  $('#se-interval-row').classList.toggle('hidden', type !== 'interval');
  $('#se-daily-row').classList.toggle('hidden', type !== 'daily');
  $('#se-folder-row').classList.toggle('hidden', type !== 'folder');
  $('#se-workspace-row').classList.toggle('hidden', type === 'folder');
}

function readScheduleEditor() {
  const type = $('#se-trigger').value;
  return {
    id: S.editingSchedule?.id,
    name: $('#se-name').value,
    agentId: $('#se-agent').value,
    prompt: $('#se-prompt').value,
    trigger: type === 'interval' ? { type, minutes: Number($('#se-minutes').value) }
      : type === 'daily' ? { type, time: $('#se-time').value }
      : { type, folder: $('#se-folder').dataset.path },
    workspace: $('#se-workspace').dataset.path || null,
    allowChanges: $('#se-allow').checked,
    enabled: S.editingSchedule?.enabled ?? true,
  };
}

async function reloadSchedules() {
  S.schedules = await api.listSchedules();
  if (S.view === 'schedules') renderSchedules();
}

const errText = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// ---------- settings page ----------
function renderSettings() {
  $('#ws-path').textContent = S.settings.workspace || 'Not set';
  $('#ctx-size').value = String(S.settings.contextSize);
  $('#gpu-layers').value = String(S.settings.gpuLayers ?? 'auto');
  $('#glass').value = S.settings.glass === 'off' ? 'off' : 'auto';
  $('#glass-hint').textContent = S.nativeGlass
    ? 'Uses your system\'s real glass effect: the desktop shows through, blurred.'
    : 'Your system has no native glass effect, so Scorpion draws a frosted look itself.';
  $('#temperature').value = S.settings.temperature;
  $('#temp-val').textContent = S.settings.temperature;
  $('#memory-enabled').checked = !!S.settings.memoryEnabled;
  $('#recall-enabled').checked = !!S.settings.recallEnabled;
  $('#recall-enabled').disabled = !S.settings.memoryEnabled;
  if (document.activeElement !== $('#system-prompt')) $('#system-prompt').value = S.settings.systemPrompt || '';
}

// Theme palettes for the picker previews (the real colours live in themes.css).
const THEMES = [
  { id: 'classic', name: 'Classic', note: 'yellow & black', bg: '#0e0d0b', side: '#161512', accent: '#f5c518', text: '#f2eee2' },
  { id: 'hellfire', name: 'Hellfire', note: 'fire orange', bg: '#0f0807', side: '#170d0b', accent: '#ff6a1a', text: '#f7ece6' },
  { id: 'bloodmoon', name: 'Blood Moon', note: 'crimson', bg: '#0d0709', side: '#160b0f', accent: '#e0243c', text: '#f5e9ec' },
  { id: 'smoke', name: 'Smoke', note: 'steel & amber', bg: '#101214', side: '#171a1d', accent: '#f0a830', text: '#e8ecef' },
  { id: 'molten', name: 'Molten', note: 'bronze & copper', bg: '#100c08', side: '#18120c', accent: '#e08a32', text: '#f4ece2' },
  { id: 'bone', name: 'Bone', note: 'light', bg: '#f3eee3', side: '#fbf8f1', accent: '#d4a20f', text: '#1d1a14' },
];

function applyTheme() {
  const theme = THEMES.some((t) => t.id === S.settings.theme) ? S.settings.theme : 'classic';
  document.documentElement.dataset.theme = theme;
}

function renderThemePicker() {
  const current = document.documentElement.dataset.theme;
  $('#theme-grid').innerHTML = THEMES.map((t) => `<button class="theme-card${t.id === current ? ' active' : ''}" data-theme-id="${t.id}" type="button" aria-pressed="${t.id === current}">
      <div class="theme-preview" style="background:${t.bg}">
        <div class="side" style="background:${t.side}"><i style="background:${t.accent}"></i><i style="background:${t.text}"></i><i style="background:${t.text}"></i></div>
        <div class="content"><i style="background:${t.text};opacity:.35;width:80%"></i><i style="background:${t.text};opacity:.35;width:55%"></i><i style="background:${t.accent};width:35%;align-self:flex-end"></i></div>
      </div>
      <div class="label">${t.name}<small>${t.note}</small></div></button>`).join('');
}

function applyGlass() {
  const root = document.documentElement;
  root.classList.toggle('glass-native', S.glass === 'native');
  root.classList.toggle('glass-css', S.glass === 'css');
}

function renderAll() {
  applyTheme();
  applyGlass();
  renderThemePicker();
  renderThreads(); renderTopbar(); renderModels(); renderDocs(); renderMemory(); renderAgents(); renderSchedules(); renderSettings(); renderMessages();
}

// ---------- actions ----------
async function openThread(id) {
  S.thread = await api.getThread(id);
  renderPlanPanel.shown = false;
  setView('chat');
  renderThreads();
  renderTopbar();
  renderMessages();
}

async function newThread(agentId) {
  S.thread = await api.createThread({ agentId: typeof agentId === 'string' ? agentId : S.newChatAgent, mode: S.newChatMode });
  renderTopbar();
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
  thread.messages.push({ role: 'user', text }, { role: 'assistant', blocks: [], agentId: thread.agentId, model: S.engine?.chatModelName || modelName(S.settings.chatModel) });
  S.running.add(thread.id);
  $('#input').value = ''; autosize();
  renderThreads(); renderModelSwitch(); renderMessages();
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
  if (ev.type === 'tool-result') S.pending.delete(ev.id);
  if (ev.type === 'start') {
    // Runs started elsewhere (scheduled agents) show up live too.
    S.running.add(ev.threadId);
    renderThreads();
    renderModelSwitch();
    if (S.thread?.id === ev.threadId && S.thread.messages.at(-1)?.role !== 'assistant') {
      api.getThread(ev.threadId).then((t) => { if (S.thread?.id === t.id) { S.thread = t; renderMessages(); } });
    }
    return;
  }
  if (S.thread?.id !== ev.threadId) return;
  const msg = S.thread.messages.at(-1);
  if (!msg || msg.role !== 'assistant') return;
  if (ev.type === 'done') {
    if (ev.error) msg.error = ev.error;
    if (ev.stopped) msg.stopped = true;
  } else applyEvent(msg.blocks, ev);
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
  document.querySelectorAll('.stab').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  $('#open-settings').onclick = () => (S.view === 'chat' ? setView(S.lastSettingsView || 'settings') : setView('chat'));
  $('#back-to-chat').onclick = () => setView('chat');
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.view !== 'chat') setView('chat'); });
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
    if (e.target.closest('[data-build-plan]')) {
      setMode('build').then(() => sendMessage(buildPlanMessage()));
      return;
    }
    const ok = e.target.closest('[data-approve]');
    const no = e.target.closest('[data-deny]');
    const id = ok?.dataset.approve || no?.dataset.deny;
    if (id) { api.approve({ id, approved: !!ok }); S.pending.delete(id); scheduleRender(); }
  };

  $('#workspace-chip').onclick = async () => { S.settings = await api.chooseWorkspace(); renderAll(); };
  $('#choose-ws').onclick = $('#workspace-chip').onclick;
  $('#open-ws').onclick = () => api.openWorkspace();
  $('#modes').onclick = (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); };
  $('#model-picker').onchange = async (e) => {
    const value = e.target.value;
    if (value === '__manage') { renderModelSwitch(); setView('models'); return; }
    S.modelStatus = { loading: true, name: modelName(value) };
    await setSetting({ chatModel: value });
    toast(`Switching to ${modelName(value)}…`, 2500);
  };
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
    } else if (t.dataset.delmodel || t.dataset.uninstall) {
      const name = t.dataset.delmodel ? modelName(t.dataset.delmodel) : S.catalog.find((c) => c.id === t.dataset.uninstall)?.name;
      const size = Number(t.dataset.size) ? ` and free ${gb(Number(t.dataset.size))}` : '';
      if (!confirm(`Uninstall ${name}${size}? You can download it again any time.`)) return;
      try {
        await (t.dataset.delmodel ? api.deleteModel(t.dataset.delmodel) : api.uninstallCatalogModel(t.dataset.uninstall));
        toast(`${name} uninstalled.`);
      } catch (err) { toast(errText(err)); }
      refresh();
    } else if (t.dataset.download || t.dataset.reinstall) {
      const id = t.dataset.download || t.dataset.reinstall;
      const item = S.catalog.find((c) => c.id === id);
      if (t.dataset.reinstall && !confirm(`Reinstall ${item.name}? It will be deleted and downloaded again (${item.size}).`)) return;
      S.downloads[id] = { downloadedSize: 0, totalSize: 0 }; renderModels();
      try {
        await (t.dataset.reinstall ? api.reinstallModel(id) : api.downloadModel(id));
        toast(`${item.name} ${t.dataset.reinstall ? 'reinstalled' : 'installed'}.`);
      } catch (err) { if (!/abort/i.test(err.message)) toast(`Download failed: ${errText(err)}`); }
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
    if (!confirm('Delete everything Scorpion remembers about you? Past chats are not deleted.')) return;
    await api.clearMemories();
    reloadMemories();
  };
  $('#memory-enabled').onchange = (e) => setSetting({ memoryEnabled: e.target.checked });
  $('#recall-enabled').onchange = (e) => setSetting({ recallEnabled: e.target.checked });

  $('#ctx-size').onchange = (e) => setSetting({ contextSize: Number(e.target.value) });
  $('#theme-grid').onclick = async (e) => {
    const card = e.target.closest('[data-theme-id]');
    if (!card) return;
    S.settings.theme = card.dataset.themeId;
    applyTheme();
    renderThemePicker();
    await setSetting({ theme: card.dataset.themeId });
  };
  $('#glass').onchange = async (e) => {
    await setSetting({ glass: e.target.value });
    S.glass = (await api.state()).glass;
    applyGlass();
  };
  $('#gpu-layers').onchange = (e) => { const v = e.target.value; setSetting({ gpuLayers: v === 'auto' || v === 'max' ? v : Number(v) }); toast('Reloading the model…'); };
  $('#temperature').oninput = (e) => { $('#temp-val').textContent = e.target.value; };
  $('#temperature').onchange = (e) => setSetting({ temperature: Number(e.target.value) });
  $('#save-prompt').onclick = () => { setSetting({ systemPrompt: $('#system-prompt').value }); toast('Saved.'); };

  // agent picker: switches this chat's agent, or sets the agent for the next chat
  $('#agent-picker').onchange = async (e) => {
    const agentId = e.target.value;
    if (!S.thread || !S.thread.messages.length) S.newChatAgent = agentId;
    if (S.thread) {
      if (S.running.has(S.thread.id)) { toast('Wait for the current answer to finish.'); renderTopbar(); return; }
      S.thread = await api.setThreadAgent({ id: S.thread.id, agentId });
    }
    renderTopbar();
    toast(`${agentById(agentId).icon} ${agentById(agentId).name} is answering in this chat.`, 2500);
  };

  $('#view-agents').onclick = async (e) => {
    const d = e.target.dataset;
    if (d.chatAgent) { S.newChatAgent = d.chatAgent; await newThread(d.chatAgent); }
    else if (d.dupAgent) { const a = agentById(d.dupAgent); S.editingAgent = { ...a, id: undefined, builtin: false, name: `${a.name} copy` }; renderAgentEditor(); $('#ae-name').focus(); }
    else if (d.editAgent) { S.editingAgent = structuredClone(agentById(d.editAgent)); renderAgentEditor(); }
    else if (d.delAgent) {
      if (!confirm(`Delete the agent "${agentById(d.delAgent).name}"? Chats that use it switch to Scorpion.`)) return;
      await api.deleteAgent(d.delAgent); refresh();
    }
  };
  $('#new-agent').onclick = () => { S.editingAgent = { name: '', icon: '🤖', description: '', instructions: '', tools: ['*'], temperature: 0.6 }; renderAgentEditor(); $('#ae-name').focus(); };
  $('#ae-all-tools').onchange = (e) => document.querySelectorAll('#ae-tools input').forEach((i) => { i.disabled = e.target.checked; if (e.target.checked) i.checked = true; });
  $('#ae-temp').oninput = (e) => { $('#ae-temp-val').textContent = e.target.value; };
  $('#ae-cancel').onclick = () => { S.editingAgent = null; renderAgentEditor(); };
  $('#agent-editor').onsubmit = async (e) => {
    e.preventDefault();
    try { await api.saveAgent(readAgentEditor()); S.editingAgent = null; toast('Agent saved.'); refresh(); } catch (err) { toast(errText(err)); }
  };

  $('#new-schedule').onclick = () => { S.editingSchedule = { agentId: 'scorpion', trigger: { type: 'daily', time: '08:00' } }; renderScheduleEditor(); $('#se-name').focus(); };
  $('#se-trigger').onchange = showTriggerFields;
  $('#se-pick-folder').onclick = async () => { const f = await api.chooseFolder(); if (f) { $('#se-folder').textContent = f; $('#se-folder').dataset.path = f; } };
  $('#se-pick-workspace').onclick = async () => { const f = await api.chooseFolder(); if (f) { $('#se-workspace').textContent = f; $('#se-workspace').dataset.path = f; } };
  $('#se-cancel').onclick = () => { S.editingSchedule = null; renderScheduleEditor(); };
  $('#schedule-editor').onsubmit = async (e) => {
    e.preventDefault();
    const data = readScheduleEditor();
    if (data.allowChanges && !S.editingSchedule?.allowChanges && !confirm('This agent will change files and run programs on its own, without asking. Allow that?')) return;
    try { await api.saveSchedule(data); S.editingSchedule = null; toast('Schedule saved.'); reloadSchedules(); renderScheduleEditor(); } catch (err) { toast(errText(err)); }
  };
  $('#schedule-list').addEventListener('click', async (e) => {
    const d = e.target.dataset;
    if (d.runSched) { await api.runSchedule(d.runSched); toast('Started. Results appear in its chat.'); setTimeout(reloadSchedules, 500); }
    else if (d.openSched) openThread(d.openSched);
    else if (d.editSched) { S.editingSchedule = structuredClone(S.schedules.find((s) => s.id === d.editSched)); renderScheduleEditor(); }
    else if (d.delSched) { if (confirm('Delete this scheduled agent? Its results chat is kept.')) { await api.deleteSchedule(d.delSched); reloadSchedules(); } }
  });
  $('#schedule-list').addEventListener('change', async (e) => {
    const id = e.target.dataset.toggleSched;
    if (!id) return;
    const s = S.schedules.find((x) => x.id === id);
    try { await api.saveSchedule({ ...s, enabled: e.target.checked }); } catch (err) { toast(errText(err)); }
    reloadSchedules();
  });
  $('#open-at-login').onchange = async (e) => { S.openAtLogin = await api.setOpenAtLogin(e.target.checked); };

  api.onThreadsChanged(async () => { S.threads = (await api.state()).threads; renderThreads(); });
  api.onSchedulesChanged(reloadSchedules);
  api.onOpenThread((id) => openThread(id));
  api.onChatEvent(applyChatEvent);
  api.onModelStatus((st) => {
    S.modelStatus = st;
    if (st.info) S.engine = st.info;
    if (st.error) toast(`Could not load model: ${st.error}`, 8000);
    renderTopbar();
    if (!st.loading) renderModels();
  });
  api.onDownload((p) => { S.downloads[p.id] = p; if (S.view === 'models') renderModels(); });
  api.onDocsProgress((p) => { $('#docs-progress').textContent = p ? `Indexing ${p.name}: ${p.done}/${p.total}` : ''; });
}

wire();
await refresh();
if (S.threads[0]) await openThread(S.threads[0].id);
if (S.settings.chatModel && !S.engine?.chatModel) api.loadModel().catch(() => {});
