// Scorpion's system layer on Linux (Scorpion OS, or any Wayland desktop with
// the same tools): the counterpart of windows-control.js, with the same
// functions. Apps are the freedesktop .desktop entries; windows come from the
// Wayland foreign-toplevel protocol (lswt lists them, wlrctl acts on them);
// sound is PipeWire (wpctl), media keys MPRIS (playerctl), brightness
// brightnessctl, network NetworkManager (nmcli), battery the kernel's
// power_supply class, power and sign-out systemd-logind. Programs are run with
// argument lists, never through a shell.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { matchByName, isRunnable as winRunnable, copyPath, ACTIONS, actionRisk } from './windows-control.js';

export { matchByName, copyPath, ACTIONS, actionRisk };
export const supported = process.platform === 'linux';

let shellActive = false;
let folderOpener = null;
export function setShellActive(on) { shellActive = Boolean(on); }
export function setFolderOpener(fn) { folderOpener = fn; }

// PowerShell exists only on Windows; these are here so a stray call says so.
const noPs = () => Promise.reject(new Error('PowerShell is not available on Linux.'));
export const psQuote = (s) => String(s ?? '');
export const runPs = noPs;
export const runPsKept = noPs;
export function stopPsKept() {}

// A program's output (trimmed), with its arguments as a list.
export function run(cmd, args = [], { timeout = 15000, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      if (err) reject(new Error(err.code === 'ENOENT' ? `${cmd} is not installed.` : String(stderr || err.message).trim().split('\n')[0] || `${cmd} failed`));
      else resolve(String(stdout).trim());
    });
    if (input !== undefined) child.stdin.end(input);
  });
}
// Started and left running (apps), not waited for.
function detach(cmd, args = [], { cwd } = {}) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(), env: process.env });
  child.on('error', () => {});
  child.unref();
  return child.pid;
}

// ---------- .desktop entries ----------
// The [Desktop Entry] group of a .desktop file as key → value (unlocalized
// keys only; escapes \s \n \t \\ undone).
export function parseDesktopEntry(text) {
  const out = {};
  let inEntry = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) { inEntry = line === '[Desktop Entry]'; continue; }
    if (!inEntry) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (key.includes('[')) continue;
    out[key] = line.slice(eq + 1).trim().replace(/\\([sntr\\])/g, (_, c) => ({ s: ' ', n: '\n', t: '\t', r: '\r', '\\': '\\' })[c]);
  }
  return out;
}

// The Exec line as a list of arguments, without the field codes (%f, %U…).
export function parseExec(exec) {
  const args = [];
  let cur = '';
  let quoted = false;
  let has = false;
  const s = String(exec || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '\\' && i + 1 < s.length) { cur += s[++i]; continue; }
      if (c === '"') { quoted = false; continue; }
      cur += c;
    } else if (c === '"') { quoted = true; has = true; }
    else if (c === ' ' || c === '\t') { if (has || cur) args.push(cur); cur = ''; has = false; }
    else cur += c;
  }
  if (has || cur) args.push(cur);
  return args
    .filter((a) => !/^%[fFuUdDnNickvm]$/.test(a))
    .map((a) => a.replace(/%%/g, '%').replace(/%[fFuUdDnNickvm]/g, ''))
    .filter((a) => a !== '');
}

const desktops = () => String(process.env.XDG_CURRENT_DESKTOP || 'Scorpion').split(':').map((d) => d.toLowerCase());
// Whether an entry belongs in the app list here.
export function showsHere(entry, current = desktops()) {
  if (entry.Type && entry.Type !== 'Application') return false;
  if (entry.NoDisplay === 'true' || entry.Hidden === 'true' || !entry.Name || !entry.Exec) return false;
  const list = (v) => String(v || '').split(';').map((d) => d.trim().toLowerCase()).filter(Boolean);
  const only = list(entry.OnlyShowIn);
  if (only.length && !only.some((d) => current.includes(d))) return false;
  if (list(entry.NotShowIn).some((d) => current.includes(d))) return false;
  return true;
}

