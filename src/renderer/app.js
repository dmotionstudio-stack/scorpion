import { marked } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';
import { applyEvent } from '/shared/events.js';
import { Recorder, Speaker } from './voice.js';
import { FaceCam, drawFaces } from './facecam.js';
import { initLibrary } from './library-ui.js';
import { initExtras } from './extras-ui.js';
import { initHome } from './home-ui.js';
import { initDesktop } from './desktop-ui.js';
import { initOrbSystem } from './orb-system.js';
import { initHandControl } from './hand-control.js';
import { HandTracker, cameraError } from './gestures.js';
import { initWelcome } from './welcome.js';
import { initLookSettings } from './settings-look.js';
import { initPalette } from './palette.js';
import { initSystemSettings } from './settings-system.js';

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
const agentById = (id) => S.agents.find((a) => a.id === id) || S.agents[0] || { id: 'scorpion', name: 'Scorpion' };
// Line icons (drawn in the theme colour) for the few icon-only buttons.
const svg = (paths) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ICON = {
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  speaker: svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  speakerOff: svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/>'),
};
const VIEWS = ['home', 'chat', 'library', 'apps', 'files', 'models', 'docs', 'memory', 'agents', 'skills', 'personality', 'schedules', 'people', 'connections', 'settings'];

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
  document.documentElement.dataset.perf = S.perf || 'full';
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
// Home, chat and Library are the main places; everything else is a Settings tab.
const MAIN_VIEWS = ['home', 'chat', 'library', 'apps', 'files'];
function setView(view) {
  S.view = view;
  const inSettings = !MAIN_VIEWS.includes(view);
  if (inSettings) S.lastSettingsView = view; else S.lastMainView = view;
  for (const v of VIEWS) $(`#view-${v}`).classList.toggle('hidden', v !== view);
  $('#settings-header').classList.toggle('hidden', !inSettings);
  document.querySelectorAll('.stab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#open-settings').classList.toggle('active', inSettings);
  $('#open-library').classList.toggle('active', view === 'library');
  $('#open-home').classList.toggle('active', view === 'home');
  $('#threads').classList.toggle('off-chat', view !== 'chat'); // the open chat is highlighted only in the chat view
  if (view === 'home') home?.show();
  if (view === 'settings') desktopUi?.renderSettings();
  extras?.show(view);
}
let extras = null; // Skills, Personality, Connections and the Memory page extras
let home = null; // the home screen (home-ui.js)
let desktopUi = null; // Apps, Files and Settings → Windows desktop (desktop-ui.js)
let orbSys = null; // the orb as the whole system (orb-system.js)
let hands = null; // hand gestures on Scorpion's own screens (hand-control.js)
let welcome = null; // the spoken first start (welcome.js)
let lookSettings = null; // Settings → General: Performance, the orb's look (settings-look.js)
let palette = null; // the command palette, Ctrl+K (palette.js)
let systemSettings = null; // Settings → This computer on Scorpion OS (settings-system.js)

