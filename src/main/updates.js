// System updates on Scorpion OS, done by Scorpion instead of Ubuntu's
// Software Updater pop-up: a check 10 minutes after start and every 6 hours,
// an "Updates ready" notice (once for each new set of updates) with Install
// and Later, and the state Settings → This computer shows. The work itself is
// linux-control.js (checkUpdates, installUpdates) and scorpion-update.
import { spawn } from 'node:child_process';

const FIRST_CHECK = 10 * 60_000;
const EVERY = 6 * 3600_000;

// The words for a set of updates: "3 system updates and 1 app".
export function updatesSummary({ system = [], apps = [] } = {}) {
  const part = (n, one, many) => (n ? `${n} ${n === 1 ? one : many}` : null);
  const parts = [part(system.length, 'system update', 'system updates'), part(apps.length, 'app', 'apps')].filter(Boolean);
  return parts.length ? parts.join(' and ') : null;
}
// The same set of updates is announced only once.
export const updatesKey = ({ system = [], apps = [] } = {}) => [...system.map((u) => `${u.name}=${u.to}`), ...apps.map((a) => a.id)].sort().join(',');

// deps: { sys (linux-control), send(channel, payload), onInstallAsked(), getSettings, updateSettings }
export function createUpdates({ sys, send, onInstallAsked = () => {}, getSettings = () => ({}), updateSettings = () => {} }) {
  const U = { supported: sys.updatesAvailable(), checking: false, installing: false, progress: null, step: '', lastCheck: null, found: null, error: null, restartNeeded: false };
  const view = () => ({ ...U, summary: U.found ? updatesSummary(U.found) : null });
  const changed = () => send('sys:updates', view());
  let timer = 0;

  async function check({ quiet = false } = {}) {
    if (!U.supported || U.checking || U.installing) return view();
    U.checking = true; U.error = null; changed();
    try {
      U.found = await sys.checkUpdates();
      U.lastCheck = Date.now();
      const key = updatesKey(U.found);
      if (quiet && key && key !== getSettings().updatesAnnounced) {
        updateSettings({ updatesAnnounced: key });
        announce(updatesSummary(U.found));
      }
    } catch (err) {
      U.error = err.message;
    } finally {
      U.checking = false; changed();
    }
    return view();
  }

  async function install() {
    if (!U.supported || U.installing) return view();
    if (!U.found) await check();
    U.installing = true; U.error = null; U.progress = 0; U.step = 'Starting'; changed();
    try {
      U.restartNeeded = await sys.installUpdates((pct, step) => { U.progress = Math.round(pct); U.step = step; changed(); });
      U.found = { system: [], apps: [] };
      U.lastCheck = Date.now();
    } catch (err) {
      U.error = err.message;
    } finally {
      U.installing = false; U.progress = null; U.step = ''; changed();
    }
    return view();
  }

  // The notice, through the session's notification server (Scorpion's own
  // cards on Scorpion OS): notify-send waits and says which button was used.
  function announce(summary) {
    if (!summary) return;
    const child = spawn('notify-send', ['--app-name=Scorpion', '--icon=system-software-update', '--action=install=Install now', '--action=later=Later', '--wait',
      'Updates ready', `${summary}. Scorpion takes a snapshot first, so they can be undone.`], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => {});
    child.on('close', () => { if (out.trim() === 'install') { onInstallAsked(); install(); } });
  }

  function start() {
    if (!U.supported) return;
    clearTimeout(timer);
    const loop = (wait) => { timer = setTimeout(async () => { await check({ quiet: true }); loop(EVERY); }, wait); };
    loop(FIRST_CHECK);
  }

  return { view, check, install, start };
}
