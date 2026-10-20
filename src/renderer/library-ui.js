// The Library view: browse, search and filter what the media library found
// in your photos, videos and music; name groups of faces; manage folders and
// which features run. The tagging itself happens in the main process.
import { serveDecodes } from './mediadecode.js';

const CAT_ORDER = ['People', 'Places', 'Landmarks', 'Animals', 'Food', 'Vehicles', 'Buildings', 'Landscapes', 'Events', 'Sports', 'Things', 'Art', 'Documents', 'Actions', 'Genres', 'Sounds'];

export function initLibrary({ api, $, esc, toast, errText, gb }) {
  const L = { status: null, kind: '', tag: null, query: '', cat: null, results: [], cloud: {}, download: null, timer: 0, lastRefresh: 0, settingsOpen: false };
  const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
  const thumbUrl = (t) => (t ? `/library/thumb/${t}` : '');

  async function refresh() {
    L.status = await api.libraryStatus();
    [L.cloud, L.results] = await Promise.all([api.libraryTags(), api.librarySearch({ query: L.query, kind: L.kind || null, tag: L.tag })]);
    L.lastRefresh = Date.now();
    render();
  }

  function modelsNeeded(s) {
    const f = s.features;
    const need = [];
    if ((f.objects || f.landmarks || f.video) && !s.models.clip.installed) need.push(['CLIP', s.models.clip.bytes]);
    if (f.music && !s.models.audio.installed) need.push(['audio', s.models.audio.bytes]);
    if (f.faces && !s.facesInstalled) need.push(['faces', 39 * 1024 ** 2]);
    return need;
  }

  function renderStatus() {
    const s = L.status;
    if (!s) return;
    const c = s.counts;
    const parts = [`${c.photo} photo${c.photo === 1 ? '' : 's'}`, `${c.video} video${c.video === 1 ? '' : 's'}`, `${c.music} song${c.music === 1 ? '' : 's'}`];
    let scan = '';
    if (L.download) scan = `Downloading models… ${Math.min(100, Math.round(((L.download.loaded || 0) / (L.download.total || 1)) * 100))}%`;
    else if (s.scan.running) scan = `${s.scan.paused ? 'Paused' : 'Tagging'} ${s.scan.done} of ${s.scan.queued}${s.scan.current ? ` · ${esc(s.scan.current.split(/[\\/]/).pop())}` : ''}`;
    else if (s.scan.lastRun) scan = `Up to date${s.scan.errors ? ` · ${s.scan.errors} file(s) couldn't be read` : ''}`;
    const need = modelsNeeded(s);
    $('#lib-status').innerHTML = `<span>${parts.join(' · ')}</span><span class="muted">${scan}</span>`
      + (s.scan.running ? `<button class="btn small" data-lib="pause">${s.scan.paused ? 'Resume' : 'Pause'}</button>` : '')
      + (!s.folders.length ? '<button class="btn small primary" data-lib="add-folder">Add a folder</button>' : '')
      + (need.length && !L.download ? `<button class="btn small primary" data-lib="install">Install models (${gb(need.reduce((n, [, b]) => n + b, 0))})</button>` : '');
  }

  function renderSettings() {
    const s = L.status;
    $('#lib-setup').classList.toggle('hidden', !L.settingsOpen);
    if (!s || !L.settingsOpen) return;
    const need = modelsNeeded(s);
    $('#lib-setup').innerHTML = `
      <h2>Folders</h2>
      <div class="lib-folders">${s.folders.map((f) => `<div class="row"><code>${esc(f)}</code><button class="btn small" data-lib="remove-folder" data-folder="${esc(f)}">Remove</button></div>`).join('') || '<p class="muted small">No folders yet.</p>'}</div>
      <div class="row"><button class="btn" data-lib="add-folder">Add folder…</button><button class="btn" data-lib="scan">Scan now</button></div>
      <p class="muted small">${s.scan.watching ? 'Watching these folders: new, changed, renamed and deleted files are handled within seconds.' : 'Folders are checked when Scorpion starts and when you press Scan now.'} To skip a folder, put an empty file named <code>.nomedia</code> in it (or <code>.noimage</code>, <code>.novideo</code>, <code>.nomusic</code> to skip only that kind).</p>
      <h2>What to recognize</h2>
      <table class="lib-features">${Object.entries(s.featureNames).map(([k, label]) => `<tr><td><label class="toggle"><input type="checkbox" data-feature="${k}"${s.features[k] ? ' checked' : ''}><span>${esc(label)}</span></label></td>
        <td class="muted small">${s.perFeature[k].done} done${s.perFeature[k].waiting ? ` · ${s.perFeature[k].waiting} waiting` : ''}</td><td><button class="btn small" data-reset="${k}" title="Forget these tags and recognize again">Reset</button></td></tr>`).join('')}</table>
      ${s.counts.skipped || s.counts.failed ? `<p class="muted small">${s.counts.skipped ? `${s.counts.skipped} file(s) skipped as too big. ` : ''}${s.counts.failed ? `${s.counts.failed} file(s) couldn't be read.` : ''}</p>` : ''}
      <h2>Limits</h2>
      <div class="row lib-limits">
        <label>Photos up to <input type="number" min="1" data-limit="photoMB" value="${s.limits.photoMB}"> MB</label>
        <label>Videos up to <input type="number" min="1" data-limit="videoMB" value="${s.limits.videoMB}"> MB</label>
        <label>Music up to <input type="number" min="1" data-limit="musicMB" value="${s.limits.musicMB}"> MB</label>
      </div>
      <label class="toggle"><input type="checkbox" data-lowcpu${s.limits.lowCpu ? ' checked' : ''}><span>Low-CPU mode: one processor thread and a short pause between files (slower, quieter)</span></label>
      <h2>Share tags with other apps</h2>
      <select data-share>
        <option value="off"${s.share === 'off' ? ' selected' : ''}>Off: keep tags inside Scorpion</option>
        <option value="sidecar"${s.share === 'sidecar' ? ' selected' : ''}>Sidecar files: photo.jpg.xmp next to each photo and video (originals untouched)</option>
        <option value="embed"${s.share === 'embed' ? ' selected' : ''}>Inside JPEG photos, so Windows shows them as Tags (picture not re-encoded; others get a sidecar)</option>
      </select>
      <p class="muted small">Keywords are written as XMP (dc:subject, plus Scorpion|Category|Tag for Lightroom and digiKam). Another app's existing .xmp or JPEG metadata is never overwritten.</p>
      <div class="row"><button class="btn small" data-lib="share-all">Write tags now</button><button class="btn small" data-lib="unshare-all">Remove what Scorpion wrote</button></div>
      <h2>Models</h2>
      <p class="muted small">Pictures and video: CLIP (${s.models.clip.installed ? 'installed' : gb(s.models.clip.bytes)}). Music: AST (${s.models.audio.installed ? 'installed' : gb(s.models.audio.bytes)}). Faces: YuNet + SFace (${s.facesInstalled ? 'installed' : '39 MB'}). Everything runs on this computer; files are only read, never changed or uploaded.</p>
      <div class="row">${need.length ? `<button class="btn primary" data-lib="install">Install what's needed (${gb(need.reduce((n, [, b]) => n + b, 0))})</button>` : ''}
        <button class="btn small" data-lib="clear">Forget all tags</button><button class="btn small" data-lib="uninstall">Uninstall models</button></div>`;
  }

  function renderCats() {
    const cats = CAT_ORDER.filter((c) => L.cloud[c]?.length);
    $('#lib-cats').innerHTML = cats.length ? `<div class="lib-catrow">${cats.map((c) => `<button class="chip${L.cat === c ? ' active' : ''}" data-cat="${esc(c)}">${esc(c)} <span class="muted">${L.cloud[c].length}</span></button>`).join('')}</div>`
      + (L.cat && L.cloud[L.cat] ? `<div class="lib-tagrow">${L.cloud[L.cat].slice(0, 60).map((t) => `<button class="chip small${L.tag?.label === t.label && L.tag?.cat === L.cat ? ' active' : ''}" data-tag="${esc(t.label)}">${esc(t.label)} <span class="muted">${t.count}</span></button>`).join('')}</div>` : '')
      + (L.tag ? `<div class="row small"><span class="muted">Showing: ${esc(L.tag.cat)} · ${esc(L.tag.label)}</span><button class="btn small" data-lib="clear-tag">Show all</button></div>` : '') : '';
  }

  function tile(r) {
    const tags = r.tags.slice(0, 3).map((t) => esc(t.label)).join(' · ');
    if (r.kind === 'music') {
      return `<div class="lib-song" data-path="${esc(r.path)}"><button class="btn small" data-play="${esc(r.path)}" aria-label="Play">Play</button><div class="who"><b>${esc(r.name)}</b><span class="muted small">${tags || (r.error ? esc(r.error) : 'not tagged yet')}</span></div><span class="muted small">${fmtDur(r.duration)}</span></div>`;
    }
    return `<button class="lib-tile" data-path="${esc(r.path)}" title="${esc(r.name)}">${r.thumb ? `<img src="${thumbUrl(r.thumb)}" loading="lazy" alt="">` : '<div class="lib-noimg"></div>'}`
      + `${r.kind === 'video' ? `<span class="lib-badge">VIDEO ${fmtDur(r.duration)}</span>` : ''}<span class="lib-tags">${tags}</span></button>`;
  }

  function renderGrid() {
    const s = L.status;
    const items = L.results;
    if (!s?.folders.length) { $('#lib-grid').innerHTML = '<div class="muted lib-empty">Add a folder of photos, videos or music. Scorpion tags everything on this computer: objects, landmarks, places, people, actions in videos and music genres.</div>'; return; }
    const songs = items.filter((r) => r.kind === 'music');
    const visual = items.filter((r) => r.kind !== 'music');
    $('#lib-grid').innerHTML = (visual.length ? `<div class="lib-tiles">${visual.map(tile).join('')}</div>` : '')
      + (songs.length ? `<div class="lib-songs">${songs.map(tile).join('')}</div>` : '')
      || `<div class="muted lib-empty">${L.query || L.tag ? 'Nothing matches.' : 'Nothing tagged yet.'}</div>`;
  }

  function render() { renderStatus(); renderSettings(); renderCats(); renderGrid(); }

  async function showDetail(file) {
    const r = L.results.find((x) => x.path === file);
    if (!r) return;
    const url = r.kind === 'photo' ? null : await api.libraryMediaUrl(file);
    const byCat = {};
    for (const t of r.tags) (byCat[t.cat] ||= []).push(t);
    $('#lib-detail').innerHTML = `<div class="lib-detail-card">
      <button class="btn small lib-close" data-lib="close-detail">Close</button>
      ${r.kind === 'video' ? `<video controls src="${url}"></video>` : r.kind === 'music' ? `<audio controls autoplay src="${url}"></audio>` : r.thumb ? `<img src="${thumbUrl(r.thumb)}" alt="">` : ''}
      <h2>${esc(r.name)}</h2>
      <p class="muted small">${esc(r.path)}${r.date ? ` · ${new Date(r.date).toLocaleString()}` : ''}${r.gps ? ` · GPS ${r.gps.join(', ')}` : ''}</p>
      ${Object.entries(byCat).map(([c, ts]) => `<div class="row"><b>${esc(c)}</b> ${ts.map((t) => `<button class="chip small" data-cat-tag="${esc(c)}" data-tag="${esc(t.label)}">${esc(t.label)}${t.score < 1 ? ` <span class="muted">${Math.round(t.score * 100)}%</span>` : ''}</button>`).join('')}</div>`).join('') || '<p class="muted">No tags yet.</p>'}
      ${r.error ? `<p class="muted small">Note: ${esc(r.error)}</p>` : ''}
      <div class="row"><button class="btn" data-lib="open" data-path="${esc(r.path)}">Open</button><button class="btn" data-lib="reveal" data-path="${esc(r.path)}">Show in folder</button></div>
    </div>`;
    $('#lib-detail').classList.remove('hidden');
  }

  function personSelect(exclude, attr, first = 'Move to…') {
    const others = (L.status?.people || []).filter((p) => p.id !== exclude);
    if (!others.length) return ''; // nobody else to pick
    return `<select ${attr}><option value="">${first}</option>${others.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>`;
  }

  // Faces of one person: remove wrong ones, move them, merge people.
  async function renderPersonFaces() {
    const person = L.tag?.cat === 'People' ? (L.status?.people || []).find((p) => p.name === L.tag.label) : null;
    const box = $('#lib-person');
    if (!person) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const list = await api.libraryPersonFaces(person.id);
    box.classList.remove('hidden');
    box.innerHTML = `<h2>Faces of ${esc(person.name)}</h2><p class="muted small">Weakest matches first. Fix a wrong one with "Not ${esc(person.name)}" or move it to the right person.</p>
      <div class="lib-faces">${list.map((f) => `<div class="lib-face" data-face-path="${esc(f.path)}" data-face-n="${f.n}">${f.crop ? `<img src="${f.crop}" alt="">` : ''}
        <span class="muted small">${f.manual ? 'set by you' : `${Math.round(f.similarity * 100)}% match`}</span>
        <button class="btn small" data-face-act="remove">Not ${esc(person.name)}</button>${personSelect(person.id, 'data-face-move')}</div>`).join('') || '<p class="muted small">No faces.</p>'}</div>
      ${personSelect(person.id, '') ? `<div class="row"><span class="muted small">Same person as someone else?</span>${personSelect(person.id, `data-merge-from="${esc(person.id)}"`, 'Merge into…')}</div>` : ''}`;
  }

  async function renderUnassigned() {
    const list = await api.libraryUnassigned().catch(() => []);
    const box = $('#lib-unassigned');
    box.classList.toggle('hidden', !list.length);
    box.innerHTML = list.length ? `<details><summary>Unassigned faces (${list.length})</summary><div class="lib-faces">${list.map((f) => `<div class="lib-face" data-face-path="${esc(f.path)}" data-face-n="${f.n}">${f.crop ? `<img src="${f.crop}" alt="">` : ''}
      ${personSelect('', 'data-face-move', 'This is…')}<button class="btn small" data-face-act="ignore">Hide</button></div>`).join('')}</div></details>` : '';
  }

  async function renderPeople() {
    const clusters = await api.libraryClusters().catch(() => []);
    $('#lib-people').classList.toggle('hidden', !clusters.length);
    $('#lib-people').innerHTML = clusters.length ? `<h2>People in your photos</h2><p class="muted small">Faces Scorpion found but doesn't know yet. Name a group and those photos are tagged with the name; it is also added to People.</p>
      <div class="lib-clusters">${clusters.map((c) => `<div class="lib-cluster" data-cluster="${c.id}"><div class="faces">${c.faces.filter(Boolean).map((f) => `<img src="${f}" alt="">`).join('')}</div>
      <span class="muted small">${c.count} face${c.count === 1 ? '' : 's'} in ${c.photos} photo${c.photos === 1 ? '' : 's'}</span>
      <div class="row"><input class="text-input" placeholder="Name" maxlength="60"><button class="btn small primary" data-name-cluster="${c.id}">Save</button></div></div>`).join('')}</div>` : '';
  }

  async function search() {
    L.results = await api.librarySearch({ query: L.query, kind: L.kind || null, tag: L.tag });
    renderGrid();
    renderPersonFaces();
  }

  async function install() {
    L.download = { loaded: 0, total: 1 };
    renderStatus();
    try {
      L.status = await api.libraryInstall();
      toast('Models installed. Tagging your library now.');
    } catch (err) { toast(`Download failed: ${errText(err)}`, 9000); }
    L.download = null;
    render();
  }

  // ---- events ----
  $('#view-library').addEventListener('click', async (e) => {
    const t = e.target.closest('[data-lib], [data-cat], [data-tag], [data-play], .lib-tile, [data-name-cluster], [data-cat-tag], [data-reset], [data-face-act]');
    if (!t) return;
    if (t.dataset.reset) {
      const name = L.status.featureNames[t.dataset.reset];
      if (!confirm(`Forget the "${name}" tags and recognize again?${t.dataset.reset === 'faces' ? ' Your face corrections are lost too.' : ''}`)) return;
      L.status = await api.libraryResetFeature(t.dataset.reset);
      refresh();
      return;
    }
    if (t.dataset.faceAct) {
      const card = t.closest('[data-face-path]');
      try { await api.librarySetFace({ path: card.dataset.facePath, n: Number(card.dataset.faceN), action: t.dataset.faceAct }); } catch (err) { toast(errText(err), 6000); }
      await refresh();
      renderPersonFaces();
      renderUnassigned();
      return;
    }
    if (t.dataset.nameCluster) {
      const input = t.closest('.lib-cluster').querySelector('input');
      if (!input.value.trim()) { input.focus(); return; }
      try { const p = await api.libraryNameCluster({ id: t.dataset.nameCluster, name: input.value.trim() }); toast(`Saved as ${p.name}.`); } catch (err) { toast(errText(err), 7000); }
      renderPeople();
      refresh();
      return;
    }
    if (t.dataset.catTag) { L.cat = t.dataset.catTag; L.tag = { cat: t.dataset.catTag, label: t.dataset.tag }; $('#lib-detail').classList.add('hidden'); await search(); renderCats(); return; }
    if (t.dataset.cat) { L.cat = L.cat === t.dataset.cat ? null : t.dataset.cat; renderCats(); return; }
    if (t.dataset.tag) { L.tag = L.tag?.label === t.dataset.tag && L.tag?.cat === L.cat ? null : { cat: L.cat, label: t.dataset.tag }; await search(); renderCats(); return; }
    if (t.dataset.play) { showDetail(t.dataset.play); return; }
    if (t.classList.contains('lib-tile')) { showDetail(t.dataset.path); return; }
    const act = t.dataset.lib;
    if (act === 'pause') L.status = await api.libraryPause(!L.status.scan.paused);
    if (act === 'add-folder') L.status = await api.libraryAddFolder();
    if (act === 'remove-folder' && confirm('Remove this folder from the library? Its files are not touched.')) L.status = await api.libraryRemoveFolder(t.dataset.folder);
    if (act === 'scan') L.status = await api.libraryScan();
    if (act === 'install') return install();
    if (act === 'clear' && confirm('Forget every tag in the library? Your files are not touched; the next scan starts over.')) L.status = await api.libraryClear();
    if (act === 'uninstall' && confirm('Remove the library models (CLIP and the audio model)? Tags already found are kept.')) L.status = await api.libraryUninstallModels();
    if (act === 'clear-tag') { L.tag = null; await search(); }
    if (act === 'share-all') { toast(`Tags written for ${await api.libraryShareAll()} file(s).`); return; }
    if (act === 'unshare-all' && confirm('Remove the .xmp files Scorpion wrote and the keywords it put inside JPEGs?')) toast(`Removed from ${await api.libraryUnshareAll()} file(s).`);
    if (act === 'close-detail') { $('#lib-detail').classList.add('hidden'); $('#lib-detail').innerHTML = ''; return; }
    if (act === 'open') { const r = await api.libraryOpen(t.dataset.path); if (r) toast(String(r)); return; }
    if (act === 'reveal') { api.libraryReveal(t.dataset.path); return; }
    refresh();
  });
  $('#view-library').addEventListener('change', async (e) => {
    const el = e.target;
    if (el.dataset.feature) L.status = await api.librarySetFeatures({ [el.dataset.feature]: el.checked });
    if (el.dataset.limit) L.status = await api.librarySetLimits({ [el.dataset.limit]: Number(el.value) });
    if ('lowcpu' in el.dataset) L.status = await api.librarySetLimits({ lowCpu: el.checked });
    if ('share' in el.dataset) {
      if (el.value === 'embed' && !confirm('Write keywords inside your JPEG photos? The picture is not re-encoded and the file date is kept, but the files change. Photos that already have metadata from another app get a sidecar instead.')) { el.value = L.status.share; return; }
      L.status = await api.libraryShare(el.value);
      if (el.value !== 'off') toast(`Tags will be written as ${el.value === 'embed' ? 'keywords in JPEGs' : '.xmp sidecar files'}. Use "Write tags now" for files already tagged.`, 7000);
    }
    const card = el.closest('[data-face-path]');
    if (card && 'faceMove' in el.dataset && el.value) {
      try { await api.librarySetFace({ path: card.dataset.facePath, n: Number(card.dataset.faceN), action: 'assign', personId: el.value }); } catch (err) { toast(errText(err), 6000); }
      await refresh();
      renderPersonFaces();
      renderUnassigned();
      return;
    }
    if (el.dataset.mergeFrom && el.value) {
      const into = (L.status.people || []).find((p) => p.id === el.value);
      if (confirm(`Merge ${L.tag?.label} into ${into?.name}? All their faces become ${into?.name}.`)) {
        await api.libraryMergePeople({ from: el.dataset.mergeFrom, into: el.value });
        L.tag = { cat: 'People', label: into.name };
        await refresh();
        renderPersonFaces();
        return;
      }
      el.value = '';
    }
    render();
  });
  $('#lib-search').addEventListener('input', (e) => {
    clearTimeout(L.timer);
    L.timer = setTimeout(() => { L.query = e.target.value; L.tag = null; search(); renderCats(); }, 300);
  });
  document.querySelectorAll('#lib-kinds [data-kind]').forEach((b) => {
    b.onclick = () => {
      L.kind = b.dataset.kind;
      document.querySelectorAll('#lib-kinds [data-kind]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      search();
    };
  });
  $('#lib-settings-btn').onclick = () => { L.settingsOpen = !L.settingsOpen; renderSettings(); };
  api.onLibraryStatus((s) => {
    L.status = s;
    renderStatus();
    // Show new tags as the scan goes, without redrawing on every file.
    if ($('#view-library').classList.contains('hidden')) return;
    if (!s.scan.running || Date.now() - L.lastRefresh > 6000) refresh();
  });
  api.onLibraryDownload((p) => { if (!p.done && L.download) { L.download = p; renderStatus(); } });
  serveDecodes(api);

  return { show: () => { refresh(); renderPeople(); renderUnassigned(); renderPersonFaces(); } };
}
