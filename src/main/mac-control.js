// Lets the agent run a Mac for the user: the installed apps, the open windows (focus, minimize, maximize, close), files and
// folders in Finder and the Trash, System Settings panes, and system controls (volume, dark mode, screenshot, lock, sleep,
// restart, shut down). It goes through macOS's own tools (open, osascript, defaults, pmset, screencapture), with every argument
// passed as an argument, never pasted into a script. Same functions as windows-control.js and linux-control.js (system.js).
//
// macOS asks once for what it protects: "Scorpion wants to control System Events" (Automation) to list and act on windows, and
// Accessibility (System Settings → Privacy & Security → Accessibility) to read window titles and press their buttons.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { matchByName, copyPath, ACTIONS, actionRisk } from './windows-control.js';

export { matchByName, copyPath, ACTIONS, actionRisk };
export const supported = process.platform === 'darwin';

let shellActive = false;
export function setShellActive(on) { shellActive = Boolean(on); void shellActive; }
export function setFolderOpener() {}

// A command's output, or the reason it failed.
export function run(cmd, args = [], { timeout = 15000, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim() || err.message));
      else resolve(String(stdout));
    });
    if (input != null) child.stdin.end(input);
  });
}

// AppleScript with arguments (the script is fixed text; what varies goes in argv).
export function osa(lines, argv = [], opts) {
  const args = [];
  for (const l of lines) args.push('-e', l);
  return run('osascript', [...args, ...argv.map(String)], opts);
}

// What macOS says when Scorpion may not control other apps, in words.
export function permissionHint(message) {
  const m = String(message || '');
  if (/not allowed assistive access|assistive|-25211|-1719|-1728/i.test(m)) return 'Scorpion needs Accessibility access to see and control windows: System Settings → Privacy & Security → Accessibility → turn on Scorpion, then try again.';
  if (/not authorized|-1743|Not authorised/i.test(m)) return 'Scorpion needs permission to control System Events: System Settings → Privacy & Security → Automation → Scorpion → turn on System Events, then try again.';
  return null;
}
// Asks macOS to show its Accessibility prompt (once): the one place a user turns Scorpion on.
let asked = false;
async function askAccessibility() {
  if (asked) return;
  asked = true;
  try { (await import('electron')).systemPreferences?.isTrustedAccessibilityClient?.(true); } catch { /* not running inside Electron */ }
}
async function osaChecked(lines, argv, opts) {
  try { return await osa(lines, argv, opts); } catch (err) {
    const hint = permissionHint(err.message);
    if (hint) await askAccessibility();
    throw new Error(hint || err.message);
  }
}

// ---------- apps ----------
const APP_DIRS = ['/Applications', '/System/Applications', '/System/Applications/Utilities', '/Applications/Utilities', path.join(os.homedir(), 'Applications')];

// The .app bundles in some folders, one folder level down too (/Applications/Utilities, vendor folders).
export function scanApps(dirs = APP_DIRS, fsx = fs) {
  const found = new Map();
  const read = (dir, depth) => {
    let entries = [];
    try { entries = fsx.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.name.endsWith('.app')) {
        const name = e.name.slice(0, -4);
        if (!found.has(name.toLowerCase())) found.set(name.toLowerCase(), { name, id: full });
      } else if (depth < 1 && e.isDirectory()) read(full, depth + 1);
    }
  };
  for (const d of dirs) read(d, 0);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

let appCache = { at: 0, apps: [] };
export async function listApps({ fresh = false } = {}) {
  if (!fresh && Date.now() - appCache.at < 5 * 60_000 && appCache.apps.length) return appCache.apps;
  appCache = { at: Date.now(), apps: scanApps() };
  return appCache.apps;
}
export async function openApp(name) {
  const apps = await listApps();
  const { best, others } = matchByName(name, apps);
  if (!best) throw new Error(`No installed app matches "${name}". Use list_apps to see what is installed.`);
  await launchApp(best);
  return { opened: best.name, others: others.map((a) => a.name) };
}
export const appKind = () => 'path';
export async function launchApp(app) {
  await run('open', [app.id], { timeout: 30000 });
}