// ---------- top bar ----------
function renderTopbar() {
  renderModelSwitch();
  const ws = S.thread?.workspace || S.settings.workspace;
  $('#workspace-chip').innerHTML = `${ICON.folder}<span>${esc(ws ? base(ws) : 'No workspace')}</span>`;
  $('#workspace-chip').title = ws ? `${ws}\nThis chat's workspace. Click to choose another folder.` : 'Choose a folder the agent can work in';
  $('#auto-approve').checked = !!S.settings.autoApprove;
  renderModes();
  const current = S.thread?.agentId || (S.thread ? 'scorpion' : S.newChatAgent);
  $('#agent-picker').innerHTML = S.agents.map((a) => `<option value="${esc(a.id)}"${a.id === current ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
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
  // Other model sources (Ollama, LM Studio, a cloud server) from Connections.
  const sources = S.settings.providers || [];
  const remoteId = sources.some((p) => p.id === S.settings.chatSource) ? S.settings.chatSource : null;
  let cls = '', note = '';
  if (remoteId) { cls = 'ready'; note = ''; }
  else if (st?.loading) { cls = 'loading'; note = st.progress != null ? `loading ${Math.round(st.progress * 100)}%` : 'loading…'; }
  else if (st?.error) { cls = 'error'; note = 'failed to load'; }
  else if (S.engine?.chatModel && S.engine.chatModel === selected) cls = 'ready';
  else if (selected) note = 'not loaded';
  const sel = $('#model-picker');
  const local = chatModels.map((m) => `<option value="${esc(m.path)}"${!remoteId && m.path === selected ? ' selected' : ''}>${esc(m.name)}${m.bytes ? ` · ${gb(m.bytes)}` : ''}</option>`).join('');
  const remote = sources.map((p) => `<option value="source:${esc(p.id)}"${p.id === remoteId ? ' selected' : ''}>${esc(p.model || '(choose a model)')} · ${esc(p.name)}</option>`).join('');
  sel.innerHTML = chatModels.length || sources.length
    ? (sources.length ? `<optgroup label="On this computer">${local}</optgroup><optgroup label="Other sources">${remote}</optgroup>` : local)
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
  const needsWs = mode !== 'chat' && !S.settings.workspace && S.settings.fileAccess !== 'full';
  $('#mode-hint').textContent = needsWs ? `${MODE_HINTS[mode]} Scorpion asks for a folder when it needs one.` : MODE_HINTS[mode];
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

// "Please wait" window while a model loads. Loading has two parts: reading
// the file into memory (with progress), then setting up the model's working
// memory (no progress available, so the bar sweeps instead).
S.wait = { start: 0, timer: 0, hidden: false };
function renderWait(st) {
  const box = $('#wait');
  if (!st?.loading) {
    clearInterval(S.wait.timer);
    S.wait = { start: 0, timer: 0, hidden: false };
    box.classList.add('hidden');
    return;
  }
  if (!S.wait.start) {
    S.wait.start = Date.now();
    S.wait.timer = setInterval(() => { $('#wait-time').textContent = `${Math.round((Date.now() - S.wait.start) / 1000)}s`; }, 1000);
    $('#wait-time').textContent = '0s';
  }
  $('#wait-model').textContent = st.name || 'model';
  const p = typeof st.progress === 'number' ? st.progress : null;
  const reading = p !== null && p < 0.999;
  $('#wait-bar').style.width = `${Math.round((p ?? 0) * 100)}%`;
  document.querySelector('.wait-progress').classList.toggle('indeterminate', !reading);
  $('#wait-step').textContent = reading ? `Reading the model into memory… ${Math.round(p * 100)}%` : p === null ? 'Starting…' : 'Preparing the model to chat…';
  $('#wait-hint').textContent = st.bytes > 3 * 1024 ** 3 ? `This is a large model (${gb(st.bytes)}), so it can take a minute or more.` : '';
  // The first start (the welcome) carries on while the model loads; the
  // welcome says it's getting ready. Afterwards the wait shows as usual.
  if (!S.wait.hidden && S.settings.welcomeDone) box.classList.remove('hidden');
}

// ---------- messages ----------
const STATUS = { running: 'running', ok: '✓ done', error: '✕ failed' };
const TOOL_LABEL = {
  remember: 'remembered', forget: 'forgot', search_past_chats: 'past chats', search_documents: 'documents',
  run_code: 'run code', calculator: 'calculator', read_spreadsheet: 'spreadsheet', read_document: 'document', move_file: 'move',
  web_search: 'web search', read_webpage: 'web page',
  list_apps: 'apps', open_app: 'open app', list_windows: 'windows', switch_window: 'switch window', close_app: 'close app',
  open_path: 'open', recycle_path: 'Recycle Bin', copy_path: 'copy', windows_settings: 'Windows Settings', system_control: 'PC control', system_info: 'PC info',
};

function approvalHtml(b) {
  const detail = b.name === 'write_file' ? b.args.content
    : b.name === 'edit_file' ? `- ${b.args.find}\n+ ${b.args.replace}`
    : b.name === 'run_code' ? b.args.code
    : b.name === 'save_skill' ? `${b.args.name}: ${b.args.description}\n\n${b.args.instructions}`
    : b.summary;
  const mcpServer = /^mcp_/.test(b.name) ? b.name.split('_')[1] : null;
  const q = mcpServer ? `Let the ${mcpServer} server do this?`
    : b.name.startsWith('browser_') ? 'Let Scorpion do this in its browser?'
      : ['close_app', 'open_path', 'recycle_path', 'copy_path', 'system_control'].includes(b.name) ? 'Let Scorpion do this on your PC?'
      : b.access === 'exec' ? (b.name === 'run_code' ? 'Run this program?' : 'Run this command?') : 'Allow this change?';
  return `<div class="approval"><strong>${q}</strong>
    <div class="muted small">${esc(b.name)} · ${esc(b.args.path || b.args.subdir || b.args.language || '')}</div>
    <pre>${esc(detail)}</pre>
    <div class="row"><button class="btn primary small" data-approve="${b.id}">Allow</button>${b.name === 'run_command' ? `<button class="btn small" data-approve="${b.id}" data-always="1" title="Run this exact command from now on without asking (remove it in Settings → General)">Always allow this command</button>` : ''}<button class="btn small" data-deny="${b.id}">Deny</button></div></div>`;
}

function toolHtml(b, live) {
  const approval = S.pending.get(b.id);
  const label = b.name === 'ask_agent' ? `asked ${esc(b.args?.agent || 'agent')}` : esc(TOOL_LABEL[b.name] || b.name);
  const summary = b.name === 'ask_agent' ? b.args?.task : b.summary;
  // A helper agent's own steps and answer render nested inside its card.
  const inner = b.children?.length
    ? `<div class="helper">${renderBlockList(b.children, live && b.status === 'running')}</div>`
    : b.output ? `<pre>${esc(b.output)}</pre>` : '';
  const open = b.name === 'ask_agent' && (b.status === 'running' || hasPending(b.children)) ? ' open' : '';
  return `<details class="tool ${b.status} ${b.name === 'ask_agent' ? 'delegate' : ''}"${open}><summary><span class="name">${label}</span><span class="sum">${esc(summary)}</span><span class="st">${approval ? 'waiting' : STATUS[b.status] || ''}</span></summary>${inner}</details>${approval ? approvalHtml(b) : ''}`;
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
  const mark = { done: '✓', in_progress: '●', pending: '○' };
  return `<ol>${(steps || []).map((s) => `<li class="step ${esc(s.status)}"><span class="mark">${mark[s.status] || '○'}</span><span>${esc(s.title)}</span></li>`).join('')}</ol>`;
}

function renderBlocks(msg, live) {
  const blocks = msg.blocks || [];
  let html = renderBlockList(blocks, live);
  if (live && !blocks.length) html += '<div class="md cursor muted"></div>';
  else if (live && blocks.at(-1)?.type === 'text') html = html.replace(/<div class="md">(?![\s\S]*<div class="md">)/, '<div class="md cursor">');
  if (msg.error) html += `<div class="err">Error: ${esc(msg.error)}</div>`;
  if (msg.stopped) html += '<div class="muted small">Stopped.</div>';
  return html;
}

function messageHtml(m, i, msgs) {
  if (m.role === 'user') return `<div class="msg user"><div class="bubble">${esc(m.text)}</div></div>`;
  const live = S.running.has(S.thread.id) && i === msgs.length - 1;
  const a = agentById(m.agentId || S.thread.agentId || 'scorpion');
  const modeTag = m.mode && m.mode !== 'build' ? ` <span class="mode-tag">${m.mode === 'plan' ? 'plan' : 'chat'}</span>` : '';
  // After a plan is written in Plan mode, offer to build it in one click.
  const offerBuild = !live && i === msgs.length - 1 && m.mode === 'plan' && (m.blocks || []).some((b) => b.type === 'plan');
  return `<div class="msg assistant"><div class="meta">${esc(a.name)}${m.model ? ` · ${esc(m.model)}` : ''}${modeTag}</div>${renderBlocks(m, live)}${offerBuild ? '<div class="build-plan"><button class="btn primary small" data-build-plan="1">Build this plan</button></div>' : ''}</div>`;
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
  fast: ['fit-fast', 'Fast here', 'Fits entirely in the graphics memory of this PC.'],
  ok: ['fit-ok', '✓ Runs here', 'Fits in shared graphics memory.'],
  slow: ['fit-slow', 'Slower here', 'Too big for the graphics card, so part of it runs on the CPU.'],
  'too-big': ['fit-big', 'Too big', 'Likely too large for the memory of this PC.'],
};
const SKILL = {
  agent: ['skill-agent', 'Agent-ready', 'Passed the calculator and Build-mode file tests: can plan, write files and run code.'],
  tools: ['skill-tools', 'Simple tools', 'Uses simple tools (like the calculator) but struggles with multi-step Build tasks.'],
  chat: ['skill-chat', 'Chat only', 'Did not use tools reliably in testing. Best for conversation.'],
};
const skillTag = (skill) => (SKILL[skill] ? `<span class="tag ${SKILL[skill][0]}" title="${SKILL[skill][2]}">${SKILL[skill][1]}</span>` : '');
const fitTag = (fit) => (FIT[fit] ? `<span class="tag ${FIT[fit][0]}" title="${FIT[fit][2]}">${FIT[fit][1]}</span>` : '');

function renderModels() {
  const e = S.engine || {};
  $('#engine-info').innerHTML = e.error ? `<span class="err">Engine error: ${esc(e.error)}</span>` : `Hardware acceleration: <strong>${esc(e.gpu === 'cpu' ? 'CPU only' : String(e.gpu).toUpperCase())}</strong>${e.totalLayers ? ` · ${e.gpuLayers} of ${e.totalLayers} layers on GPU · ${e.contextSize} token context${e.flashAttention ? ' · flash attention' : ''}` : ''}${S.hardware?.dedicatedVram ? ` · ${gb(S.hardware.dedicatedVram)} graphics memory` : ''}`;
  const sources = S.settings.providers || [];
  const remoteInUse = sources.some((p) => p.id === S.settings.chatSource);
  $('#source-models').innerHTML = sources.map((p) => {
    const inUse = p.id === S.settings.chatSource;
    const here = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(p.baseUrl);
    return `<div class="card ${inUse ? 'selected' : ''}">
      <div class="title">${esc(p.model || '(no model chosen)')}</div>
      <div><span class="tag">chat</span><span class="tag">${esc(p.name)}</span><span class="tag">${here ? 'this computer' : 'online service'}</span>${inUse ? '<span class="tag on">in use</span>' : ''}</div>
      <div class="row">${inUse ? '' : `<button class="btn small primary" data-use-source="${esc(p.id)}">Use</button>`}</div></div>`;
  }).join('') || '<div class="muted">None yet. Add Ollama, LM Studio or another server in Connections.</div>';
  $('#local-models').innerHTML = S.models.map((m) => {
    const selected = (m.path === S.settings.chatModel && !remoteInUse) || m.path === S.settings.embedModel;
    return `<div class="card ${selected ? 'selected' : ''}">
      <div class="title">${esc(m.name)}</div>
      <div><span class="tag">${m.kind === 'embedding' ? 'documents' : 'chat'}</span><span class="tag">${gb(m.bytes)}</span><span class="tag">${m.source}</span>${fitTag(m.fit)}${skillTag(m.skill)}${selected ? '<span class="tag on">in use</span>' : ''}</div>
      <div class="row">${selected ? '' : `<button class="btn small primary" data-use="${esc(m.path)}" data-kind="${m.kind}">Use</button>`}
      ${m.source === 'library' ? `<button class="btn small" data-delmodel="${esc(m.path)}" data-size="${m.bytes}">Uninstall</button>` : '<span class="muted small">Comes with the installer</span>'}</div></div>`;
  }).join('') || '<div class="muted">No models installed. Download one below ("Fast here" runs best on this PC) or import a .gguf file.</div>';

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
      <span class="meta" title="${new Date(m.createdAt).toLocaleString()}">${m.source === 'agent' ? 'learned in chat' : m.source === 'dream' ? 'learned while dreaming' : 'added by you'}</span>
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
      <div class="title">${esc(a.name)} ${a.builtin ? '' : '<span class="tag">custom</span>'}</div>
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
      <div class="title">${esc(s.name)}</div>
      <div class="small">${esc(a.name)} · ${esc(describeTrigger(s.trigger))}${s.allowChanges ? ' · may change files' : ' · read-only'}</div>
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
  $('#open-at-login').checked = S.loginStart !== 'off';
  renderScheduleEditor();
}

function renderScheduleEditor() {
  const s = S.editingSchedule;
  $('#schedule-editor').classList.toggle('hidden', !s);
  if (!s) return;
  $('#schedule-editor-title').textContent = s.id ? `Edit ${s.name}` : 'New scheduled agent';
  $('#se-name').value = s.name || '';
  $('#se-agent').innerHTML = S.agents.map((a) => `<option value="${esc(a.id)}"${a.id === (s.agentId || 'scorpion') ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
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

// ---------- voice ----------
// The microphone button listens for one message and sends it when you pause.
// The conversation button is hands-free: listen → send → speak the reply →
// listen again. The speaker button reads
// replies aloud. Whisper and Kokoro run in the main process, offline.
const speaker = new Speaker((text) => api.speak(text));
const recorder = new Recorder();
const V = { talk: false, transcribing: false, replyDone: true, download: null, onText: null };
const IS_MAC = navigator.userAgent.includes('Macintosh');

function voiceReady() {
  if (S.voice?.installed) { api.warmVoice(); return true; }
  if (IX.open) { installVoice(); return false; }
  toast('Voice needs a one-time download first: Settings → Voice → Install.');
  setView('settings');
  return false;
}
const speaksReplies = () => Boolean(S.voice?.installed && (S.settings.voiceSpeak || V.talk || V.wakeTurn));

function voiceOnChatEvent(ev) {
  if (ev.threadId !== S.thread?.id) return;
  interactOnChatEvent(ev);
  if (ev.type === 'start') { V.replyDone = false; if (speaksReplies()) speaker.stop(); }
  if (!speaksReplies()) {
    if (ev.type === 'done') V.replyDone = true;
    return;
  }
  if (ev.type === 'text' && !ev.parent) speaker.feed(ev.delta);
  if (ev.type === 'done') {
    V.replyDone = true;
    if (ev.error || ev.stopped) speaker.stop();
    speaker.flush(); // continues the conversation once the reply is spoken
  }
}
speaker.onIdle = () => { if (V.replyDone) { V.wakeTurn = false; talkTurn(); orbSys?.scheduleWake(300); } };
speaker.onChange = () => renderVoiceButtons();

function renderVoiceButtons() {
  renderInteract();
  const listening = recorder.active;
  $('#mic').classList.toggle('listening', listening && !V.talk);
  $('#mic').classList.toggle('busy', V.transcribing && !V.talk);
  $('#mic').setAttribute('aria-pressed', String(listening && !V.talk));
  $('#talk').setAttribute('aria-pressed', String(V.talk));
  $('#talk').classList.toggle('listening', V.talk && listening);
  $('#talk').title = V.talk ? 'Stop the conversation' : 'Conversation: talk hands-free, Scorpion answers aloud';
  $('#read-aloud').setAttribute('aria-pressed', String(Boolean(S.settings.voiceSpeak)));
  $('#read-aloud').innerHTML = S.settings.voiceSpeak ? ICON.speaker : ICON.speakerOff;
  $('#read-aloud').classList.toggle('speaking', speaker.playing);
  $('#read-aloud').title = speaker.playing ? 'Stop speaking' : 'Read replies aloud';
}

async function listen(onText) {
  if (V.starting) return;
  V.starting = true;
  V.onText = onText;
  try {
    if (!(await api.micAccess())) throw Object.assign(new Error('Microphone access denied'), { name: 'NotAllowedError' });
    await recorder.start({ vad: true, onEnd: heard, onLevel: (l) => { V.micLevel = l; } });
  } catch (err) {
    micError(err);
    return;
  } finally {
    V.starting = false;
  }
  renderVoiceButtons();
}

async function heard(pcm) {
  V.transcribing = true;
  renderVoiceButtons();
  let text = '';
  try { text = await api.transcribe(pcm); } catch (err) { toast(errText(err)); }
  V.transcribing = false;
  renderVoiceButtons();
  const done = V.onText;
  V.onText = null;
  done?.(text);
}

function micError(err) {
  const blocked = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
  toast(err?.name === 'MicMuted'
    ? `Your microphone is muted. Unmute it (the mic key on your keyboard, or ${IS_MAC ? 'System Settings → Sound → Input' : 'Windows Settings → System → Sound → Input'}) and try again.`
    : blocked
    ? (IS_MAC
      ? 'Scorpion can\'t use the microphone. Allow it in System Settings → Privacy & Security → Microphone.'
      : 'Scorpion can\'t use the microphone. In Windows Settings → Privacy & security → Microphone, turn on microphone access and "Let desktop apps access your microphone".')
    : err?.name === 'NotFoundError' ? 'No microphone found. Plug one in and try again.' : `Microphone error: ${err?.message || err}`, 9000);
  V.talk = false;
  renderVoiceButtons();
}

async function talkTurn() {
  if (!V.talk || V.starting || recorder.active || V.transcribing || speaker.busy) return;
  if (S.thread && S.running.has(S.thread.id)) return; // resumes when the reply is spoken
  await listen((text) => {
    if (!V.talk) return;
    if (!text) { talkTurn(); return; } // silence or noise: keep listening
    if (/^(stop|goodbye|bye|end (the )?conversation)[.!]?$/i.test(text.trim())) { stopTalk(); toast('Conversation ended.'); return; }
    if (orbSys?.handleSpoken(text)) { setTimeout(talkTurn, 400); return; }
    sendMessage(text, { spoken: true });
  });
}

// Starts the hands-free conversation. Returns false if it can't start yet.
function startTalk() {
  if (V.talk) return true;
  if (!voiceReady()) return false;
  if (!S.settings.chatModel) {
    closeInteract();
    toast('Pick or download a chat model first.');
    setView('models');
    return false;
  }
  orbSys?.stopWake(); // the conversation takes the microphone over
  V.talk = true;
  renderVoiceButtons();
  talkTurn();
  return true;
}

async function installVoice() {
  if (V.download) return;
  V.download = { loaded: 0, total: S.voice?.bytes };
  renderVoiceSettings();
  renderInteract();
  try {
    S.voice = await api.installVoice();
    toast('Voice installed. Use the microphone button to speak a message, or the conversation button to talk hands-free.');
  } catch (err) {
    toast(`Voice download failed: ${errText(err)}`, 8000);
  }
  V.download = null;
  renderVoiceSettings();
  renderInteract();
}

function stopTalk() {
  V.talk = false;
  V.onText = null;
  recorder.stop();
  speaker.stop();
  renderVoiceButtons();
  orbSys?.scheduleWake(600); // back to listening for "Scorpion", if that's on
}

// ---- languages ----
function currentLanguage() {
  const langs = S.voice?.languages || [];
  const v = String(S.settings.voiceLanguage || 'en').toLowerCase();
  return langs.find((l) => l.id === v || l.name.toLowerCase() === v) || langs[0] || { id: 'en', name: 'English', native: 'English', speech: 'kokoro', voiceReady: true };
}
function languageOptions() {
  const cur = currentLanguage().id;
  return (S.voice?.languages || []).map((l) => {
    const tag = l.speech === 'system' ? ' · computer voice' : l.approximate ? ' · approximate voice' : l.speech !== 'kokoro' && !l.voiceReady ? ' · voice download' : '';
    return `<option value="${l.id}"${l.id === cur ? ' selected' : ''}>${esc(l.native)}${l.native !== l.name ? ` (${esc(l.name)})` : ''}${tag}</option>`;
  }).join('');
}
function languageNote(l) {
  if (V.langDownload) return `Downloading the ${l.name} voice… ${Math.min(100, Math.round(((V.langDownload.loaded || 0) / (V.langDownload.total || 1)) * 100))}%`;
  if (l.id === 'en') return 'Scorpion listens, replies and speaks in English.';
  const base = `Scorpion listens to ${l.name} and replies in ${l.name}.`;
  if (l.speech === 'system') return `${base} It speaks with your computer's ${l.name} voice, if one is installed (Windows: Settings → Time & language → Speech).`;
  const tip = l.id === 'ht' && !/gemma/i.test(S.settings.chatModel || '') ? ' Tip: Gemma 3 4B (Models) writes the most natural Creole.' : '';
  if (l.approximate) return `${base} There is no ${l.name} voice yet, so the French voice reads the replies: understandable, but with a French accent.${tip}`;
  return `${base} ${l.voiceReady ? `Its ${l.name} voice is installed.` : `Its ${l.name} voice is a one-time download of about ${gb(S.voice?.languageVoiceBytes || 0)}.`}`;
}
async function setLanguage(id) {
  speaker.stop();
  S.settings = await api.updateSettings({ voiceLanguage: id });
  const lang = currentLanguage();
  renderVoiceSettings();
  renderInteract();
  if (S.voice?.installed && lang.speech !== 'kokoro' && lang.speech !== 'system' && !lang.voiceReady) {
    V.langDownload = { loaded: 0, total: S.voice.languageVoiceBytes };
    renderVoiceSettings();
    try {
      S.voice = await api.installLanguageVoice(id);
      toast(`${lang.name} voice installed.`);
    } catch (err) {
      toast(`The ${lang.name} voice could not be downloaded: ${errText(err)}`, 8000);
    }
    V.langDownload = null;
    renderVoiceSettings();
    renderInteract();
  }
  api.warmVoice();
}
speaker.onNoVoice = (lang) => {
  if (V.warnedNoVoice === lang) return;
  V.warnedNoVoice = lang;
  toast(`Your computer has no voice for this language, so replies are shown but not spoken. Windows: Settings → Time & language → Speech → Add voices.`, 9000);
};

function renderVoiceSettings() {
  const v = S.voice || {};
  const d = V.download;
  $('#voice-setup').innerHTML = v.installed
    ? '<span class="muted small">Installed: Whisper (listening) and Kokoro (speaking).</span>'
    : d
      ? `<div class="progress"><div style="width:${Math.min(100, Math.round(((d.loaded || 0) / (d.total || 1)) * 100))}%"></div></div><span class="muted small">Downloading voice… ${gb(d.loaded || 0)} of about ${gb(d.total || v.bytes)}</span>`
      : `<button class="btn primary" id="voice-install" type="button">Install voice (${gb(v.bytes || 0)} download)</button>`;
  $('#voice-options').classList.toggle('hidden', !v.installed);
  if (!v.installed) return;
  $('#voice-speak').checked = Boolean(S.settings.voiceSpeak);
  $('#voice-name').innerHTML = v.voices.map((o) => `<option value="${o.id}"${o.id === S.settings.voiceName ? ' selected' : ''}>${esc(o.name)}</option>`).join('');
  const speed = Number(S.settings.voiceSpeed ?? 1);
  $('#voice-speed').value = String(speed);
  $('#voice-speed-val').textContent = `${speed.toFixed(2)}×`;
  $('#voice-language').innerHTML = languageOptions();
  const lang = currentLanguage();
  $('#voice-name-row').classList.toggle('hidden', lang.id !== 'en');
  $('#voice-language-note').textContent = languageNote(lang);
}

function wireVoice() {
  $('#mic').onclick = async () => {
    if (V.talk) return;
    if (orbSys?.wakeListening) orbSys.stopWake();
    if (recorder.active) { heard(recorder.stop()); return; } // stop early: use what was said
    if (!voiceReady()) return;
    speaker.stop();
    await listen((text) => {
      if (text) sendMessage(text, { spoken: true });
      else toast('Didn\'t catch that. Try again a little closer to the microphone.');
    });
  };
  $('#talk').onclick = () => {
    if (V.talk) { stopTalk(); return; }
    if (startTalk()) toast('Conversation on. Just talk; say "stop" or click the conversation button to end.');
  };
  $('#read-aloud').onclick = async () => {
    if (speaker.playing) { speaker.stop(); return; } // first click just stops the current speech
    const on = !S.settings.voiceSpeak;
    if (on && !voiceReady()) return;
    if (!on) speaker.stop();
    S.settings = await api.updateSettings({ voiceSpeak: on });
    renderVoiceButtons();
    renderVoiceSettings();
  };
  $('#voice-setup').onclick = async (e) => {
    if (e.target.closest('#voice-install')) installVoice();
  };
  api.onVoiceDownload((p) => {
    if (p.lang) {
      if (p.done || !V.langDownload) return;
      V.langDownload = p;
      if (S.view === 'settings') renderVoiceSettings();
      renderInteract();
      return;
    }
    if (p.done || !V.download) return;
    V.download = p;
    if (S.view === 'settings') renderVoiceSettings();
    renderInteract();
  });
  $('#voice-speak').onchange = async (e) => {
    if (!e.target.checked) speaker.stop();
    S.settings = await api.updateSettings({ voiceSpeak: e.target.checked });
    renderVoiceButtons();
  };
  $('#voice-name').onchange = async (e) => {
    S.settings = await api.updateSettings({ voiceName: e.target.value });
    speaker.say('Hi, I\'m Scorpion. This is how I sound.');
  };
  $('#voice-speed').oninput = (e) => { $('#voice-speed-val').textContent = `${Number(e.target.value).toFixed(2)}×`; };
  $('#voice-speed').onchange = async (e) => { S.settings = await api.updateSettings({ voiceSpeed: Number(e.target.value) }); };
  $('#voice-language').onchange = (e) => setLanguage(e.target.value);
  $('#voice-test').onclick = () => speaker.say('Hi, I\'m Scorpion. This is how I sound. I run entirely on your computer.');
  $('#voice-uninstall').onclick = async () => {
    if (!confirm('Remove the voice models (about 230 MB)? You can install them again any time.')) return;
    stopTalk();
    S.voice = await api.uninstallVoice();
    S.settings = await api.updateSettings({ voiceSpeak: false });
    renderVoiceSettings();
    renderVoiceButtons();
  };
}

// ---------- interact (full-screen orb) ----------
// A holographic orb (orb.js, adapted from ULTRON Orb UI) that shows what
// Scorpion is doing: standby, listening (pulses with your voice), thinking, and
// speaking (surges with its voice). Three.js loads only when this opens, and
// the orb stops rendering when it closes, so chat and the model lose nothing.
const IX = { open: false, orb: null, loading: null, timer: 0, reply: '' };
// The accent as a plain #rrggbb (themes may define it as a colour mix), read
// inside Interact so its own accent wins. Canvas normalizes any CSS colour.
const accentProbe = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
const accentColor = () => {
  const probe = document.createElement('i');
  probe.style.cssText = 'display:none;color:var(--accent)';
  (document.getElementById('interact') || document.body).appendChild(probe);
  const css = getComputedStyle(probe).color;
  probe.remove();
  // Paint one pixel and read it back: plain RGB whatever the CSS colour format.
  accentProbe.clearRect(0, 0, 1, 1);
  accentProbe.fillStyle = '#f0a830';
  accentProbe.fillStyle = css || '#f0a830';
  accentProbe.fillRect(0, 0, 1, 1);
  const [r, g, b] = accentProbe.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};
const STATE_LABEL = { standby: 'Standby', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', acting: 'Working', waiting: 'Waiting for you' };

// opts.desktop: the orb as the Windows desktop (under the taskbar, quiet until
// spoken to); opts.signin: just signed in, so greet the person.
async function openInteract(opts = {}) {
  if (IX.open) return;
  IX.open = true;
  const desktop = opts?.desktop === true;
  if (!desktop) api.setFullScreen(true);
  $('#interact').classList.remove('hidden');
  $('#interact').dataset.state = '';
  $('#ix-you').textContent = '';
  $('#ix-reply').textContent = '';
  renderInteract();
  IX.timer = setInterval(tickInteract, 50);
  try {
    // The orb's screen: the 3D orb sphere, or the constellation launcher (a map
    // of your projects), chosen in Settings → General → Orb look.
    const look = S.settings.orbLook === 'constellation' ? 'constellation' : 'classic';
    // Full detail needs a graphics card with its own memory (or a Mac), and
    // not Performance → Light.
    const strong = (IS_MAC || (S.hardware?.dedicatedVram || 0) >= 2 * 1024 ** 3) && S.perf !== 'light';
    const kind = look === 'classic' ? `classic:${strong ? 'high' : 'low'}` : look;
    if (IX.orb && IX.look !== kind) { IX.orb.dispose(); IX.orb = null; IX.loading = null; }
    if (!IX.orb) {
      IX.look = kind;
      IX.loading ??= look === 'classic'
        ? import('./orb.js').then(({ createOrb }) => createOrb($('#ix-stage'), { accent: accentColor(), quality: strong ? 'high' : 'low' }))
        : import('./constellation.js').then(({ createConstellation }) => createConstellation($('#ix-stage'), { accent: accentColor(), api, toast, errText, settings: () => S.settings }));
      IX.orb = await IX.loading;
      IX.orb.setFrameCap?.(orbFps());
      $('#interact').classList.toggle('ix-constellation', look === 'constellation');
    } else {
      IX.orb.setAccent(accentColor());
    }
    if (IX.open) IX.orb.start();
  } catch (err) {
    toast(`The orb's view couldn't start: ${errText(err)}`, 8000);
  }
  if (!IX.open) return;
  orbSys?.onOpen({ desktop, signin: opts?.signin === true });
  // A fresh install (no chats yet): the spoken first start, once.
  if (!S.settings.welcomeDone && !S.threads?.length) welcome?.start();
  // Hand tracking is always on in the orb (unless turned off with G).
  if (S.settings.handsAlwaysOn !== false) startGestures();
  if (S.voice?.installed && !desktop) startTalk();
  else $('#ix-input').focus();
}

function closeInteract() {
  if (!IX.open) return;
  IX.open = false;
  api.setFullScreen(false);
  clearInterval(IX.timer);
  IX.orb?.stop();
  if (V.talk) stopTalk();
  if (!handIsMouse()) stopGestures(); // as the mouse, hands keep working everywhere
  stopFace();
  orbSys?.onClose();
  $('#interact').classList.add('hidden');
  $('#input').focus();
}

function interactState() {
  if (speaker.playing) return 'speaking';
  const extra = orbSys?.state(); // waiting for a yes/no, or working on the PC
  if (extra) return extra;
  // Listening for the wake word looks like standby: it isn't a conversation.
  const waking = orbSys?.wakeListening;
  if ((V.transcribing && !waking) || (S.thread && S.running.has(S.thread.id))) return 'thinking';
  if (recorder.active && !waking) return 'listening';
  return 'standby';
}

// Performance (Settings → General): the orb's frames per second, in front,
// while the model writes, and behind other windows.
const PERF_FPS = { full: { on: 60, thinking: 30, away: 12 }, balanced: { on: 40, thinking: 24, away: 10 }, light: { on: 24, thinking: 15, away: 8 } };
const orbFps = (when = 'on') => (PERF_FPS[S.perf] || PERF_FPS.full)[when];
// Hand tracking: which camera frames are looked at, with a hand in view and without.
const PERF_STRIDE = { full: { active: 1, idle: 3 }, balanced: { active: 1, idle: 4 }, light: { active: 2, idle: 6 } };
function applyPerf(level) {
  S.perf = PERF_FPS[level] ? level : 'full';
  document.documentElement.dataset.perf = S.perf;
  IX.orb?.setFrameCap?.(orbFps(document.hasFocus() ? 'on' : 'away'));
  if (G.tracker) G.tracker.stride = PERF_STRIDE[S.perf];
  if (S.view === 'settings') renderSettings();
}

function tickInteract() {
  const state = interactState();
  const el = $('#interact');
  if (el.dataset.state !== state) {
    el.dataset.state = state;
    IX.orb?.setState(state);
    // The model shares the graphics card: fewer orb frames while it writes.
    IX.orb?.setFrameCap(orbFps(state === 'thinking' ? 'thinking' : 'on'));
    renderInteract();
  }
  const level = state === 'speaking' ? speaker.level() : state === 'listening' ? Math.min(1, (V.micLevel || 0) * 8) : 0;
  IX.orb?.setLevel(level);
}

function renderInteract() {
  if (!IX.open) return;
  const state = $('#interact').dataset.state || 'standby';
  const d = V.download;
  $('#ix-state').textContent = d
    ? `Downloading voice ${Math.min(100, Math.round(((d.loaded || 0) / (d.total || 1)) * 100))}%`
    : state === 'standby' && V.talk ? 'Ready' : state === 'standby' && orbSys?.wakeListening ? 'Say “Scorpion”' : STATE_LABEL[state] || 'Standby';
  $('#ix-model').textContent = S.engine?.chatModelName ? `· ${S.engine.chatModelName}` : '';
  if (document.activeElement !== $('#ix-lang')) $('#ix-lang').innerHTML = languageOptions();
  if (V.langDownload) $('#ix-state').textContent = `Downloading voice ${Math.min(100, Math.round(((V.langDownload.loaded || 0) / (V.langDownload.total || 1)) * 100))}%`;
  const talk = $('#ix-talk');
  talk.setAttribute('aria-pressed', String(V.talk));
  talk.textContent = V.talk ? '■ Stop' : S.voice?.installed ? '● Talk' : d ? 'Installing…' : 'Install voice';
  talk.disabled = Boolean(d);
  const voiceOn = Boolean(S.settings.voiceSpeak) || V.talk;
  $('#ix-voice').setAttribute('aria-pressed', String(voiceOn));
  $('#ix-face').setAttribute('aria-pressed', String(FX.on));
  $('#ix-face').textContent = FX.on ? 'Face on' : 'Face off';
  if (FX.on && FX.speaker && !V.download && !V.langDownload) $('#ix-model').textContent = '· with ' + FX.speaker.name + ($('#ix-model').textContent ? ' ' + $('#ix-model').textContent : '');
  $('#ix-voice').textContent = voiceOn ? 'Voice on' : 'Voice off';
}

// Hand tracking (gestures.js): on Windows, gestures on means the hand is the
// mouse everywhere, whenever Scorpion is open; on a Mac they work in the orb
// (orb-system.js) and the places over it (hand-control.js). G or Settings →
// General turns them off, remembered. Nothing of the hand is drawn on screen,
// only a small status line. It pauses while Scorpion is minimized. The hand
// model is a one-time ~8 MB download.
const G = { on: false, phase: '', tracker: null, error: '', download: null, hands: 0, mode: 'idle' };
const GESTURE_MODE = { spin: 'Pinch', zoom: 'Zoom' };
const GESTURE_POSE = { point: 'Pointing', two: 'Scroll', open: 'Open hand', fist: 'Fist', thumbUp: 'Thumb up', thumbDown: 'Thumb down', other: 'Hand' };
const GESTURE_MODEL_URL = '/gestures/hand_landmarker.task';

async function startGestures() {
  if (G.on) return;
  Object.assign(G, { on: true, error: '', hands: 0, mode: 'idle' });
  try {
    if (!S.gestures?.downloaded) {
      G.phase = 'download';
      G.download = { loaded: 0, total: S.gestures?.bytes || 8 * 1024 ** 2 };
      renderGestures();
      try {
        S.gestures = await api.installGestures();
      } catch (err) {
        throw new Error(`HAND MODEL DOWNLOAD FAILED (${errText(err)}). Gestures need a one-time 8 MB download: connect to the internet, then press G.`);
      } finally {
        G.download = null;
      }
    }
    if (!G.on) return;
    G.phase = 'loading';
    renderGestures();
    G.tracker ??= new HandTracker($('#ix-cam-video'), $('#ix-cam-overlay'), { onFrame: onGestureFrame });
    G.tracker.stride = PERF_STRIDE[S.perf] || PERF_STRIDE.full;
    G.tracker.preview = false; // the camera's picture isn't shown
    G.tracker.color = accentColor();
    try {
      await G.tracker.load(GESTURE_MODEL_URL);
    } catch (err) {
      // A model that never loaded is downloaded again next time.
      if (!S.gestures.installed) S.gestures = await api.uninstallGestures();
      throw new Error(`HAND TRACKER FAILED TO LOAD (${errText(err)}).`);
    }
    if (!S.gestures.installed) S.gestures = await api.gesturesLoaded();
    if (!G.on) return;
    G.phase = 'camera';
    renderGestures();
    try {
      if (!(await api.gesturesCamera(true))) throw Object.assign(new Error('Camera access denied'), { name: 'NotAllowedError' });
      await G.tracker.startCamera();
    } catch (err) {
      throw new Error(cameraError(err));
    }
    if (!G.on) { G.tracker.stopCamera(); api.gesturesCamera(false); return; }
    G.phase = 'on';
    renderGestures();
    if (document.hidden) pauseGestures(); // started in the tray: wait until Scorpion is on screen
  } catch (err) {
    if (G.on) stopGestures(errText(err));
  }
}

function stopGestures(error = '') {
  if (!G.on && !G.error && !error) return;
  Object.assign(G, { on: false, phase: '', error, paused: false });
  G.tracker?.stopCamera();
  api.gesturesCamera(false);
  hands?.hideCursor();
  renderGestures();
  // With gestures off, the camera's box goes away: a problem is shown for a
  // few seconds (G or the Gestures button tries again), not left in the corner.
  clearTimeout(G.errorTimer);
  if (error) G.errorTimer = setTimeout(() => { if (!G.on && G.error === error) { G.error = ''; renderGestures(); } }, 8000);
}

// The G key, the orb's Gestures button, Off and the Settings switch: on or off,
// remembered.
async function toggleHands(on = !G.on) {
  S.settings = await api.updateSettings({ handsAlwaysOn: on });
  if (on) startGestures(); else stopGestures();
  $('#hands-always').checked = on;
}

// Off screen (minimized, in the tray): the camera rests until Scorpion is back.
function pauseGestures() {
  if (!G.on || G.paused || G.phase !== 'on') return;
  G.paused = true;
  G.tracker.stopCamera();
  api.gesturesCamera(false);
  hands?.hideCursor();
  renderGestures();
}
async function resumeGestures() {
  if (!G.paused) return;
  G.paused = false;
  if (!G.on) return;
  try {
    if (!(await api.gesturesCamera(true))) throw Object.assign(new Error('Camera access denied'), { name: 'NotAllowedError' });
    await G.tracker.startCamera();
  } catch (err) { stopGestures(cameraError(err)); return; }
  renderGestures();
}
document.addEventListener('visibilitychange', () => (document.hidden ? pauseGestures() : resumeGestures()));

// On Windows, hand gestures always drive the mouse.
const handIsMouse = () => !IS_MAC && navigator.userAgent.includes('Windows');

function onGestureFrame(r) {
  welcome?.onGesture(r);
  if (handIsMouse()) { handAsMouse(r); return; }
  // The orb (with the apps inside it) when it is on screen, else Scorpion's
  // own screens. What the orb doesn't use turns it.
  const used = (IX.open && !orbSys?.away ? orbSys?.handleGesture(r) : hands?.handle(r)) || {};
  if (r.rotate && !used.rotate) IX.orb?.rotateBy(...r.rotate);
  if (r.zoom && !used.zoom) IX.orb?.zoomBy(r.zoom);
  if (r.hands !== G.hands || r.mode !== G.mode || r.pose !== G.pose) {
    Object.assign(G, { hands: r.hands, mode: r.mode, pose: r.pose });
    renderGestures();
  }
}

// The hand as the mouse, everywhere: the index finger moves the real pointer
// over the whole screen; pinch clicks, thumb + middle right-clicks, fist then
// open double-clicks, a held pinch drags, two fingers scroll, both hands zoom
// (Ctrl + wheel). Sweeps, push, thumbs and signs keep their meanings, and a
// held fist pauses it all.
const HM = { lastMove: 0, wheel: 0, zoom: 0, smooth: null };
function handAsMouse(r) {
  if (r.hold === 'fist') orbSys?.togglePause();
  if (orbSys?.paused) return;
  const g = { ...r, hold: r.hold === 'fist' ? null : r.hold };
  if (IX.open && !orbSys.away) orbSys.handleGlobals(g); else hands?.handleGlobals(g);
  const send = (cmd) => api.handMouse(cmd).catch(() => {});
  if (r.pointer) {
    // A little extra steadiness: the whole screen magnifies a shaking finger.
    HM.smooth = HM.smooth ? { x: HM.smooth.x + (r.pointer.x - HM.smooth.x) * 0.5, y: HM.smooth.y + (r.pointer.y - HM.smooth.y) * 0.5 } : r.pointer;
    if (performance.now() - HM.lastMove > 16) { HM.lastMove = performance.now(); send({ move: HM.smooth }); }
  } else if (!r.hands) HM.smooth = null;
  if (r.tap) { hands?.flash('Click'); send({ click: 'left', at: HM.smooth || r.tap }); }
  if (r.rightTap) { hands?.flash('Right-click'); send({ click: 'right', at: HM.smooth || r.rightTap }); }
  if (r.bloom) { hands?.flash('Double-click'); send({ click: 'double', at: HM.smooth || r.bloom }); }
  if (r.drag) send({ drag: r.drag.phase, at: r.drag });
  if (r.scroll) { HM.wheel += r.scroll; const n = Math.trunc(HM.wheel); if (n) { HM.wheel -= n; send({ wheel: n }); } }
  if (r.mode === 'zoom' && r.zoom) {
    HM.zoom -= Math.log(r.zoom) * 8;
    const n = Math.trunc(HM.zoom);
    if (n) { HM.zoom -= n; hands?.flash(n > 0 ? 'Zoom in' : 'Zoom out'); send({ wheel: n, ctrl: true }); }
  } else HM.zoom = 0;
}

function renderGestures() {
  const btn = $('#ix-gestures');
  btn.setAttribute('aria-pressed', String(G.on));
  btn.textContent = G.on ? 'Gestures on' : 'Gestures off';
  const cam = $('#ix-cam');
  cam.classList.toggle('hidden', (!G.on && !G.error) || G.paused);
  cam.toggleAttribute('data-error', Boolean(G.error));
  const d = G.download;
  $('#ix-cam-status').textContent = G.error
    || (G.phase === 'download' ? `DOWNLOADING HAND MODEL ${Math.min(100, Math.round(((d?.loaded || 0) / (d?.total || 1)) * 100))}%`
      : G.phase === 'loading' ? 'Loading hand tracker…'
        : G.phase === 'camera' ? 'Starting camera…'
          : G.hands ? `${G.hands} HAND${G.hands > 1 ? 'S' : ''} · ${GESTURE_MODE[G.mode] || GESTURE_POSE[G.pose] || 'Hand'}`
            : 'NO HANDS · SHOW ONE HAND TO THE CAMERA · ? FOR THE GESTURE GUIDE');
}

// Markdown reads badly as a caption: keep the words.
const captionText = (text) => text
  .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
  .replace(/```[\s\S]*?(```|$)/g, ' [code] ')
  .replace(/[*_#>`~|]+/g, '')
  .replace(/\s+/g, ' ')
  .trim();

function interactOnChatEvent(ev) {
  if (!IX.open) return;
  if (ev.type === 'start') IX.reply = '';
  if (ev.type === 'text' && !ev.parent) IX.reply += ev.delta;
  if (ev.type === 'start' || ev.type === 'text') $('#ix-reply').textContent = captionText(IX.reply).slice(-420);
  if (ev.type === 'done' && ev.error) $('#ix-reply').textContent = `Error: ${ev.error}`;
}

function wireInteract() {
  $('#open-interact').onclick = openInteract;
  $('#ix-close').onclick = closeInteract;
  $('#ix-talk').onclick = () => (V.talk ? stopTalk() : startTalk());
  $('#ix-lang').onchange = (e) => setLanguage(e.target.value);
  $('#ix-voice').onclick = () => $('#read-aloud').onclick();
  $('#ix-zoom-in').onclick = () => IX.orb?.zoomIn();
  $('#ix-zoom-out').onclick = () => IX.orb?.zoomOut();
  $('#ix-reset').onclick = () => IX.orb?.resetView();
  $('#ix-gestures').onclick = () => toggleHands();
  $('#hand-off').onclick = () => toggleHands(false);
  $('#hands-always').onchange = (e) => toggleHands(e.target.checked);
  api.onGesturesDownload((p) => {
    if (G.phase !== 'download') return;
    G.download = p.done ? null : p;
    renderGestures();
  });
  $('#ix-ask').onsubmit = (e) => {
    e.preventDefault();
    const text = $('#ix-input').value.trim();
    if (!text) return;
    $('#ix-input').value = '';
    if (!S.settings.chatModel) closeInteract();
    speaker.stop();
    sendMessage(text, { spoken: V.talk || speaksReplies() });
  };
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); IX.open ? closeInteract() : openInteract(); return; }
    if (!IX.open || orbSys?.away) return;
    if (e.key === 'Escape' && IX.orb?.handleEscape?.()) { e.preventDefault(); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      // Full mode: Esc twice leaves full screen (main.js), so one Esc closes
      // the orb only if a second doesn't follow.
      if (S.fullMode) {
        if (IX.escTimer) { clearTimeout(IX.escTimer); IX.escTimer = 0; return; }
        IX.escTimer = setTimeout(() => { IX.escTimer = 0; closeInteract(); }, 450);
        return;
      }
      closeInteract();
      return;
    }
    if (e.target.closest?.('input, textarea, select')) return;
    if (IX.orb?.takesTyping && e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.altKey && !e.metaKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      // Talking over Scorpion interrupts it, like in a real conversation.
      if (V.talk && speaker.playing) { speaker.stop(); talkTurn(); return; }
      $('#ix-talk').click();
    }
    else if (e.key === 'r' || e.key === 'R') IX.orb?.resetView();
    else if (e.key === 'g' || e.key === 'G') $('#ix-gestures').click();
    else if (e.key === 'f' || e.key === 'F') $('#ix-face').click();
    else if (e.key === '?' || e.key === 'h' || e.key === 'H') orbSys?.toggleGuide();
    else if (e.key === '+' || e.key === '=') IX.orb?.zoomIn();
    else if (e.key === '-' || e.key === '_') IX.orb?.zoomOut();
  });
}

// ---------- faces: people, Interact, face lock ----------
// Face recognition runs in the main process (YuNet + SFace, see faces.js);
// facecam.js grabs camera frames and tracks faces between them.
const FX = { on: false, cam: null, speaker: null, greeted: new Map(), download: null };
const GREETING = { en: 'Hi', fr: 'Bonjour', ht: 'Bonjou', es: 'Hola', pt: 'Olá', de: 'Hallo', it: 'Ciao', ro: 'Salut', nl: 'Hoi' };

function faceCameraError(err) {
  if (err?.name === 'NotAllowedError') return IS_MAC
    ? 'Scorpion may not use the camera. Allow it in System Settings → Privacy & Security → Camera.'
    : 'Scorpion may not use the camera. In Windows Settings → Privacy & security → Camera, turn on camera access for desktop apps.';
  if (err?.name === 'NotFoundError') return 'No camera found.';
  if (err?.name === 'NotReadableError') return 'The camera is busy in another app.';
  return 'Camera error: ' + (err?.message || err);
}

function facesReady() {
  if (S.faces?.installed) return true;
  toast('Face recognition needs a one-time download first: Settings → People → Install.');
  closeInteract();
  setView('people');
  return false;
}

// Interact: track faces, turn the orb toward the person, know who is talking.
async function startFace() {
  if (FX.on || !facesReady()) return;
  FX.on = true;
  FX.cam = new FaceCam();
  $('#ix-facecam').classList.remove('hidden');
  $('#ix-face-status').textContent = 'Starting camera…';
  renderInteract();
  try {
    await FX.cam.start({
      // Full camera resolution: DeepFace's age, gender and expression need a sharp face.
      video: $('#ix-face-video'), reason: 'faces', fps: 6, frameSize: { width: 640, height: 480 },
      analyze: (frame) => api.faceFrame(frame),
      onUpdate: (tracks) => {
        drawFaces($('#ix-face-overlay'), tracks, { color: accentColor(), ...FX.cam.size });
        const main = tracks.slice().sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3])[0];
        if (main) {
          const { width, height } = FX.cam.size;
          // Mirror x: the preview is a mirror, and the orb should face the person.
          IX.orb?.setGaze(-((main.box[0] + main.box[2] / 2) / width * 2 - 1), (main.box[1] + main.box[3] / 2) / height * 2 - 1);
        } else IX.orb?.setGaze(0, 0);
        setSpeaker(main?.person || null, tracks.length);
        renderFaceInfo(main, tracks);
        // The speaker's expression (from DeepFace), so Scorpion can match its tone.
        FX.mood = main?.expression && main.expression.score >= 0.5 ? main.expression.label : null;
      },
    });
  } catch (err) {
    stopFace();
    toast(faceCameraError(err), 9000);
  }
}

