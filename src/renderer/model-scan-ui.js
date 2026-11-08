// Models → Scan this computer: looks through this computer for model files
// (GGUF) and lists what it finds. A find can be used where it is (nothing is
// copied, so no second 18 GB) or copied into Scorpion's own folder. The
// search itself (model-scan.js) only reads folder listings.

const gb = (bytes) => (bytes / 1024 ** 3 >= 1 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);

// ctx: { api, $, esc, toast, errText, refresh }
export function initModelScan({ api, $, esc, toast, errText, refresh }) {
  let results = null; // { models, folders, ms, stopped, where } of the last search
  let running = false;
  const done = new Set(); // paths already added this time

  function render() {
    const box = $('#scan-panel');
    if (!box) return;
    box.classList.toggle('hidden', !running && !results);
    $('#scan-models').disabled = running;
    if (running) return; // the progress line is written by the events
    if (!results) { box.innerHTML = ''; return; }
    const r = results;
    const head = r.models.length
      ? `${r.models.length} model${r.models.length === 1 ? '' : 's'} found`
      : `No other models found${r.where === 'all' ? '' : ' in the usual places'}`;
    const note = `Looked in ${r.folders.toLocaleString()} folders${r.where === 'all' ? ' across the whole computer' : ''} (${Math.max(1, Math.round(r.ms / 1000))} s)${r.stopped ? ', stopped early' : ''}.`;
    const rows = r.models.map((m, i) => `<div class="scan-row">
      <div class="scan-main"><div class="title">${esc(m.name)}</div>
        <div class="muted small" title="${esc(m.path)}">${esc(m.folder)}</div></div>
      <div class="scan-meta"><span class="tag">${m.kind === 'embedding' ? 'documents' : 'chat'}</span><span class="tag">${gb(m.bytes)}</span></div>
      <div class="scan-actions">${done.has(m.path)
        ? '<span class="small installed">✓ Added</span>'
        : `<button class="btn small primary" data-scan-use="${i}" title="Use the file where it is: nothing is copied">Use here</button><button class="btn small" data-scan-copy="${i}" title="Copy it into Scorpion's model folder (${gb(m.bytes)} more disk)">Copy in</button>`}</div></div>`).join('');
    box.innerHTML = `<div class="scan-head"><b>${head}</b><span class="muted small">${note}</span></div>${rows}
      <div class="row">${r.where === 'all' ? '' : '<button class="btn small" id="scan-all">Search the whole computer</button>'}<button class="btn small" id="scan-close">Close</button></div>`;
  }

  async function start(where) {
    if (running) return;
    running = true;
    results = null;
    const box = $('#scan-panel');
    box.classList.remove('hidden');
    box.innerHTML = `<div class="scan-head"><b>Looking for models…</b><span class="muted small" id="scan-progress">${where === 'all' ? 'Every drive, skipping Windows and program folders' : 'Downloads, Documents, Desktop, LM Studio, Ollama and the other usual places'}</span></div>
      <div class="row"><button class="btn small" id="scan-stop">Stop</button></div>`;
    $('#scan-models').disabled = true;
    try {
      results = await api.scanModels({ where });
    } catch (err) {
      toast(errText(err), 'error');
    }
    running = false;
    render();
  }

  $('#scan-models').onclick = () => start('common');
  api.onModelScan?.((p) => {
    const el = $('#scan-progress');
    if (el) el.textContent = `${p.folders.toLocaleString()} folders · ${p.found} found${p.current ? ` · ${p.current}` : ''}`;
  });
  $('#scan-panel').onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'scan-stop') { api.stopModelScan(); return; }
    if (t.id === 'scan-close') { results = null; done.clear(); render(); return; }
    if (t.id === 'scan-all') { start('all'); return; }
    const use = t.dataset.scanUse;
    const copy = t.dataset.scanCopy;
    const m = results?.models[Number(use ?? copy)];
    if (!m) return;
    t.disabled = true;
    try {
      if (use !== undefined) await api.linkModel({ path: m.path, name: /\.gguf$/i.test(m.path) ? null : m.name });
      else { t.textContent = 'Copying…'; await api.copyModelIn({ path: m.path, name: m.name }); }
      done.add(m.path);
      toast(use !== undefined ? `${m.name} added. Press Use on its card to chat with it.` : `${m.name} copied into Scorpion.`, 5000);
      await refresh();
    } catch (err) {
      t.disabled = false;
      toast(errText(err), 'error');
    }
    render();
  };
  return { render };
}