// ---------- windows ----------
// One row per window of every app that shows in the Dock: pid, app, frontmost, minimized, number, title (tab separated).
const LIST = [
  'tell application "System Events"',
  'set out to ""',
  'repeat with p in (every application process whose background only is false)',
  'set pn to name of p',
  'set pid to unix id of p',
  'set fm to frontmost of p',
  'set wins to {}',
  'try',
  'set wins to windows of p',
  'end try',
  'set i to 0',
  'repeat with w in wins',
  'set i to i + 1',
  'set t to ""',
  'try',
  'set t to name of w',
  'end try',
  'set mn to false',
  'try',
  'set mn to value of attribute "AXMinimized" of w',
  'end try',
  'set out to out & pid & tab & pn & tab & fm & tab & mn & tab & i & tab & t & linefeed',
  'end repeat',
  'end repeat',
  'return out',
  'end tell',
];

// The rows above, as windows. hwnd is "pid:number": what window actions take back.
// exeOf: the app bundle of a pid (its icon and "pinned" come from it).
export function parseWindows(out, exeOf = new Map()) {
  const rows = String(out || '').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
  return rows.map(([pid, proc, fm, mn, idx, ...title]) => ({
    hwnd: `${pid}:${idx}`,
    pid: Number(pid),
    process: proc,
    title: title.join('\t') || proc,
    active: fm === 'true' && Number(idx) === 1,
    minimized: mn === 'true',
    exe: exeOf.get(Number(pid)) || null,
  })).filter((w) => w.pid && w.process);
}
// pid -> the .app bundle it runs from, out of `ps -axo pid=,comm=` lines.
export function parseBundles(out) {
  const map = new Map();
  for (const l of String(out || '').split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.*?\.app)(?:\/|$)/.exec(l);
    if (m) map.set(Number(m[1]), m[2]);
  }
  return map;
}
export async function listWindows() {
  const [out, ps] = await Promise.all([osaChecked(LIST, [], { timeout: 20000 }), run('ps', ['-axo', 'pid=,comm=']).catch(() => '')]);
  return parseWindows(out, parseBundles(ps));
}
export function fromHandle(h) {
  const m = /^(\d+):(\d+)$/.exec(String(h));
  return m ? { pid: Number(m[1]), index: Number(m[2]) } : null;
}

// One window: bring it forward, minimize, restore, zoom (the green button) or close (the red one, which may ask to save).
const ACT = [
  'on run argv',
  'set thePid to (item 1 of argv) as integer',
  'set idx to (item 2 of argv) as integer',
  'set what to item 3 of argv',
  'tell application "System Events"',
  'set p to first process whose unix id is thePid',
  'if what is "focus" then',
  'set frontmost of p to true',
  'try',
  'set value of attribute "AXMinimized" of window idx of p to false',
  'end try',
  'try',
  'perform action "AXRaise" of window idx of p',
  'end try',
  'else if what is "minimize" then',
  'set value of attribute "AXMinimized" of window idx of p to true',
  'else if what is "restore" then',
  'set value of attribute "AXMinimized" of window idx of p to false',
  'set frontmost of p to true',
  'else if what is "maximize" then',
  'set frontmost of p to true',
  'click (first button of window idx of p whose subrole is "AXZoomButton")',
  'else if what is "close" then',
  'click (first button of window idx of p whose subrole is "AXCloseButton")',
  'end if',
  'end tell',
  'end run',
];
const ACTIONS_OK = ['focus', 'minimize', 'restore', 'maximize', 'close'];
export async function windowByHandle(hwnd, action) {
  const h = fromHandle(hwnd);
  if (!h) throw new Error('Unknown window');
  if (!ACTIONS_OK.includes(action)) throw new Error('Unknown window action');
  await osaChecked(ACT, [h.pid, h.index, action], { timeout: 15000 });
  return '';
}