function stopFace() {
  if (!FX.cam && !FX.on) return;
  FX.cam?.stop();
  FX.cam = null;
  FX.on = false;
  FX.speaker = null;
  IX.orb?.setGaze(0, 0);
  $('#ix-facecam').classList.add('hidden');
  renderInteract();
}

// The panel under Interact's face camera: everything DeepFace knows about the
// main face (like its stream view), and one line per other face.
const EMOTION_ORDER = ['happy', 'neutral', 'surprise', 'sad', 'angry', 'fear', 'disgust'];
let faceInfoAt = 0;
function renderFaceInfo(main, tracks) {
  const box = $('#ix-face-info');
  if (!box || performance.now() - faceInfoAt < 250) return; // a few updates a second is plenty
  faceInfoAt = performance.now();
  const st = S.insights || {};
  const pct = (v) => `${Math.round(v * 100)}%`;
  const row = (k, v, bad = false) => `<div class="fi-row"><b>${k}</b><span${bad ? ' class="fi-bad"' : ''}>${v}</span></div>`;
  let html = '';
  if (main) {
    const person = main.person && (S.faces?.people || []).find((p) => p.id === main.person.id);
    html += `<div class="fi-head">${person?.thumb ? `<img src="${person.thumb}" alt="">` : ''}<span>${main.person ? `${esc(main.person.name)}<br>${pct(main.person.similarity)} match` : 'Unknown person'}</span></div>`;
    if (main.liveness) html += row('Liveness', main.liveness.real ? `Real face ${pct(main.liveness.score)}` : `Photo or screen ${pct(main.liveness.score)}`, !main.liveness.real);
    if (main.age != null) html += row('Age', `~${main.age}`);
    // DeepFace's gender model can be unsure (short hair, angle, light): say so.
    if (main.gender) html += row('Gender', `${main.gender.label} ${pct(main.gender.score)}${main.gender.score < 0.75 ? ' (guess)' : ''}`);
    if (main.expression) {
      html += row('Expression', `${main.expression.label[0].toUpperCase()}${main.expression.label.slice(1)} ${pct(main.expression.score)}`);
      html += `<div class="fi-bars">${EMOTION_ORDER.map((k) => { const v = main.expression.scores[k] || 0; return `<div class="fi-bar${k === main.expression.label ? ' top' : ''}"><span>${k}</span><i style="width:${Math.max(1, Math.round(v * 100))}%"></i><span>${pct(v)}</span></div>`; }).join('')}</div>`;
    }
    if (main.quality) html += row('Quality', main.quality.ok ? 'Good' : esc(main.quality.issues.join(', ')), !main.quality.ok);
    html += row('In view', `${tracks.length} face${tracks.length === 1 ? '' : 's'}`);
    const others = tracks.filter((t) => t !== main);
    if (others.length) html += `<div class="fi-others">${others.slice(0, 4).map((t) => [t.person ? esc(t.person.name) : 'unknown', t.expression?.label, t.age != null ? `~${t.age}` : null, t.gender ? t.gender.label.toLowerCase() : null, t.liveness && !t.liveness.real ? 'photo?' : null].filter(Boolean).join(' · ')).join('<br>')}</div>`;
  }
  // Missing models: install them right here.
  const missing = [];
  if (!st.insights?.installed) missing.push(['insights', `Expressions + liveness (${gb(st.insights?.bytes || 0)})`]);
  if (!st.demography?.installed) missing.push(['demography', `Age + gender (${gb(st.demography?.bytes || 0)})`]);
  if (S.settings.faceInsightsLive === false) html += '<div class="fi-others">Expression, age and gender are turned off in Settings → People.</div>';
  else if (missing.length) html += `<div class="fi-install">${missing.map(([k, label]) => INSIGHT_DL[k] ? `<span>Downloading ${label}… ${gb(INSIGHT_DL[k].loaded || 0)}</span>` : `<button type="button" class="ix-btn" data-ix-insight="${k}">Install ${label}</button>`).join('')}</div>`;
  box.innerHTML = html;
}

