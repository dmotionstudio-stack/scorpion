// Settings → General → System → Date and time: the computer's clock as it is
// now, whether it follows the internet's time, Sync now, and a date and time
// set by hand. The main process does the work (clock.js); the system itself
// asks for permission before any change.

// What the permission step is on each system, for the note under the fields.
export const clockNote = (platform) => ({
  win32: 'Windows asks you to allow each change (choose Yes).',
  darwin: 'macOS asks for your password before each change.',
  linux: 'The system asks for your password before each change.',
})[platform] || '';
// One line for how the clock is set.
export function clockLine(c = {}) {
  if (c.supported === false) return "This system's clock can't be changed from Scorpion.";
  if (c.busy) return c.busy;
  if (c.error) return c.error;
  if (c.done) return c.done;
  return c.auto === true ? "Following the internet's time" : c.auto === false ? 'Set by hand' : '';
}
// The date and time fields' values for a moment ("2026-11-09", "14:05").
export function fieldsFor(ms) {
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`, time: `${two(d.getHours())}:${two(d.getMinutes())}` };
}

// ctx: { $, api, toast, errText }
export function initClockSettings({ $, api, toast, errText }) {
  let C = null;
  let touched = false; // the person is choosing a date or time: the fields stop following the clock

  function tick() {
    const el = $('#clock-now');
    if (!el || !el.offsetParent) return; // not on screen
    const now = new Date();
    el.textContent = now.toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
    if (!touched && document.activeElement !== $('#clock-date') && document.activeElement !== $('#clock-time')) {
      const f = fieldsFor(now.getTime());
      if ($('#clock-date').value !== f.date) $('#clock-date').value = f.date;
      if ($('#clock-time').value !== f.time) $('#clock-time').value = f.time;
    }
  }
  function render() {
    if (!C) return;
    const off = C.supported === false || Boolean(C.busy);
    $('#clock-zone').textContent = C.zone ? `Time zone: ${C.zone}` : '';
    $('#clock-auto').checked = C.auto === true;
    for (const id of ['#clock-auto', '#clock-sync', '#clock-set', '#clock-date', '#clock-time']) $(id).disabled = off;
    $('#clock-state').textContent = clockLine(C);
    $('#clock-state').classList.toggle('error-text', Boolean(C.error));
    $('#clock-note').textContent = `Setting it by hand turns automatic time off, so the clock keeps what you set. Syncing needs the internet. ${clockNote(C.platform)}`;
    tick();
  }
  async function act(arg, busy) {
    C = { ...(C || {}), busy, error: '', done: '' };
    render();
    try {
      C = await api.sysClock(arg);
      if (C.done) toast(C.done);
      touched = false;
    } catch (err) {
      const was = await api.sysClock({}).catch(() => C);
      C = { ...was, busy: '', error: errText(err) };
    }
    render();
  }
  $('#clock-auto').onchange = (e) => act({ action: 'auto', on: e.target.checked }, 'Waiting for the system to allow it…');
  $('#clock-sync').onclick = () => act({ action: 'sync' }, 'Syncing…');
  $('#clock-set').onclick = () => act({ action: 'set', date: $('#clock-date').value, time: $('#clock-time').value }, 'Waiting for the system to allow it…');
  for (const id of ['#clock-date', '#clock-time']) $(id).oninput = () => { touched = true; };
  setInterval(tick, 1000);

  const show = () => api.sysClock?.({}).then((c) => { C = c; render(); }).catch(() => {});
  show();
  return { show };
}