const dataDirs = () => {
  const home = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  const sys = String(process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean);
  return [home, ...sys, '/var/lib/snapd/desktop', '/var/lib/flatpak/exports/share', path.join(os.homedir(), '.local/share/flatpak/exports/share')];
};
// Every .desktop file by its id (applications/foo/bar.desktop is foo-bar.desktop);
// the first data folder wins, as the spec says.
function desktopFiles() {
  const found = new Map();
  for (const base of dataDirs()) {
    const root = path.join(base, 'applications');
    const walk = (dir, prefix) => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}-`);
        else if (e.name.endsWith('.desktop') && !found.has(prefix + e.name)) found.set(prefix + e.name, path.join(dir, e.name));
      }
    };
    walk(root, '');
  }
  return found;
}

// ---------- apps ----------
let appCache = { at: 0, apps: [] };
export async function listApps({ fresh = false } = {}) {
  if (!fresh && Date.now() - appCache.at < 5 * 60_000 && appCache.apps.length) return appCache.apps;
  const apps = [];
  for (const [id, file] of desktopFiles()) {
    let entry;
    try { entry = parseDesktopEntry(fs.readFileSync(file, 'utf8')); } catch { continue; }
    if (!showsHere(entry)) continue;
    if (/^scorpion/i.test(id)) continue; // Scorpion itself
    apps.push({ id, name: entry.Name, icon: entry.Icon || null, exec: entry.Exec, wmClass: entry.StartupWMClass || null });
  }
  apps.sort((a, b) => a.name.localeCompare(b.name));
  appCache = { at: Date.now(), apps };
  return apps;
}
const appById = async (id) => (await listApps()).find((a) => a.id === id) || null;

export async function openApp(name) {
  const apps = await listApps();
  const { best, others } = matchByName(name, apps);
  if (!best) throw new Error(`No installed app matches "${name}". Use list_apps to see what is installed.`);
  await launchApp(best);
  return { opened: best.name, others: others.map((a) => a.name) };
}

export function appKind(id) {
  if (String(id).endsWith('.desktop')) return 'desktop';
  if (String(id).startsWith('/')) return 'path';
  return 'command';
}

// An app by its .desktop id, a program's path, or a command name.
export async function launchApp(app) {
  const kind = appKind(app.id);
  if (kind === 'path') {
    if (app.id.endsWith('.desktop')) return launchEntry(parseDesktopEntry(fs.readFileSync(app.id, 'utf8')));
    detach(app.id, [], { cwd: path.dirname(app.id) });
    return 'ok';
  }
  if (kind === 'desktop') {
    const file = desktopFiles().get(app.id);
    if (!file) throw new Error(`${app.name || app.id} is not installed.`);
    return launchEntry(parseDesktopEntry(fs.readFileSync(file, 'utf8')));
  }
  detach(app.id);
  return 'ok';
}
function launchEntry(entry) {
  const argv = parseExec(entry.Exec);
  if (!argv.length) throw new Error(`${entry.Name || 'That app'} has no program to start.`);
  if (entry.Terminal === 'true') argv.unshift('x-terminal-emulator', '-e');
  detach(argv[0], argv.slice(1), { cwd: entry.Path });
  return 'ok';
}

// ---------- icons ----------
const ICON_THEMES = ['Yaru', 'Papirus', 'Adwaita', 'hicolor', 'breeze', 'gnome'];
const ICON_SIZES = ['scalable', '256x256', '128x128', '96x96', '64x64', '48x48', '32x32'];
// The file for an icon name, from the usual themes (largest first) or pixmaps.
export function iconPath(name) {
  if (!name) return null;
  if (name.startsWith('/')) return fs.existsSync(name) ? name : null;
  const bases = [...dataDirs().map((d) => path.join(d, 'icons')), path.join(os.homedir(), '.icons')];
  for (const base of bases) {
    for (const theme of ICON_THEMES) {
      for (const size of ICON_SIZES) {
        for (const ext of ['svg', 'png']) {
          const p = path.join(base, theme, size, 'apps', `${name}.${ext}`);
          if (fs.existsSync(p)) return p;
        }
      }
    }
  }
  for (const ext of ['svg', 'png']) {
    const p = path.join('/usr/share/pixmaps', `${name}.${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
const iconCache = new Map();
// An icon as a data URL (what Scorpion's screens show).
export function iconData(name) {
  if (iconCache.has(name)) return iconCache.get(name);
  let url = null;
  const p = iconPath(name);
  if (p) {
    try {
      const buf = fs.readFileSync(p);
      if (buf.length < 512 * 1024) url = `data:${p.endsWith('.svg') ? 'image/svg+xml' : 'image/png'};base64,${buf.toString('base64')}`;
    } catch { /* unreadable */ }
  }
  iconCache.set(name, url);
  return url;
}
// Every app's icon by its id (the Apps screen and pinned apps).
export async function appIcons() {
  const out = {};
  for (const a of await listApps()) { const url = iconData(a.icon); if (url) out[a.id] = url; }
  return out;
}
// A window's or program's icon: its app's (by .desktop id or app id).
export async function iconForApp(id) {
  if (!id) return null;
  const app = await appForAppId(id);
  return app ? iconData(app.icon) : iconData(id);
}

// ---------- windows ----------
// The window list from lswt's JSON (versions 1 and 2): title, app id and state.
export function parseToplevels(json) {
  let data;
  try { data = JSON.parse(json); } catch { return []; }
  const list = Array.isArray(data) ? data : data?.toplevels || [];
  return list.map((t) => {
    const state = Array.isArray(t.state) ? t.state : [];
    const flag = (k) => t[k] === true || state.includes(k);
    return { title: String(t.title ?? ''), appId: String(t['app-id'] ?? t.app_id ?? t.appId ?? ''), active: flag('activated'), minimized: flag('minimized'), id: t.identifier ?? null };
  }).filter((t) => t.title || t.appId);
}
// A window's handle: its app id and title (Wayland has no shared window ids).
export const handleOf = (t) => Buffer.from(JSON.stringify([t.appId, t.title])).toString('base64url');
export function fromHandle(h) {
  try { const [appId, title] = JSON.parse(Buffer.from(String(h), 'base64url').toString('utf8')); return { appId, title }; } catch { return null; }
}

// The app behind a window's app id ("firefox", "org.gnome.TextEditor").
async function appForAppId(appId) {
  const apps = await listApps();
  const want = String(appId).toLowerCase();
  return apps.find((a) => a.id.toLowerCase() === `${want}.desktop`)
    || apps.find((a) => (a.wmClass || '').toLowerCase() === want)
    || apps.find((a) => a.id.toLowerCase().endsWith(`_${want}.desktop`) || a.id.toLowerCase().endsWith(`-${want}.desktop`))
    || apps.find((a) => parseExec(a.exec)[0]?.split('/').pop().toLowerCase() === want)
    || null;
}

export async function listWindows() {
  const tops = parseToplevels(await run('lswt', ['-j']));
  const wins = [];
  for (const t of tops) {
    if (/^Scorpion (taskbar|summon)$/.test(t.title)) continue;
    const app = await appForAppId(t.appId);
    wins.push({ hwnd: handleOf(t), pid: 0, process: app?.name || t.appId, title: t.title || app?.name || t.appId, active: t.active, exe: app?.id || t.appId || null, appId: t.appId });
  }
  return wins;
}

// wlrctl picks a window by app id and title.
const matchArgs = ({ appId, title }) => [...(appId ? [`app_id:${appId}`] : []), ...(title ? [`title:${title}`] : [])];
async function toplevel(action, w) {
  const args = matchArgs(w);
  if (!args.length) throw new Error('Unknown window');
  await run('wlrctl', ['toplevel', action, ...args]);
}

async function findWindow(target) {
  const wins = await listWindows();
  const { best, others } = matchByName(target, wins, (w) => `${w.title} ${w.process}`);
  if (!best) throw new Error(`No open window matches "${target}". Open windows: ${wins.map((w) => w.title).slice(0, 15).join(' | ') || 'none'}`);
  return { win: best, others };
}

const WLR_ACTION = { focus: 'focus', minimize: 'minimize', maximize: 'maximize', restore: 'focus' };
export async function windowAction(target, action = 'focus') {
  if (!WLR_ACTION[action]) throw new Error('action must be focus, minimize, maximize or restore');
  const { win } = await findWindow(target);
  await toplevel(WLR_ACTION[action], fromHandle(win.hwnd));
  return win;
}
// Closes a window the way its X button does: the app can still ask to save.
export async function closeApp(target) {
  const { win } = await findWindow(target);
  await toplevel('close', fromHandle(win.hwnd));
  return { ...win, asked: true };
}
export async function windowByHandle(hwnd, action) {
  const w = fromHandle(hwnd);
  if (!w) throw new Error('Unknown window');
  if (action === 'focus' || action === 'minimize' || action === 'close') return toplevel(action, w);
  throw new Error('Unknown window action');
}

// End task: force-quit the program behind a window (unsaved work is lost).
// Wayland doesn't say which process owns a window, so the app's program is
// found by name among this user's processes. Scorpion and the session's own
// parts are never ended.
const KEEP_RUNNING = new Set(['labwc', 'scorpion', 'systemd', 'pipewire', 'wireplumber', 'dbus-daemon', 'xwayland', 'lightdm', 'mako', 'polkit-gnome-authentication-agent-1']);
export async function endTaskTarget(hwnd, { ownPids = [] } = {}) {
  const w = fromHandle(hwnd);
  const app = w && (await appForAppId(w.appId));
  const prog = (app ? parseExec(app.exec)[0] : w?.appId || '').split('/').pop();
  if (!prog) throw new Error("Couldn't find that app's program.");
  if (KEEP_RUNNING.has(prog.toLowerCase())) throw new Error(`${prog} is part of the system and can't be ended here.`);
  const out = await run('pgrep', ['-u', String(os.userInfo().uid), '-x', prog.slice(0, 15)]).catch(() => '');
  const pids = out.split('\n').map(Number).filter((p) => p && !ownPids.includes(p));
  if (!pids.length) throw new Error(`${prog} isn't running as its own program.`);
  return { pid: pids[0], pids, name: prog };
}
export async function endTask(hwnd, opts) {
  const { pids, name } = await endTaskTarget(hwnd, opts);
  for (const p of pids) { try { process.kill(p, 'SIGKILL'); } catch { /* already gone */ } }
  return name;
}

// ---------- files and folders ----------
const RUNNABLE = new Set(['.sh', '.run', '.bin', '.appimage', '.desktop', '.py', '.pl', '.deb', '.rpm', '.snap', '.flatpakref']);
export const isRunnable = (p) => winRunnable(p) || RUNNABLE.has(path.extname(String(p)).toLowerCase());

export async function openPath(p, { reveal = false } = {}) {
  if (!fs.existsSync(p)) throw new Error(`${p} does not exist`);
  const isDir = fs.statSync(p).isDirectory();
  if (shellActive && folderOpener && (isDir || reveal)) return folderOpener(isDir ? p : path.dirname(p), isDir ? null : p);
  detach('xdg-open', [reveal && !isDir ? path.dirname(p) : p]);
  return p;
}
// To the Trash (restorable), never a permanent delete.
export async function recyclePath(p) {
  if (!fs.existsSync(p)) throw new Error(`${p} does not exist`);
  const dir = fs.statSync(p).isDirectory();
  await run('gio', ['trash', '--', p], { timeout: 120000 });
  return { recycled: p, folder: dir };
}

// ---------- settings ----------
// Scorpion OS's settings are small dedicated tools, one per area.
export const SETTINGS_PAGES = {
  home: ['nm-connection-editor'], network: ['nm-connection-editor'], wifi: ['nm-connection-editor'], vpn: ['nm-connection-editor'],
  sound: ['pavucontrol'], microphone: ['pavucontrol'], bluetooth: ['blueman-manager'], display: ['wdisplays'], nightlight: ['wdisplays'],
  printers: ['system-config-printer'], apps: ['gnome-software'], update: ['update-manager'], storage: ['gnome-disks'],
  about: ['gnome-system-monitor'], power: ['gnome-system-monitor', '--show-resources-tab'],
};
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export function openSettings(page = 'home') {
  const key = norm(page);
  const hit = SETTINGS_PAGES[key] ? key : Object.keys(SETTINGS_PAGES).find((k) => k.startsWith(key) || key.startsWith(k));
  if (!hit) throw new Error(`Settings page "${page}" isn't available on this system. Pages: ${Object.keys(SETTINGS_PAGES).join(', ')}`);
  const [cmd, ...args] = SETTINGS_PAGES[hit];
  detach(cmd, args);
  return Promise.resolve(hit);
}

// ---------- system controls ----------
// Restart and shut down wait 30 seconds, so they can still be cancelled.
let pendingPower = null;
const SINK = '@DEFAULT_AUDIO_SINK@';
export async function systemControl(action, amount) {
  if (!ACTIONS.includes(action)) throw new Error(`Unknown action. Use one of: ${ACTIONS.join(', ')}`);
  switch (action) {
    case 'volume_up': case 'volume_down': {
      const step = Math.max(1, Math.min(100, Math.round(Number(amount) || 10)));
      await run('wpctl', ['set-volume', '-l', '1.0', SINK, `${step}%${action === 'volume_up' ? '+' : '-'}`]);
      return `Volume ${action === 'volume_up' ? 'up' : 'down'} ${step}%.`;
    }
    case 'set_volume': {
      const level = Math.max(0, Math.min(100, Math.round(Number(amount) || 0)));
      await run('wpctl', ['set-volume', SINK, (level / 100).toFixed(2)]);
      return `Volume set to ${level}%.`;
    }
    case 'mute': await run('wpctl', ['set-mute', SINK, 'toggle']); return 'Done (mute).';
    case 'play_pause': await run('playerctl', ['play-pause']); return 'Done (play pause).';
    case 'next_track': await run('playerctl', ['next']); return 'Done (next track).';
    case 'previous_track': await run('playerctl', ['previous']); return 'Done (previous track).';
    case 'brightness': {
      const level = Math.max(5, Math.min(100, Math.round(Number(amount) || 50)));
      await run('brightnessctl', ['set', `${level}%`]).catch(() => { throw new Error("This screen's brightness can't be changed from here (usual for desktop monitors)."); });
      return `Brightness set to ${level}%.`;
    }
    case 'dark_mode': case 'light_mode': {
      const dark = action === 'dark_mode';
      await run('gsettings', ['set', 'org.gnome.desktop.interface', 'color-scheme', dark ? 'prefer-dark' : 'default']);
      await run('gsettings', ['set', 'org.gnome.desktop.interface', 'gtk-theme', dark ? 'Yaru-dark' : 'Yaru']).catch(() => {});
      return `Now in ${dark ? 'dark' : 'light'} mode.`;
    }
    case 'screenshot': {
      const dir = path.join(os.homedir(), 'Pictures', 'Screenshots');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `Scorpion ${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.png`);
      await run('grim', [file]);
      return `Screenshot saved: ${file}`;
    }
    case 'lock': detach('swaylock', ['-f', '-c', '000000']); return 'Locked.';
    case 'sleep': await run('systemctl', ['suspend']); return 'Going to sleep.';
    case 'restart': case 'shutdown': {
      clearTimeout(pendingPower);
      pendingPower = setTimeout(() => { pendingPower = null; powerNow(action).catch(() => {}); }, 30_000);
      return `${action === 'restart' ? 'Restarting' : 'Shutting down'} in 30 seconds. Say "cancel the ${action}" to stop it.`;
    }
    case 'cancel_shutdown': clearTimeout(pendingPower); pendingPower = null; return 'Cancelled.';
    case 'empty_recycle_bin': await run('gio', ['trash', '--empty']); return 'Trash emptied.';
    default: throw new Error('Unknown action');
  }
}
// The power menu: right away.
export function powerNow(action) {
  if (action === 'restart') return run('systemctl', ['reboot']);
  if (action === 'shutdown') return run('systemctl', ['poweroff']);
  throw new Error('Unknown power action');
}
export const signOut = () => run('loginctl', ['terminate-session', process.env.XDG_SESSION_ID || 'self']).catch(() => run('labwc', ['--exit']));
// The taskbar's volume button and wheel.
export function volumeStep(action) {
  if (action === 'up' || action === 'down') return systemControl(action === 'up' ? 'volume_up' : 'volume_down', 2);
  return systemControl('mute');
}

// ---------- status and system info ----------
// Battery from the kernel's power_supply class: "87" and "Charging".
export function parseBattery(capacity, status) {
  const pct = Number.parseInt(capacity, 10);
  return Number.isFinite(pct) ? { battery: pct, charging: /^(charging|full)$/i.test(String(status).trim()) } : { battery: null, charging: false };
}
function readBattery() {
  const base = '/sys/class/power_supply';
  let names = [];
  try { names = fs.readdirSync(base); } catch { return { battery: null, charging: false }; }
  for (const n of names) {
    const dir = path.join(base, n);
    try {
      if (fs.readFileSync(path.join(dir, 'type'), 'utf8').trim() !== 'Battery') continue;
      return parseBattery(fs.readFileSync(path.join(dir, 'capacity'), 'utf8'), fs.readFileSync(path.join(dir, 'status'), 'utf8'));
    } catch { /* not a readable battery */ }
  }
  return { battery: null, charging: false };
}
// nmcli -t -f NAME,TYPE,DEVICE connection show --active: the first real one.
export function parseActiveConnection(out) {
  for (const line of String(out).split('\n')) {
    const [name, type] = line.split(/(?<!\\):/).map((s) => s.replace(/\\:/g, ':'));
    if (name && type && !/loopback|bridge/.test(type)) return name;
  }
  return null;
}
export async function trayStatus() {
  const network = parseActiveConnection(await run('nmcli', ['-t', '-f', 'NAME,TYPE,DEVICE', 'connection', 'show', '--active']).catch(() => ''));
  return { ...readBattery(), network };
}

export async function systemInfo() {
  const rel = (() => { try { return fs.readFileSync('/etc/os-release', 'utf8'); } catch { return ''; } })();
  const pretty = /^PRETTY_NAME="?([^"\n]*)"?/m.exec(rel)?.[1] || `${os.type()} ${os.release()}`;
  const df = await run('df', ['-B1', '--output=target,avail,size', '-x', 'tmpfs', '-x', 'devtmpfs', '-x', 'squashfs', '-x', 'overlay', '-x', 'efivarfs']).catch(() => '');
  const disks = df.split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length === 3)
    .map(([target, avail, size]) => `${target} ${Math.round(avail / 1e9)} GB free of ${Math.round(size / 1e9)} GB`);
  const ps = await run('ps', ['-eo', 'comm,rss', '--sort=-rss', '--no-headers']).catch(() => '');
  const bat = readBattery();
  return {
    os: `${pretty} (Linux ${os.release()})`, uptimeHours: Math.round(os.uptime() / 360) / 10,
    cpu: os.cpus()[0]?.model || 'unknown', cpuLoad: Math.round((os.loadavg()[0] / Math.max(1, os.cpus().length)) * 100),
    ramGB: Math.round(os.totalmem() / 1e8) / 10, ramFreeGB: Math.round(os.freemem() / 1e8) / 10,
    disks,
    battery: bat.battery == null ? 'none' : `${bat.battery}% ${bat.charging ? 'charging' : 'on battery'}`,
    network: Object.entries(os.networkInterfaces()).flatMap(([n, list]) => list.filter((a) => a.family === 'IPv4' && !a.internal).map((a) => `${n}: ${a.address}`)),
    topApps: ps.split('\n').slice(0, 6).map((l) => l.trim().split(/\s+/)).filter((c) => c.length === 2).map(([c, kb]) => `${c} ${Math.round(kb / 1024)} MB`),
  };
}