function setSpeaker(person, count) {
  const before = FX.speaker?.id;
  FX.speaker = person;
  $('#ix-face-status').textContent = !count ? 'No face in view' : person ? 'Talking with ' + person.name : (count > 1 ? count + ' people · not recognized' : 'Not recognized · add them in People');
  if (person && person.id !== before) {
    renderInteract();
    // Greet someone new to the conversation, once per Interact session.
    const last = FX.greeted.get(person.id) || 0;
    if ((V.talk || FX.greetOnce) && !speaker.playing && Date.now() - last > 10 * 60 * 1000) {
      FX.greeted.set(person.id, Date.now());
      const custom = FX.greetOnce?.(person);
      const signin = Boolean(FX.greetOnce);
      FX.greetOnce = null;
      speaker.say(custom || (GREETING[currentLanguage().id] || 'Hi') + ' ' + person.name + '!');
      if (signin) orbSys?.greeted();
    }
  } else if (!person && before) renderInteract();
}

// People page.
function renderPeople() {
  if (!$('#faces-setup')) return;
  const f = S.faces || {};
  const d = FX.download;
  $('#faces-setup').innerHTML = f.installed ? '' : d
    ? '<div class="progress"><div style="width:' + Math.min(100, Math.round(((d.loaded || 0) / (d.total || 1)) * 100)) + '%"></div></div><p class="muted small">Downloading face recognition… ' + gb(d.loaded || 0) + ' of ' + gb(d.total || f.bytes || 0) + '</p>'
    : '<button class="btn primary" type="button" id="faces-install">Install face recognition (' + gb(f.bytes || 0) + ' download)</button><p class="muted small">YuNet finds faces and SFace recognizes them (open models from OpenCV). One download, then it works offline.</p>';
  $('#faces-body').classList.toggle('hidden', !f.installed);
  if (!f.installed) return;
  const people = f.people || [];
  $('#people-list').innerHTML = people.map((p) => '<div class="person" data-person="' + esc(p.id) + '">'
    + (p.thumb ? '<img src="' + p.thumb + '" alt="">' : '<div class="noface"></div>')
    + '<div class="who"><b>' + esc(p.name) + '</b><span class="muted small">' + p.samples + ' face sample' + (p.samples === 1 ? '' : 's') + (p.owner ? ' · owner' : '') + '</span>'
    + '<div class="acts"><button class="btn small" data-act="photos">Add photos</button><button class="btn small" data-act="camera">Camera</button>'
    + '<button class="btn small" data-act="owner">' + (p.owner ? 'Not owner' : 'Make owner') + '</button><button class="btn small" data-act="rename">Rename</button><button class="btn small" data-act="remove">Remove</button></div></div></div>').join('')
    || '<div class="muted">Nobody added yet. Start with yourself.</div>';
  renderInsights();
  const lockState = S.lock || {};
  $('#lock-enabled').checked = Boolean(lockState.enabled);
  $('#lock-pin-note').textContent = lockState.hasPin ? 'A PIN is set.' : 'No PIN yet.';
}

