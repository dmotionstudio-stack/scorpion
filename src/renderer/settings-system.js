// Settings → General → This computer (Scorpion OS only): system updates
// (check, install, progress, restart) and Undo a change (the system's
// snapshots, put back from the next restart). The main process does the work
// (updates.js, linux-control.js); this shows it.

// "Checked 10:42", "Checked yesterday", or nothing.
export function checkedWhen(at, now = Date.now()) {
  if (!at) return '';
  const d = new Date(at);
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86400000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return days <= 0 ? `Checked ${time}` : days === 1 ? `Checked yesterday, ${time}` : `Checked ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}
// One line for the updates' state.
export function updatesLine(u = {}) {
  if (u.installing) return `Installing… ${u.progress ?? 0}%${u.step ? ` · ${u.step}` : ''}`;
  if (u.checking) return 'Looking for updates…';
  if (u.error) return u.error;
  if (u.restartNeeded) return 'Updates installed. Restart to finish.';
  if (u.summary) return `${u.summary} ready`;
  if (u.lastCheck) return `Up to date · ${checkedWhen(u.lastCheck)}`;
  return 'Not checked yet';
}
// A snapshot as people read it: "Before installing or removing packages · Oct 26, 8:30 AM".
export function snapshotLabel(s) {
  const when = s.date ? new Date(s.date) : null;
  const at = when && !Number.isNaN(when.getTime()) ? when.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : s.id;
  return { reason: s.reason || 'Snapshot', at };
}

// ctx: { $, esc, api, toast, errText }
export function initSystemSettings({ $, esc, api, toast, errText }) {
  let U = null;
  let snaps = null;
  let undoing = null;

  function renderUpdates() {
    if (!U) return;
    $('#sys-upd-status').textContent = updatesLine(U);
    $('#sys-upd-status').classList.toggle('error-text', Boolean(U.error));
    const list = [...(U.found?.system || []).map((p) => `${esc(p.name)} <span class="muted">${esc(p.to)}</span>`), ...(U.found?.apps || []).map((a) => `${esc(a.name)} <span class="muted">app</span>`)];
    $('#sys-upd-list').hidden = !list.length || U.installing;
    $('#sys-upd-list').innerHTML = list.slice(0, 8).map((l) => `<li>${l}</li>`).join('') + (list.length > 8 ? `<li class="muted">and ${list.length - 8} more</li>` : '');
    $('#sys-upd-progress').hidden = !U.installing;
    $('#sys-upd-bar').style.width = `${U.progress ?? 0}%`;
    $('#sys-upd-check').disabled = U.checking || U.installing;
    $('#sys-upd-install').hidden = !U.summary || U.installing;
    $('#sys-restart').hidden = !U.restartNeeded && !undoing;
  }

  function renderSnaps() {
    if (snaps === null) { $('#sys-snap-status').textContent = 'Loading…'; return; }
    $('#sys-undo-block').hidden = !snaps.supported;
    if (!snaps.supported) return;
    $('#sys-snap-status').textContent = undoing ? 'Restart to finish going back.' : snaps.list.length ? `${snaps.list.length} saved` : 'None yet';
    $('#sys-snaps').innerHTML = snaps.list.map((s) => {
      const { reason, at } = snapshotLabel(s);
      return `<div class="sys-snap"><div><div>${esc(reason)}</div><div class="muted small">${esc(at)}</div></div><button class="btn small" data-undo="${esc(s.id)}">Go back to this</button></div>`;
    }).join('') || '<div class="muted small">Snapshots appear here after the first update or system change.</div>';
  }

  async function load() {
    try {
      U = await api.sysUpdates({});
      if (!U.supported) return; // Windows, macOS, or Scorpion OS from the USB stick
      $('#sys-card').hidden = false;
      renderUpdates();
      snaps = await api.sysSnapshots({}).catch(() => ({ supported: false, list: [] }));
      renderSnaps();
    } catch { /* not Scorpion OS */ }
  }

  $('#sys-upd-check').onclick = async () => { U = await api.sysUpdates({ action: 'check' }); renderUpdates(); };
  $('#sys-upd-install').onclick = async () => { U = await api.sysUpdates({ action: 'install' }); renderUpdates(); };
  $('#sys-restart').onclick = () => api.sysSnapshots({ action: 'restart' }).catch((err) => toast(errText(err)));
  $('#sys-snaps').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-undo]');
    if (!b) return;
    const s = snaps.list.find((x) => x.id === b.dataset.undo);
    const { reason, at } = snapshotLabel(s);
    if (!confirm(`Go back to "${reason}" (${at})?\n\nPrograms and system settings return to how they were then, from the next restart. Your files are not touched.`)) return;
    b.disabled = true;
    try {
      const r = await api.sysSnapshots({ action: 'undo', id: s.id });
      snaps = r;
      undoing = s.id;
      toast(r.message || 'Restart to finish.');
    } catch (err) {
      toast(errText(err));
    }
    renderSnaps(); renderUpdates();
  });
  api.onSysUpdates?.((u) => { U = u; renderUpdates(); });

  load();
  // Settings opened from the "Updates ready" notice or "Software updates": straight to it.
  return { show: () => { load(); $('#sys-card').scrollIntoView({ block: 'start', behavior: 'smooth' }); } };
}
