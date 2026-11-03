// Settings → General → Updates (Windows and macOS): Scorpion's own new
// versions from its GitHub releases. Check now, the download's progress,
// Restart and update (Windows) or Download (macOS, portable copies), and
// whether Scorpion looks by itself. The main process does the work
// (app-updates.js); this shows it.

// ctx: { $, api, S, toast, errText }
export function initAppUpdates({ $, api, S, toast, errText }) {
  let U = null;

  function render() {
    if (!U?.supported) return;
    $('#app-upd-field').hidden = false;
    $('#app-upd-status').textContent = U.line || '';
    $('#app-upd-status').classList.toggle('error-text', Boolean(U.error));
    $('#app-upd-progress').hidden = !U.downloading;
    $('#app-upd-bar').style.width = `${U.progress ?? 0}%`;
    $('#app-upd-check').disabled = U.checking || U.downloading;
    $('#app-upd-restart').hidden = !U.ready;
    $('#app-upd-download').hidden = U.installs || !U.available?.url;
    $('#app-upd-auto').checked = S.settings.appUpdates !== false;
    $('#app-upd-note').textContent = U.installs
      ? 'New versions download in the background and install when Scorpion restarts. Your chats, models and settings stay as they are.'
      : 'Scorpion tells you when a new version is out and opens its download.';
  }

  const act = async (action) => {
    try { U = await api.appUpdates({ action }); } catch (err) { toast(errText(err), 'error'); }
    render();
  };
  $('#app-upd-check').onclick = () => act('check');
  $('#app-upd-restart').onclick = () => act('restart');
  $('#app-upd-download').onclick = () => act('download');
  $('#app-upd-auto').onchange = async (e) => {
    try { S.settings = await api.updateSettings({ appUpdates: e.target.checked }); } catch (err) { toast(errText(err), 'error'); }
    render();
  };
  api.onAppUpdates?.((u) => { U = u; render(); });

  api.appUpdates?.({}).then((u) => { U = u; render(); }).catch(() => {});
  return { render };
}