// Face insights, from DeepFace: two optional downloads.
const INSIGHT_DL = {};
function renderInsights() {
  const st = S.insights || {};
  const row = (key, what) => {
    const p = st[key] || {};
    const d = INSIGHT_DL[key];
    if (d) return `<div class="row"><b>${esc(p.label)}</b><span class="muted small">downloading… ${gb(d.loaded || 0)} of ${gb(d.total || p.bytes || 0)}</span></div>`;
    return `<div class="row"><b>${esc(p.label)}</b><span class="muted small">${esc(what)} (${gb(p.bytes || 0)})</span>${p.installed ? `<span class="tag on">installed</span><button class="btn small" data-insight-remove="${key}">Remove</button>` : `<button class="btn small primary" data-insight-install="${key}">Install</button>`}</div>`;
  };
  $('#insights-setup').innerHTML = row('insights', 'facial expression, and a liveness check so face lock refuses photos and screens')
    + row('demography', 'apparent age and gender');
  $('#insights-live').checked = S.settings.faceInsightsLive !== false;
  $('#lock-liveness').checked = S.settings.lockLiveness !== false;
  $('#lock-liveness').disabled = !st.insights?.installed;
}

async function refreshFaces() {
  const st = await api.state();
  S.faces = st.faces;
  S.insights = st.insights;
  S.lock = st.lock;
  renderPeople();
}