async function findWindow(target) {
  const wins = await listWindows();
  const { best, others } = matchByName(target, wins, (w) => `${w.title} ${w.process}`);
  if (!best) throw new Error(`No open window matches "${target}". Open windows: ${wins.map((w) => w.title).slice(0, 15).join(' | ') || 'none'}`);
  return { win: best, others };
}
export async function windowAction(target, action = 'focus') {
  if (!ACTIONS_OK.slice(0, 4).includes(action)) throw new Error('action must be focus, minimize, maximize or restore');
  const { win } = await findWindow(target);
  await windowByHandle(win.hwnd, action);
  return win;
}
// The red close button of the window: the app can still ask to save. Nothing is force-quit.
export async function closeApp(target) {
  const { win } = await findWindow(target);
  await windowByHandle(win.hwnd, 'close');
  return { ...win, asked: true };
}

// End task: the app's program, by one of its windows (a polite quit first is the window's close; this one stops it).
const KEEP_RUNNING = new Set(['finder', 'dock', 'windowserver', 'loginwindow', 'systemuiserver', 'controlcenter', 'notificationcenter', 'spotlight']);
export async function endTaskTarget(hwnd, { ownPids = [] } = {}) {
  const h = fromHandle(hwnd);
  if (!h) throw new Error("Couldn't find that app's program.");
  if (ownPids.includes(h.pid)) throw new Error("That's Scorpion itself: quit it from its own menu instead.");
  const name = (await run('ps', ['-p', String(h.pid), '-o', 'comm='])).trim().split('/').pop() || '';
  if (/^scorpion$/i.test(name)) throw new Error("That's Scorpion itself: quit it from its own menu instead.");
  if (KEEP_RUNNING.has(name.toLowerCase())) throw new Error(`${name} is part of macOS and can't be ended here.`);
  return { pid: h.pid, name };
}
export async function endTask(hwnd, opts) {
  const { pid, name } = await endTaskTarget(hwnd, opts);
  process.kill(pid, 'SIGKILL');
  return name;
}

