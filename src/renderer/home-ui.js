// The Scorpion shell's home screen: the ask box and Scorpion's tools (with live
// status) as holographic tiles that fill the screen. Everything it opens is the
// same app underneath: chats, Interact, Library, Settings tabs.
const svg = (paths) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  chat: svg('<path d="M4 5h16v11H9l-5 4z"/>'),
  interact: svg('<circle cx="12" cy="12" r="4"/><ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-25 12 12)"/>'),
  library: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>'),
  docs: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>'),
  agents: svg('<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 19c0-3 2.5-5 5-5s5 2 5 5M11 19c0-3 2.5-5 5-5s5 2 5 5"/>'),
  skills: svg('<path d="M4 20l6-6M14 4l6 6-8 8-6-6z"/><path d="M14 10l-4 4"/>'),
  schedules: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>'),
  memory: svg('<path d="M12 4c-4 0-7 3-7 7 0 2 1 4 2 5v4h4v-3h2v3h4v-4c1-1 2-3 2-5 0-4-3-7-7-7z"/>'),
  people: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>'),
  connections: svg('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>'),
  models: svg('<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'),
  apps: svg('<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>'),
  files: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
};

export function initHome({ api, $, esc, toast, errText, S, setView, newThread, sendMessage, openThread, openInteract, desktopUi }) {
  const H = { workspaces: [] }; // for "working in …" under the greeting

  const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  // The tools, each with a live one-line status from Scorpion's state.
  function tools() {
    const st = S;
    const chatModel = (st.models || []).find((m) => m.path === st.settings.chatModel);
    const remote = (st.settings.providers || []).find((p) => p.id === st.settings.chatSource);
    const lib = st.library?.counts;
    const enabledSkills = (st.skills || []).filter((s) => s.enabled).length;
    const people = st.faces?.people?.length || 0;
    const scheds = (st.schedules || []).filter((s) => s.enabled).length;
    const tg = st.settings.telegram;
    return [
      { key: 'chat', name: 'New chat', note: 'Ask, plan or build', run: () => newThread() },
      { key: 'interact', name: 'Interact', note: st.voice?.installed ? 'Talk face to face' : 'Voice not installed yet', run: () => openInteract() },
      ...(navigator.userAgent.includes('Windows') ? [
        { key: 'apps', name: 'Apps', note: 'Everything installed on this PC', run: () => desktopUi.showApps() },
        { key: 'files', name: 'Files', note: 'Drives, folders and files', run: () => desktopUi.showFiles() },
      ] : []),
      { key: 'library', name: 'Library', note: lib?.total ? `${lib.total} photos, videos and songs` : 'Tag your photos, videos and music', run: () => $('#open-library').click() },
      { key: 'docs', name: 'Documents', note: st.documents?.length ? plural(st.documents.length, 'document') : 'Chat with your files', view: 'docs' },
      { key: 'skills', name: 'Skills', note: plural(enabledSkills, 'skill'), view: 'skills' },
      { key: 'agents', name: 'Agents', note: plural((st.agents || []).length, 'agent'), view: 'agents' },
      { key: 'schedules', name: 'Schedules', note: scheds ? `${scheds} running` : 'Run agents on a timer', view: 'schedules' },
      { key: 'memory', name: 'Memory', note: plural((st.memories || []).length, 'memory', 'memories'), view: 'memory' },
      { key: 'people', name: 'People', note: st.faces?.installed ? plural(people, 'person', 'people') : 'Face recognition', view: 'people' },
      { key: 'connections', name: 'Connections', note: tg?.enabled ? 'Phone connected' : 'Phone, model servers, tools', view: 'connections' },
      { key: 'models', name: 'Models', note: remote ? `${remote.model} · ${remote.name}` : chatModel ? chatModel.name : 'No model yet', view: 'models' },
      { key: 'settings', name: 'Settings', note: st.settings.online ? 'Online mode on' : 'Offline & private', view: 'settings' },
    ];
  }

  function render() {
    const st = S;
    const ws = H.workspaces;
    const model = (st.settings.providers || []).find((p) => p.id === st.settings.chatSource)?.model || (st.models || []).find((m) => m.path === st.settings.chatModel)?.name;
    $('#home-page').innerHTML = `
      <section class="home-hero">
        <h1>${greeting()}</h1>
        <p class="muted">${model ? `Running ${esc(model)}` : 'No model selected'} · ${st.settings.online ? 'online' : 'offline and private'}${st.settings.workspace ? ` · working in ${esc(ws.find((w) => w.active)?.name || st.settings.workspace)}` : ''}</p>
        <form class="home-ask" id="home-ask" autocomplete="off">
          <input class="text-input" id="home-input" placeholder="Ask Scorpion anything, or tell it what to do: “open my Downloads”, “summarize report.pdf”…" aria-label="Ask Scorpion">
          <button class="btn primary" type="submit">Ask</button>
        </form>
      </section>
      <section class="home-tools-wrap">
        <h2>Tools</h2>
        <div class="home-tools">${tools().map((t) => `<button type="button" class="home-tool" data-tool="${t.key}">${ICONS[t.key] || ''}<span class="name">${esc(t.name)}</span><span class="note">${esc(t.note)}</span></button>`).join('')}</div>
      </section>`;
  }

  async function load() {
    try {
      const d = await api.homeGet();
      H.workspaces = d.workspaces;
    } catch (err) { toast(errText(err)); }
    if (S.view === 'home') render();
  }

  $('#home-page').addEventListener('submit', async (e) => {
    if (e.target.id !== 'home-ask') return;
    e.preventDefault();
    const text = $('#home-input').value.trim();
    if (!text) return;
    await newThread();
    await sendMessage(text);
  });

  $('#home-page').addEventListener('click', (e) => {
    const tool = e.target.closest('[data-tool]')?.dataset.tool;
    const t = tool && tools().find((x) => x.key === tool);
    if (t?.run) t.run(); else if (t?.view) setView(t.view);
  });

  return {
    show() { render(); load(); },
    refresh() { if (S.view === 'home') load(); },
  };
}