function reportEnroll(r, name) {
  const skipped = r.skipped?.length ? ' Skipped: ' + r.skipped.slice(0, 3).join('; ') + (r.skipped.length > 3 ? '…' : '') : '';
  if (!r.person) toast('No usable face for ' + name + '.' + skipped, 9000);
  else toast('Added ' + r.added + ' sample' + (r.added === 1 ? '' : 's') + ' for ' + r.person.name + '.' + skipped, 7000);
}

async function enrollFromPhotos(id, name) {
  const files = await api.pickFacePhotos();
  if (!files.length) return;
  toast('Reading ' + files.length + ' photo' + (files.length === 1 ? '' : 's') + '…', 2000);
  try { reportEnroll(await api.enrollFace({ id, name, files }), name); } catch (err) { toast(errText(err), 8000); }
  refreshFaces();
}

// Camera capture window: live face boxes, then 5 shots a moment apart.
async function enrollFromCamera(id, name) {
  const cam = new FaceCam();
  const box = $('#face-capture');
  box.classList.remove('hidden');
  $('#face-capture-title').textContent = 'Add ' + name + ' with the camera';
  $('#capture-status').textContent = 'Starting camera…';
  let quality = null;
  const close = () => { cam.stop(); box.classList.add('hidden'); };
  $('#capture-cancel').onclick = close;
  try {
    await cam.start({
      video: $('#capture-video'), reason: 'enroll', fps: 4,
      analyze: (frame) => api.faceFrame(frame),
      onUpdate: (tracks) => {
        drawFaces($('#capture-overlay'), tracks, { color: accentColor() });
        quality = tracks[0]?.quality || null;
        $('#capture-status').textContent = !tracks.length ? 'No face yet: look at the camera.' : tracks.length > 1 ? 'Only one person in view, please.'
          : quality && !quality.ok ? 'Face ' + quality.issues.join(', ') + '.' : 'Good. Press "Take 5 photos" and keep looking at the camera.';
      },
    });
  } catch (err) {
    close();
    toast(faceCameraError(err), 9000);
    return;
  }
  $('#capture-go').onclick = async () => {
    $('#capture-go').disabled = true;
    $('#capture-status').textContent = 'Hold still…';
    try {
      const frames = await cam.shots(5, 450);
      close();
      reportEnroll(await api.enrollFace({ id, name, frames }), name);
    } catch (err) { close(); toast(errText(err), 8000); }
    $('#capture-go').disabled = false;
    refreshFaces();
  };
}

function wirePeople() {
  $('#faces-setup').onclick = async (e) => {
    if (!e.target.closest('#faces-install')) return;
    FX.download = { loaded: 0, total: S.faces?.bytes };
    renderPeople();
    try {
      S.faces = await api.installFaces();
      toast('Face recognition installed. Add yourself first.');
    } catch (err) { toast('Face recognition could not be downloaded: ' + errText(err), 9000); }
    FX.download = null;
    renderPeople();
  };
  api.onFacesDownload((p) => { if (!p.done && FX.download) { FX.download = p; renderPeople(); } });
  const newName = () => {
    const n = $('#person-name').value.trim();
    if (!n) { toast('Type the person\'s name first.'); $('#person-name').focus(); }
    return n;
  };
  $('#person-photos').onclick = async () => { const n = newName(); if (n) { await enrollFromPhotos(null, n); $('#person-name').value = ''; } };
  $('#person-camera').onclick = () => { const n = newName(); if (n) { enrollFromCamera(null, n); $('#person-name').value = ''; } };
  $('#people-list').onclick = async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('[data-person]').dataset.person;
    const p = (S.faces?.people || []).find((x) => x.id === id);
    if (!p) return;
    const act = btn.dataset.act;
    if (act === 'photos') return enrollFromPhotos(id, p.name);
    if (act === 'camera') return enrollFromCamera(id, p.name);
    if (act === 'owner') S.faces = await api.setFaceOwner({ id, owner: !p.owner });
    if (act === 'rename') {
      const name = prompt('New name for ' + p.name, p.name);
      if (name && name.trim()) S.faces = await api.renamePerson({ id, name });
    }
    if (act === 'remove' && confirm('Remove ' + p.name + ' and their face samples?')) S.faces = await api.removePerson(id);
    renderPeople();
  };
  $('#lock-set-pin').onclick = async () => {
    try { S.lock = await api.setLockPin($('#lock-pin').value); $('#lock-pin').value = ''; toast('PIN saved.'); } catch (err) { toast(errText(err), 6000); }
    renderPeople();
  };
  $('#lock-enabled').onchange = async (e) => {
    try { S.lock = await api.enableLock(e.target.checked); toast(e.target.checked ? 'Face lock on. Scorpion will open locked next time (or press Ctrl+L).' : 'Face lock off.'); }
    catch (err) { e.target.checked = false; toast(errText(err), 7000); }
    renderPeople();
  };
  $('#lock-now').onclick = lockNow;
  // Face insights (DeepFace): install / remove, and the two switches.
  $('#insights-setup').onclick = async (e) => {
    const install = e.target.closest('[data-insight-install]')?.dataset.insightInstall;
    const remove = e.target.closest('[data-insight-remove]')?.dataset.insightRemove;
    if (install) {
      INSIGHT_DL[install] = { loaded: 0, total: S.insights?.[install]?.bytes };
      renderInsights();
      try { S.insights = await api.insightsInstall(install); toast(`${S.insights[install].label} installed.`); } catch (err) { toast(errText(err), 8000); }
      delete INSIGHT_DL[install];
      renderInsights();
    } else if (remove && confirm(`Remove ${S.insights?.[remove]?.label}? You can install it again any time.`)) {
      S.insights = await api.insightsUninstall(remove);
      renderInsights();
    }
  };
  api.onInsightsDownload((p) => { if (!p.done && INSIGHT_DL[p.pack]) { INSIGHT_DL[p.pack] = p; renderInsights(); } });
  $('#insights-live').onchange = (e) => setSetting({ faceInsightsLive: e.target.checked });
  $('#ix-face-info').onclick = async (e) => {
    const pack = e.target.closest('[data-ix-insight]')?.dataset.ixInsight;
    if (!pack) return;
    INSIGHT_DL[pack] = { loaded: 0 };
    faceInfoAt = 0;
    try { S.insights = await api.insightsInstall(pack); } catch (err) { toast(errText(err), 8000); }
    delete INSIGHT_DL[pack];
    faceInfoAt = 0;
  };
  $('#lock-liveness').onchange = (e) => setSetting({ lockLiveness: e.target.checked });
  $('#faces-uninstall').onclick = async () => {
    if (!confirm('Remove the face recognition models? The people you added are kept.')) return;
    stopFace();
    S.faces = await api.uninstallFaces();
    renderPeople();
  };
  $('#ix-face').onclick = () => (FX.on ? stopFace() : startFace());
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); lockNow(); }
  });
}