// ---------- files and folders ----------
const RUNNABLE = new Set(['.app', '.command', '.sh', '.pkg', '.mpkg', '.dmg', '.scpt', '.workflow', '.jar', '.terminal', '.tool', '.py', '.pl', '.rb']);
export const isRunnable = (p) => RUNNABLE.has(path.extname(String(p)).toLowerCase());
export function openPath(p, { reveal = false } = {}) {
  return new Promise((resolve) => execFile('open', reveal ? ['-R', p] : [p], () => resolve(p)));
}
export async function recyclePath(p) {
  await osa(['on run argv', 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', 'end run'], [p], { timeout: 120000 });
}

// ---------- System Settings ----------
const PANE = (id) => `x-apple.systempreferences:${id}`;
export const SETTINGS_PAGES = {
  home: '', display: 'com.apple.Displays-Settings.extension', sound: 'com.apple.Sound-Settings.extension', notifications: 'com.apple.Notifications-Settings.extension',
  power: 'com.apple.Battery-Settings.extension', battery: 'com.apple.Battery-Settings.extension', storage: 'com.apple.settings.Storage', bluetooth: 'com.apple.BluetoothSettings',
  network: 'com.apple.Network-Settings.extension', wifi: 'com.apple.wifi-settings-extension', vpn: 'com.apple.Network-Settings.extension', keyboard: 'com.apple.Keyboard-Settings.extension',
  mouse: 'com.apple.Mouse-Settings.extension', trackpad: 'com.apple.Trackpad-Settings.extension', printers: 'com.apple.Print-Scan-Settings.extension',
  appearance: 'com.apple.Appearance-Settings.extension', wallpaper: 'com.apple.Wallpaper-Settings.extension', lockscreen: 'com.apple.Lock-Screen-Settings.extension',
  dock: 'com.apple.Desktop-Settings.extension', accounts: 'com.apple.Users-Groups-Settings.extension', passwords: 'com.apple.Passwords-Settings.extension',
  time: 'com.apple.Date-Time-Settings.extension', language: 'com.apple.Localization-Settings.extension', accessibility: 'com.apple.Accessibility-Settings.extension',
  privacy: 'com.apple.settings.PrivacySecurity.extension', security: 'com.apple.settings.PrivacySecurity.extension', camera: 'com.apple.settings.PrivacySecurity.extension?Privacy_Camera',
  microphone: 'com.apple.settings.PrivacySecurity.extension?Privacy_Microphone', location: 'com.apple.settings.PrivacySecurity.extension?Privacy_LocationServices',
  update: 'com.apple.Software-Update-Settings.extension', general: 'com.apple.systempreferences.GeneralSettings', about: 'com.apple.SystemProfiler.AboutExtension',
  startup: 'com.apple.LoginItems-Settings.extension', sharing: 'com.apple.Sharing-Settings.extension', focus: 'com.apple.Focus-Settings.extension',
};
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function openSettings(page = 'home') {
  const key = norm(page).replace(/ /g, '');
  const found = SETTINGS_PAGES[key] ?? Object.entries(SETTINGS_PAGES).find(([k]) => k.startsWith(key) || key.startsWith(k))?.[1];
  if (found === undefined) throw new Error(`Unknown Settings page "${page}". Pages: ${Object.keys(SETTINGS_PAGES).join(', ')}`);
  return new Promise((resolve) => (found ? execFile('open', [PANE(found)], () => resolve(found)) : execFile('open', ['-a', 'System Settings'], () => resolve('home'))));
}

// ---------- system controls ----------
export const parseVolume = (out) => {
  const n = Number(String(out).trim());
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
};
const getVolume = async () => parseVolume(await osa(['output volume of (get volume settings)']));
const setVolume = (n) => osa([`set volume output volume ${Math.max(0, Math.min(100, Math.round(n)))}`]);

export async function systemControl(action, amount) {
  if (!ACTIONS.includes(action)) throw new Error(`Unknown action. Use one of: ${ACTIONS.join(', ')}`);
  switch (action) {
    case 'volume_up': case 'volume_down': {
      const step = Math.max(1, Math.min(100, Math.round(Number(amount) || 10)));
      const now = (await getVolume()) ?? 50;
      const next = Math.max(0, Math.min(100, now + (action === 'volume_up' ? step : -step)));
      await setVolume(next);
      return `Volume ${action === 'volume_up' ? 'up' : 'down'}: now ${next}%.`;
    }
    case 'set_volume': {
      const level = Math.max(0, Math.min(100, Math.round(Number(amount) || 0)));
      await setVolume(level);
      return `Volume set to ${level}%.`;
    }
    case 'mute': {
      const muted = (await osa(['output muted of (get volume settings)'])).trim() === 'true';
      await osa([`set volume output muted ${muted ? 'false' : 'true'}`]);
      return muted ? 'Sound on.' : 'Muted.';
    }
    case 'play_pause': case 'next_track': case 'previous_track': {
      // The Music app, or Spotify, whichever is open.
      const verb = { play_pause: 'playpause', next_track: 'next track', previous_track: 'previous track' }[action];
      for (const app of ['Spotify', 'Music']) {
        const open = (await osa(['on run argv', 'tell application "System Events" to return (name of processes) contains (item 1 of argv)', 'end run'], [app]).catch(() => 'false')).trim() === 'true';
        if (open) { await osa([`tell application "${app}" to ${verb}`]); return `Done (${action.replace('_', ' ')}, ${app}).`; }
      }
      throw new Error('Open Music or Spotify first: Scorpion controls playback through them.');
    }
    case 'brightness':
      throw new Error("A Mac's screen brightness can't be set from outside its own keys and Control Center.");
    case 'dark_mode': case 'light_mode': {
      await osa(['on run argv', 'tell application "System Events" to tell appearance preferences to set dark mode to ((item 1 of argv) is "dark")', 'end run'], [action === 'dark_mode' ? 'dark' : 'light']);
      return `The Mac is now in ${action === 'light_mode' ? 'light' : 'dark'} mode.`;
    }
    case 'screenshot': {
      const dir = path.join(os.homedir(), 'Pictures', 'Screenshots');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `Scorpion ${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.png`);
      await run('screencapture', ['-x', file], { timeout: 30000 });
      return `Screenshot saved: ${file}`;
    }
    case 'lock': await run('pmset', ['displaysleepnow']); return 'Locked.';
    case 'sleep': await run('pmset', ['sleepnow']); return 'Going to sleep.';
    case 'restart': await osa(['tell application "System Events" to restart']); return 'Restarting.';
    case 'shutdown': await osa(['tell application "System Events" to shut down']); return 'Shutting down.';
    case 'cancel_shutdown': await osa(['tell application "System Events" to key code 53']).catch(() => {}); return 'Cancelled (if a restart or shut down was still waiting).';
    case 'empty_recycle_bin': await osa(['tell application "Finder" to empty trash']); return 'Trash emptied.';
    default: throw new Error('Unknown action');
  }
}

// ---------- system info ----------
export function parseBattery(out) {
  const m = /(\d+)%;\s*(charging|discharging|charged|finishing charge|AC attached)/i.exec(String(out));
  if (!m) return null;
  return { percent: Number(m[1]), charging: /^(charging|charged|finishing charge|AC attached)$/i.test(m[2]) };
}
export async function trayStatus() {
  const [batt, net] = await Promise.all([
    run('pmset', ['-g', 'batt']).then(parseBattery).catch(() => null),
    run('networksetup', ['-getairportnetwork', 'en0']).then((s) => /Current Wi-Fi Network:\s*(.+)/.exec(s)?.[1]?.trim() || null).catch(() => null),
  ]);
  return { battery: batt ? batt.percent : null, charging: batt ? batt.charging : false, network: net };
}
export async function systemInfo() {
  const ver = (await run('sw_vers', ['-productVersion']).catch(() => '')).trim();
  const batt = parseBattery(await run('pmset', ['-g', 'batt']).catch(() => ''));
  const df = (await run('df', ['-k', '/']).catch(() => '')).split('\n')[1]?.trim().split(/\s+/) || [];
  const top = (await run('ps', ['-Aceo', 'rss=,comm=', '-r']).catch(() => '')).split('\n').filter(Boolean).slice(0, 6).map((l) => { const m = /^\s*(\d+)\s+(.+)$/.exec(l); return m ? `${m[2]} ${Math.round(Number(m[1]) / 1024)} MB` : l.trim(); });
  const nets = Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list || []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => `${name} ${a.address}`));
  return {
    os: `macOS ${ver}`.trim(), uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
    cpu: os.cpus()[0]?.model || 'unknown', cpuLoad: Math.min(100, Math.round((os.loadavg()[0] / Math.max(1, os.cpus().length)) * 100)),
    ramGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10, ramFreeGB: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
    disks: df.length > 3 ? [`/ ${Math.round(Number(df[3]) / 1024 ** 2)} GB free of ${Math.round(Number(df[1]) / 1024 ** 2)} GB`] : [],
    battery: batt ? `${batt.percent}% ${batt.charging ? 'charging' : 'on battery'}` : 'none',
    network: nets, topApps: top,
  };
}

// ---------- defaults, names ----------
export async function defaultApp() { return null; }
export async function programName(p) { return path.basename(String(p), path.extname(String(p))); }
export const iconForApp = async () => null;
export const signOut = () => osa(['tell application "System Events" to log out']).catch(() => {});
export const powerNow = (action) => osa([`tell application "System Events" to ${action === 'restart' ? 'restart' : 'shut down'}`]);
export async function volumeStep(action) {
  const now = (await getVolume()) ?? 50;
  if (action === 'mute') return systemControl('mute');
  return setVolume(now + (action === 'up' ? 6 : -6));
}
export async function recentOpened() { return []; }
export async function textScale() {}
export const screenReader = (on) => osa([`tell application "System Events" to key code 96 using {command down}`]).catch(() => {}).then(() => on);
export const onScreenKeyboard = async () => {};