// ---------- defaults, names and recent files ----------
// The app the system opens for a kind of link ("http": the browser, "mailto": mail).
export async function defaultApp(proto) {
  const id = proto === 'http'
    ? await run('xdg-settings', ['get', 'default-web-browser']).catch(() => '')
    : await run('xdg-mime', ['query', 'default', `x-scheme-handler/${proto}`]).catch(() => '');
  if (!id) return null;
  const app = await appById(id.trim());
  return app ? { id: app.id, name: app.name } : { id: id.trim(), name: id.trim().replace(/\.desktop$/, '') };
}
// A program's own name: its app's name, or the file's.
export async function programName(p) {
  const app = String(p).endsWith('.desktop') ? await appById(path.basename(p)) : null;
  return app?.name || path.basename(String(p)).replace(/\.(desktop|AppImage)$/i, '');
}

// Files opened recently, from the freedesktop list (recently-used.xbel).
export function parseRecentXbel(xml) {
  const out = [];
  const re = /<bookmark\b[^>]*\bhref="([^"]+)"[^>]*\bmodified="([^"]+)"/g;
  const re2 = /<bookmark\b[^>]*\bmodified="([^"]+)"[^>]*\bhref="([^"]+)"/g;
  const add = (href, modified) => {
    if (!href.startsWith('file://')) return;
    let p;
    try { p = decodeURIComponent(new URL(href).pathname); } catch { return; }
    out.push({ path: p, at: Date.parse(modified) || 0 });
  };
  let m;
  while ((m = re.exec(xml))) add(m[1], m[2]);
  while ((m = re2.exec(xml))) add(m[2], m[1]);
  return out.sort((a, b) => b.at - a.at);
}
export async function recentOpened(limit = 30) {
  let xml = '';
  try { xml = fs.readFileSync(path.join(os.homedir(), '.local/share/recently-used.xbel'), 'utf8'); } catch { return []; }
  const seen = new Set();
  return parseRecentXbel(xml).filter((r) => !seen.has(r.path) && seen.add(r.path) && fs.existsSync(r.path))
    .slice(0, limit).map((r) => ({ ...r, dir: fs.statSync(r.path).isDirectory() }));
}

// ---------- the session (Scorpion as the desktop) ----------
// On Scorpion OS the session itself is Scorpion's (scorpion-session), so the
// Windows switches here have nothing to do.
export const getUserShell = async () => (process.env.XDG_SESSION_DESKTOP === 'scorpion' ? 'scorpion-session' : null);
export async function setUserShell() { throw new Error('On Linux, pick the Scorpion session at the sign-in screen instead.'); }
export const explorerRunning = async () => true;
export async function startExplorer() {}
export async function getWorkArea() { return null; }
export async function setWorkArea() {}
export function setWindowsTaskbar() { return Promise.resolve(); }

// Programs that start with the session (XDG autostart), which a desktop
// normally starts at sign-in; the session's own helpers start from labwc.
export async function runStartupApps() {
  const dirs = [path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart'), ...String(process.env.XDG_CONFIG_DIRS || '/etc/xdg').split(':').map((d) => path.join(d, 'autostart'))];
  const done = new Set();
  let n = 0;
  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.desktop')); } catch { continue; }
    for (const f of files) {
      if (done.has(f)) continue; // the user's own copy overrides the system's
      done.add(f);
      let e;
      try { e = parseDesktopEntry(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
      if (/scorpion/i.test(f) || e['X-GNOME-Autostart-enabled'] === 'false' || !showsHere({ ...e, NoDisplay: 'false' })) continue;
      if (e.TryExec && !(await run('which', [e.TryExec]).then(() => true, () => false))) continue;
      try { launchEntry(e); n++; } catch { /* broken entry */ }
    }
  }
  return n;
}

// The rail's bell: the last notifications again (the session's mako).
export const showNotifications = () => run('makoctl', ['restore']).catch(() => {});