async function lockNow() {
  if (!S.lock?.enabled) { toast('Turn on face lock first: Settings → People.'); return; }
  closeInteract();
  await api.lockNow();
  location.reload();
}

// Lock screen: shown before anything else loads; resolves once unlocked.
function showLockScreen() {
  return new Promise((resolve) => {
    $('#lock-screen').classList.remove('hidden');
    const cam = new FaceCam();
    const done = () => { cam.stop(); $('#lock-screen').classList.add('hidden'); resolve(); };
    cam.start({
      video: $('#lock-video'), reason: 'lock', fps: 4,
      analyze: (frame) => api.lockFace(frame),
      onUpdate: (tracks, res) => {
        drawFaces($('#lock-overlay'), tracks.map((t) => ({ ...t, person: null })), { color: '#d9a630' });
        if (res?.unlocked) { done(); return; }
        $('#lock-status').textContent = !tracks.length ? 'Look at the camera.' : res?.fake ? 'That looks like a photo or a screen. Show your real face, or type your PIN.' : 'Checking…';
      },
    }).catch((err) => { $('#lock-status').textContent = faceCameraError(err) + ' Type your PIN instead.'; });
    $('#lock-form').onsubmit = async (e) => {
      e.preventDefault();
      const r = await api.lockPin($('#lock-input').value);
      $('#lock-input').value = '';
      if (r.unlocked) done(); else $('#lock-status').textContent = 'Wrong PIN.';
    };
    $('#lock-input').focus();
  });
}

function renderOnlineBadge() {
  const on = Boolean(S.settings.online);
  const b = $('#online-badge');
  b.textContent = on ? '● Online: web search on' : '● Offline & private';
  b.classList.toggle('online', on);
  b.title = on ? 'Scorpion may search the web and read pages. Click to go offline.' : 'Scorpion makes no network requests while you chat. Click to go online.';
}

