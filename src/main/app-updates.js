// Scorpion's own updates on Windows and macOS, from its GitHub releases:
// a check 2 minutes after start and every 6 hours (Settings → General →
// Updates can turn that off; Check now always works), and the state Settings
// shows. Windows (installed): electron-updater downloads the new installer in
// the background (checked against the release's latest.yml) and it installs
// when Scorpion quits, or now with "Restart and update". macOS (the disk
// images aren't signed, so they can't replace themselves) and portable
// copies: Scorpion says a new version is out and opens its download.
// Scorpion OS updates the app with the system (updates.js).

export const REPO = { owner: 'dmotionstudio-stack', repo: 'scorpion' };
const FIRST_CHECK = 2 * 60_000;
const EVERY = 6 * 3600_000;

// "0.1.12" > "0.1.9"; a leading v and anything after a dash are ignored.
export function isNewer(candidate, current) {
  const parts = (v) => String(v || '').replace(/^v/i, '').split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

// From GitHub's latest release, the file this computer should download:
// the Mac's disk image for its processor, or the Windows installer.
export function pickDownload(release, { platform, arch }) {
  const assets = release?.assets || [];
  const named = (test) => assets.find((a) => test(a.name.toLowerCase()))?.browser_download_url;
  if (platform === 'darwin') {
    const arm = (n) => /arm64|apple-silicon/.test(n);
    return named((n) => n.endsWith('.dmg') && (arch === 'arm64' ? arm(n) : !arm(n))) || release?.html_url || null;
  }
  if (platform === 'win32') return named((n) => n.endsWith('.exe')) || release?.html_url || null;
  return release?.html_url || null;
}

// One line for the state, as Settings shows it.
export function appUpdateLine(u = {}) {
  if (!u.supported) return '';
  if (u.error) return u.error;
  if (u.ready) return `Scorpion ${u.available?.version} is ready. It installs when Scorpion restarts.`;
  if (u.downloading) return `Downloading Scorpion ${u.available?.version}… ${u.progress ?? 0}%`;
  if (u.checking) return 'Looking for a new version…';
  if (u.available) return `Scorpion ${u.available.version} is out (you have ${u.current}).`;
  if (u.lastCheck) return `Scorpion ${u.current} is the newest.`;
  return `Scorpion ${u.current}`;
}

// deps: { version, platform, arch, packaged, portable, getSettings, send(channel, payload),
//         openExternal(url), notify({ title, body, onClick }), fetchJson(url) }
export function createAppUpdates({ version, platform = process.platform, arch = process.arch, packaged, portable, getSettings, send, openExternal, notify, fetchJson }) {
  const supported = packaged && (platform === 'win32' || platform === 'darwin') && !process.env.SCORPION_NO_UPDATES;
  // Windows, installed: Scorpion installs its updates itself.
  const installs = supported && platform === 'win32' && !portable;
  const U = { supported, installs, current: version, checking: false, downloading: false, progress: null, ready: false, available: null, lastCheck: null, error: null };
  const view = () => ({ ...U, line: appUpdateLine(U) });
  const changed = () => send('app:updates', view());
  let updater = null;
  let told = ''; // the version last announced, so each is said once
  let timer = 0;

  async function nsis() {
    if (updater) return updater;
    const mod = await import('electron-updater');
    updater = mod.autoUpdater || mod.default.autoUpdater;
    updater.autoDownload = false; // Scorpion starts the download (check below)
    updater.autoInstallOnAppQuit = true;
    updater.on('download-progress', (p) => { U.progress = Math.round(p.percent || 0); changed(); });
    updater.on('update-downloaded', (info) => {
      U.downloading = false; U.progress = null; U.ready = true;
      U.available = { version: info.version, url: null };
      changed();
      announce(`Scorpion ${info.version} is ready`, 'It installs the next time Scorpion restarts. Click to restart now.', restart);
    });
    updater.on('error', (err) => { U.downloading = false; U.checking = false; U.error = friendly(err); changed(); });
    return updater;
  }

  function announce(title, body, onClick) {
    if (told === title) return;
    told = title;
    notify({ title, body, onClick });
  }

  async function check({ quiet = false } = {}) {
    if (!supported || U.checking || U.downloading) return view();
    U.checking = true; U.error = null; changed();
    try {
      if (installs) {
        const up = await nsis();
        const result = await up.checkForUpdates();
        const info = result?.updateInfo;
        U.lastCheck = Date.now();
        if (info && isNewer(info.version, version)) {
          U.available = { version: info.version, url: null };
          if (!U.ready) {
            U.downloading = true; U.progress = 0;
            // Downloads in the background; 'update-downloaded' says when it's in.
            up.downloadUpdate().catch((err) => { U.downloading = false; U.error = friendly(err); changed(); });
          }
        } else U.available = null;
      } else {
        const release = await fetchJson(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}/releases/latest`);
        U.lastCheck = Date.now();
        const latest = String(release?.tag_name || '').replace(/^v/i, '');
        if (latest && isNewer(latest, version)) {
          U.available = { version: latest, url: pickDownload(release, { platform, arch }) };
          if (quiet) announce(`Scorpion ${latest} is out`, 'Click to download it.', download);
        } else U.available = null;
      }
    } catch (err) {
      // A quiet check offline just tries again later.
      if (!quiet) U.error = friendly(err);
    } finally {
      U.checking = false; changed();
    }
    return view();
  }

  // Windows: quit and install now (Scorpion starts again afterwards).
  function restart() {
    if (!updater || !U.ready) return view();
    setImmediate(() => updater.quitAndInstall(true, true));
    return view();
  }
  // macOS and portable copies: the new version's download, in the browser.
  function download() {
    if (U.available?.url) openExternal(U.available.url);
    return view();
  }

  function start() {
    if (!supported) return;
    clearTimeout(timer);
    const loop = (wait) => { timer = setTimeout(async () => { if (getSettings().appUpdates !== false) await check({ quiet: true }); loop(EVERY); }, wait); };
    loop(FIRST_CHECK);
  }

  return { view, check, restart, download, start };
}

function friendly(err) {
  const m = String(err?.message || err || '');
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET|net::/i.test(m)) return "Couldn't reach GitHub. Check the internet connection.";
  // A release made before Scorpion updated itself has no latest.yml.
  if (/404/.test(m)) return "GitHub's newest release doesn't carry an update for this copy yet.";
  return m.split('\n')[0].slice(0, 160) || 'The update check failed.';
}