// ---------- settings page ----------
function renderSettings() {
  lookSettings?.render();
  renderVoiceSettings();
  $('#ws-path').textContent = S.settings.workspace || 'Not set';
  $('#online-mode').checked = Boolean(S.settings.online);
  renderOnlineBadge();
  const full = S.settings.fileAccess === 'full';
  $('#file-access').value = full ? 'full' : 'ask';
  $('#login-start').value = S.loginStart || 'off';
  $('#full-at-start').checked = S.settings.fullModeAtStart !== false;
  $('#hands-always').checked = S.settings.handsAlwaysOn !== false;
  $('#file-access-hint').textContent = full
    ? 'Scorpion can read, create, edit and move files anywhere on this computer. Changes and commands still ask first unless Auto-approve is on. System folders (Windows, Program Files) stay read-only.'
    : 'Scorpion works in the workspace folder and asks before touching files anywhere else.';
  $('#allowed-folders-field').classList.toggle('hidden', full);
  const allowed = S.settings.allowedFolders || [];
  $('#allowed-folders').innerHTML = allowed.length
    ? allowed.map((f) => `<div class="row"><code>${esc(f)}</code><button class="btn small" data-unallow="${esc(f)}">Remove</button></div>`).join('')
    : '<span class="muted small">None</span>';
  const commands = S.settings.commandAllowlist || [];
  $('#allowed-commands').innerHTML = commands.length
    ? commands.map((c) => `<div class="row"><code>${esc(c)}</code><button class="btn small" data-unallow-command="${esc(c)}">Remove</button></div>`).join('')
    : '<span class="muted small">None</span>';
  $('#precise-answers').checked = S.settings.preciseAnswers !== false;
  $('#thinking').value = ['low', 'medium', 'high'].includes(S.settings.thinking) ? S.settings.thinking : 'auto';
  const chatModels = S.models.filter((m) => m.kind === 'chat');
  const vm = S.settings.voiceModel || 'auto';
  $('#voice-model').innerHTML = `<option value="auto">Automatic: a fast model when the chat model is slow here</option><option value="same">Same as the chat model</option>${chatModels.map((m) => `<option value="${esc(m.path)}">${esc(m.name)}</option>`).join('')}`;
  $('#voice-model').value = vm === 'auto' || vm === 'same' || chatModels.some((m) => m.path === vm) ? vm : 'auto';
  const fastOne = chatModels.find((m) => m.path !== S.settings.chatModel && m.fit === 'fast');
  const mainSlow = chatModels.find((m) => m.path === S.settings.chatModel && m.fit && m.fit !== 'fast');
  $('#voice-model-note').textContent = vm === 'auto'
    ? (mainSlow ? (fastOne ? `Your chat model is slow on this computer, so voice and Interact use ${fastOne.name} for quick replies.` : 'Your chat model is slow on this computer. Install a smaller model (Models) for quicker spoken replies.') : 'Voice and Interact use your chat model, which runs fast here.')
    : 'Voice and Interact replies come from this model; typed chats keep the chat model.';
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
  renderThreads(); renderTopbar(); renderModels(); renderDocs(); renderMemory(); renderAgents(); renderSchedules(); renderSettings(); renderMessages(); renderVoiceButtons(); renderPeople();
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

async function newThread(agentId, workspaceId = null) {
  S.thread = await api.createThread({ agentId: typeof agentId === 'string' ? agentId : S.newChatAgent, mode: S.newChatMode, workspaceId });
  if (workspaceId) S.settings = (await api.state()).settings;
  renderTopbar();
  S.threads.unshift({ id: S.thread.id, title: S.thread.title, updatedAt: Date.now() });
  renderPlanPanel.shown = false;
  setView('chat'); renderThreads(); renderMessages();
  $('#input').focus();
}

async function sendMessage(text, { spoken = false } = {}) {
  text = text.trim();
  if (!text) return;
  if (IX.open) $('#ix-you').textContent = text;
  if (!S.settings.chatModel) { toast('Pick or download a chat model first.'); setView('models'); return; }
  if (!S.thread) await newThread();
  const thread = S.thread;
  if (S.running.has(thread.id)) return;
  thread.messages.push({ role: 'user', text }, { role: 'assistant', blocks: [], agentId: thread.agentId, model: S.engine?.chatModelName || modelName(S.settings.chatModel) });
  S.running.add(thread.id);
  $('#input').value = ''; autosize();
  renderThreads(); renderModelSwitch(); renderMessages();
  // In Interact with FACE on, the reply knows who is talking.
  const speakerName = IX.open && FX.on ? FX.speaker?.name || null : null;
  const mood = IX.open && FX.on ? FX.mood || null : null;
  try { await api.send({ threadId: thread.id, text, spoken, speaker: speakerName, mood }); } catch (err) {
    S.running.delete(thread.id);
    thread.messages.at(-1).error = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    renderMessages();
  }
}

function applyChatEvent(ev) {
  voiceOnChatEvent(ev);
  if (ev.type === 'done') home?.refresh(); // recent activity
  if (ev.type === 'approval') { S.pending.set(ev.id, ev); if (ev.threadId === S.thread?.id) orbSys?.onApproval(ev); }
  if (ev.type === 'tool-result') orbSys?.clearApproval(ev.id);
  if (ev.type === 'done' && ev.threadId === S.thread?.id) orbSys?.clearApproval();
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
  $('#open-settings').onclick = () => (MAIN_VIEWS.includes(S.view) ? setView(S.lastSettingsView || 'settings') : setView(S.lastMainView || 'home'));
  $('#back-to-chat').onclick = () => setView(S.lastMainView || 'home');
  $('#open-home').onclick = () => setView('home');
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !MAIN_VIEWS.includes(S.view)) setView(S.lastMainView || 'home'); });
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
  $('#stop').onclick = () => { speaker.stop(); if (S.thread) api.stop(S.thread.id); };
  wireVoice();
  wireInteract();
  wirePeople();
  const libraryView = initLibrary({ api, $, esc, toast, errText, gb });
  desktopUi = initDesktop({ api, $, esc, toast, errText, setView, S });
  orbSys = initOrbSystem({ api, $, S, IX, V, speaker, recorder, toast, errText, listen, sendMessage, setView, closeInteract, openInteract, startFace, stopFace, FX, desktopUi, renderInteract, pageGestures: (r) => hands?.handle(r, { globals: false }), handIsMouse, orbFps, runIntent: (it) => palette?.run(it) });
  home = initHome({ api, $, esc, toast, errText, S, setView, newThread, sendMessage, openThread, openInteract, desktopUi });
  hands = initHandControl({ api, $, S, V, IX, orbSys, setView, desktopUi });
  welcome = initWelcome({ api, $, S, speaker, listen, toast, errText, installVoice, startHands: () => toggleHands(true), setView });
  lookSettings = initLookSettings({ $, api, S, setSetting, toast, IX, startWelcome: () => welcome.start({ force: true }) });
  systemSettings = initSystemSettings({ $, esc, api, toast, errText });
  // The taskbar's buttons and folders opened while Scorpion is the Windows desktop.
  const onNav = ({ view, dir, select, signin, search, talk, query, section }) => {
    // Typing on the intent wheel: the command palette, with what was typed.
    if (view === 'palette') { palette.open(query || ''); return; }
    // The "Updates ready" notice and "Software updates": Settings → This computer.
    // The taskbar's Customize…: Settings → Windows and taskbar.
    if (view === 'settings' && section === 'layout') { const go = () => { setView('settings'); requestAnimationFrame(() => $('#layout-field')?.scrollIntoView({ block: 'start' })); }; if (IX.open && !orbSys.away) orbSys.leave(go); else go(); return; }
    if (view === 'settings' && section === 'system') { const go = () => { setView('settings'); systemSettings?.show(); }; if (IX.open && !orbSys.away) orbSys.leave(go); else go(); return; }
    // The intent wheel's Talk: the orb, listening.
    if (view === 'orb' && talk) {
      const ready = () => { if (!S.voice?.installed) $('#ix-input').focus(); else if (!V.talk) startTalk(); };
      if (IX.open) { orbSys.returnToOrb(); ready(); } else openInteract({ desktop: true, signin }).then(ready);
      return;
    }
    if (view === 'orb' && search) {
      const ready = () => IX.orb?.focusSearch?.();
      if (IX.open) { orbSys.returnToOrb(); ready(); } else openInteract({ desktop: true, signin }).then(ready);
      return;
    }
    // The desktop: the orb (Settings → Windows desktop), or the Home page.
    if (view === 'orb') { if (IX.open) orbSys.returnToOrb(); else openInteract({ desktop: true, signin }); return; }
    if (view === 'desktop') {
      if (S.settings.orbDesktop === false) { if (orbSys.desktop) closeInteract(); setView('home'); }
      else if (IX.open) orbSys.returnToOrb();
      else openInteract({ desktop: true, signin });
      return;
    }
    const open = () => {
      if (view === 'apps') desktopUi.showApps();
      else if (view === 'files') desktopUi.showFiles(dir, select);
      else if (view === 'library') $('#open-library').click();
      else if (VIEWS.includes(view)) setView(view);
    };
    // Over the orb desktop the place opens on top of it; "back" returns.
    if (IX.open && !orbSys.away) orbSys.leave(open); else open();
  };
  api.onNavView?.(onNav);
  palette = initPalette({
    $, esc, api, toast, errText, nav: onNav, live: () => Boolean(S.live),
    ask: (text) => { if (!IX.open) setView('chat'); sendMessage(text); },
    ui: {
      newChat: () => { if (IX.open && !orbSys.away) orbSys.leave(() => newThread()); else newThread(); },
      talk: () => onNav({ view: 'orb', talk: true }),
      sidebar: () => $('#sidebar-toggle').click(),
      welcome: () => welcome.start({ force: true }),
    },
  });
  // Anything asked for before this page was ready (the desktop at sign-in).
  api.navReady?.().then((pending) => pending && onNav(pending)).catch(() => {});
  extras = initExtras({ api, $, esc, toast, errText, S, setView, reloadMemories, renderAll: () => renderAll() });
  $('#open-library').onclick = () => { setView('library'); libraryView.show(); };
  // The sidebar can be hidden for more room (Ctrl+B); remembered on this computer.
  const setSidebar = (hidden) => {
    document.body.classList.toggle('sidebar-hidden', hidden);
    const b = $('#sidebar-toggle');
    b.setAttribute('aria-pressed', String(hidden));
    b.title = hidden ? 'Show the sidebar (Ctrl+B)' : 'Hide the sidebar for more room (Ctrl+B)';
    b.setAttribute('aria-label', hidden ? 'Show the sidebar' : 'Hide the sidebar');
    try { localStorage.setItem('sidebarHidden', hidden ? '1' : ''); } catch { /* not kept */ }
  };
  let sidebarHidden = false;
  try { sidebarHidden = localStorage.getItem('sidebarHidden') === '1'; } catch { /* default */ }
  setSidebar(sidebarHidden);
  $('#sidebar-toggle').onclick = () => setSidebar(!document.body.classList.contains('sidebar-hidden'));
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'b' && !IX.open) { e.preventDefault(); $('#sidebar-toggle').click(); } });

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
    if (id) { api.approve({ id, approved: ok?.dataset.always ? 'always' : !!ok }); S.pending.delete(id); scheduleRender(); }
  };

  $('#workspace-chip').onclick = async () => {
    S.settings = await api.chooseWorkspace(S.thread?.id);
    if (S.thread) S.thread = await api.getThread(S.thread.id);
    renderAll();
  };
  $('#choose-ws').onclick = $('#workspace-chip').onclick;
  $('#open-ws').onclick = () => api.openWorkspace();
  $('#modes').onclick = (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); };
  $('#model-picker').onchange = async (e) => {
    const value = e.target.value;
    if (value === '__manage') { renderModelSwitch(); setView('models'); return; }
    if (value.startsWith('source:')) {
      const p = (S.settings.providers || []).find((x) => x.id === value.slice(7));
      await setSetting({ chatSource: p.id });
      const onThisPc = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(p.baseUrl);
      toast(`Chats now use ${p.model || 'a model'} on ${p.name}.${onThisPc ? '' : ' Your messages go to that service.'}`, 3500);
      return;
    }
    S.modelStatus = { loading: true, name: modelName(value) };
    await setSetting({ chatModel: value, chatSource: 'local' });
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
    if (t.dataset.useSource) {
      await setSetting({ chatSource: t.dataset.useSource });
      toast('Chats now use this model. Switch back any time in the model menu at the top of a chat.', 4000);
    } else if (t.id === 'open-connections') {
      setView('connections');
    } else if (t.dataset.use) {
      await setSetting(t.dataset.kind === 'embedding' ? { embedModel: t.dataset.use } : { chatModel: t.dataset.use, chatSource: 'local' });
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
  $('#precise-answers').onchange = (e) => setSetting({ preciseAnswers: e.target.checked });
  $('#thinking').onchange = (e) => setSetting({ thinking: e.target.value });
  $('#voice-model').onchange = (e) => setSetting({ voiceModel: e.target.value });
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
    toast(`${agentById(agentId).name} is answering in this chat.`, 2500);
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
  $('#new-agent').onclick = () => { S.editingAgent = { name: '', description: '', instructions: '', tools: ['*'], temperature: 0.6 }; renderAgentEditor(); $('#ae-name').focus(); };
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
  // Scheduled agents need Scorpion running: this starts it in the tray (or keeps "Open the orb").
  $('#open-at-login').onchange = async (e) => { S.loginStart = await api.setLoginStart(e.target.checked ? (S.loginStart === 'orb' ? 'orb' : 'tray') : 'off'); $('#login-start').value = S.loginStart; };
  api.onPerfChanged?.(applyPerf);
  $('#full-at-start').onchange = async (e) => { S.settings = await api.updateSettings({ fullModeAtStart: e.target.checked }); };
  $('#full-now').onclick = () => api.setFullMode(true);
  // Full mode always shows its way out (the keys are in the button's tip).
  const showFullExit = () => $('#full-exit').classList.toggle('hidden', !S.fullMode);
  $('#full-exit').onclick = () => api.setFullMode(false);
  showFullExit();
  // Full mode can change before this page hears of it (Scorpion OS's first
  // start), so the main process is also asked at start and whenever the
  // window changes size (which every change of full mode does).
  const askFullMode = () => api.isFullMode?.().then((on) => { S.fullMode = Boolean(on); showFullExit(); }).catch(() => {});
  askFullMode();
  addEventListener('resize', () => { clearTimeout(askFullMode.t); askFullMode.t = setTimeout(askFullMode, 250); });
  api.onFullMode?.((on) => {
    S.fullMode = on;
    showFullExit();
    if (on) toast('Full screen. To leave: Ctrl+Esc, or press Esc twice. F11 brings it back.', 6000);
  });
  $('#login-start').onchange = async (e) => { S.loginStart = await api.setLoginStart(e.target.value); e.target.value = S.loginStart; $('#open-at-login').checked = S.loginStart !== 'off'; };

  api.onThreadsChanged(async () => { S.threads = (await api.state()).threads; renderThreads(); });
  api.onSchedulesChanged(reloadSchedules);
  api.onOpenThread((id) => openThread(id));
  // The agent can set the workspace or allow a folder mid-chat.
  api.onSettingsChanged((settings) => { S.settings = settings; renderTopbar(); renderModes(); renderSettings(); renderVoiceButtons(); IX.orb?.refreshSettings?.(); });
  const setOnline = async (on) => {
    S.settings = await api.updateSettings({ online: on });
    renderSettings();
    toast(on ? 'Online mode on: Scorpion can search the web and read pages.' : 'Offline: Scorpion makes no network requests while you chat.');
  };
  $('#online-mode').onchange = (e) => setOnline(e.target.checked);
  $('#online-badge').onclick = () => setOnline(!S.settings.online);
  $('#file-access').onchange = async (e) => {
    const full = e.target.value === 'full';
    if (full && !confirm('Give Scorpion access to every file on this computer?\n\nIt can then read, create, edit and move any of your files. Changes and commands still ask for your approval unless Auto-approve is on. System folders stay read-only.')) {
      e.target.value = 'ask';
      return;
    }
    S.settings = await api.updateSettings({ fileAccess: full ? 'full' : 'ask' });
    renderSettings();
    renderModes();
  };
  $('#allowed-folders').onclick = async (e) => {
    const f = e.target.closest('[data-unallow]')?.dataset.unallow;
    if (!f) return;
    S.settings = await api.updateSettings({ allowedFolders: (S.settings.allowedFolders || []).filter((x) => x !== f) });
    renderSettings();
  };
  $('#allowed-commands').onclick = async (e) => {
    const c = e.target.closest('[data-unallow-command]')?.dataset.unallowCommand;
    if (c === undefined) return;
    S.settings = await api.updateSettings({ commandAllowlist: (S.settings.commandAllowlist || []).filter((x) => x !== c) });
    renderSettings();
  };
  api.onChatEvent(applyChatEvent);
  api.onModelStatus((st) => {
    const wasLoading = S.modelStatus?.loading;
    S.modelStatus = st;
    if (st.info) S.engine = st.info;
    if (st.error) toast(`Could not load model: ${st.error}`, 8000);
    else if (wasLoading && !st.loading && st.info?.chatModelName) toast(`${st.info.chatModelName} is ready.`, 2500);
    renderWait(st);
    renderTopbar();
    if (!st.loading) renderModels();
  });
  $('#wait-hide').onclick = () => { S.wait.hidden = true; $('#wait').classList.add('hidden'); };
  api.onDownload((p) => { S.downloads[p.id] = p; if (S.view === 'models') renderModels(); });
  api.onDocsProgress((p) => { $('#docs-progress').textContent = p ? `Indexing ${p.name}: ${p.done}/${p.total}` : ''; });
}

if ((await api.lockStatus()).locked) await showLockScreen();
wire();
await refresh();
// Start on the home screen; the latest chat is loaded behind it for the chat view.
if (S.threads[0]) await openThread(S.threads[0].id);
setView('home');
if (S.settings.chatModel && !S.engine?.chatModel) api.loadModel().catch(() => {});
// Gestures on (Windows): the hand is the mouse whenever Scorpion is open.
if (handIsMouse() && S.settings.handsAlwaysOn !== false) startGestures();
// Room for Scorpion's taskbar while Scorpion is full screen: at the bottom
// for the bar, on the right for the edge rail.
const setInset = (inset) => {
  const { bottom = 0, right = 0 } = typeof inset === 'number' ? { bottom: inset } : inset || {};
  document.documentElement.style.setProperty('--tb-h', `${bottom}px`);
  document.documentElement.style.setProperty('--tb-w', `${right}px`);
};
setInset(S.taskbarInset);
api.onTaskbarInset?.(setInset);
if (S.voice?.installed && S.settings.voiceSpeak) api.warmVoice();
