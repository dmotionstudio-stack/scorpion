// Lets the agent run Windows for the user: installed apps (desktop and Store),
// open windows, files and folders in Explorer and the Recycle Bin, Windows
// Settings pages, and system controls (volume, media keys, brightness, dark
// mode, screenshot, lock, sleep, restart, shut down). Everything goes through
// Windows' own tools (PowerShell, explorer.exe, shutdown.exe), with arguments
// passed as quoted literals, never pasted into commands.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';

export const supported = process.platform === 'win32';

// While Scorpion is the Windows desktop, explorer.exe must not be started (it
// would bring the Windows desktop back): apps start directly and folders open
// in Scorpion's Files screen.
let shellActive = false;
let folderOpener = null;
export function setShellActive(on) { shellActive = Boolean(on); }
export function setFolderOpener(fn) { folderOpener = fn; }

// A PowerShell single-quoted literal: nothing inside it is interpreted.
export const psQuote = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;

export function runPs(script, { timeout = 20000 } = {}) {
  const full = `$ProgressPreference = 'SilentlyContinue'; $ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`;
  const encoded = Buffer.from(full, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).replace(/#< CLIXML[\s\S]*/, '').trim().split(/\r?\n/)[0] || 'PowerShell failed'));
      else resolve(String(stdout).trim());
    });
  });
}

// One PowerShell kept open for frequent small calls (the taskbar asks for the
// open windows every couple of seconds): starting PowerShell and compiling the
// window helper each time would cost far more than the call itself.
let kept = null;
export function runPsKept(script, { timeout = 15000 } = {}) {
  if (!kept) {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', '-'], { windowsHide: true });
    // Each PowerShell's own state: output can still arrive after it was
    // stopped, and an old one exiting must not drop its replacement.
    const own = (kept = { p, out: '', queue: [] });
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => {
      own.out += d;
      let i;
      while ((i = own.out.indexOf('<<SCORPION-END>>')) >= 0) {
        const text = own.out.slice(0, i);
        own.out = own.out.slice(i + 16).replace(/^\r?\n/, '');
        const job = own.queue.shift();
        clearTimeout(job?.timer);
        if (!job) continue;
        const err = /^<<SCORPION-ERR>>(.*)/s.exec(text.trim());
        if (err) job.reject(new Error(err[1].trim() || 'PowerShell failed')); else job.resolve(text.trim());
      }
    });
    const fail = () => {
      if (kept === own) kept = null;
      for (const job of own.queue.splice(0)) { clearTimeout(job.timer); job.reject(new Error('PowerShell stopped')); }
    };
    p.on('exit', fail);
    p.on('error', fail);
    p.stdin.write("$ProgressPreference = 'SilentlyContinue'; [Console]::OutputEncoding = [Text.Encoding]::UTF8\n");
  }
  const k = kept;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const job = { resolve, reject };
    job.timer = setTimeout(() => { k.p.kill(); }, timeout);
    k.queue.push(job);
    k.p.stdin.write(`try { $ErrorActionPreference = 'Stop'; (Invoke-Expression ([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}'))) | Out-String -Width 4096).TrimEnd() } catch { '<<SCORPION-ERR>>' + $_.Exception.Message }; '<<SCORPION-END>>'\n`);
  });
}
export function stopPsKept() { kept?.p.kill(); kept = null; }

async function psJson(script, opts) {
  const out = await runPs(`${script} | ConvertTo-Json -Depth 4 -Compress`, opts);
  if (!out) return [];
  const v = JSON.parse(out);
  return Array.isArray(v) ? v : [v];
}

// ---------- apps ----------
let appCache = { at: 0, apps: [] };
export async function listApps({ fresh = false } = {}) {
  if (!fresh && Date.now() - appCache.at < 5 * 60_000 && appCache.apps.length) return appCache.apps;
  const apps = (await psJson('Get-StartApps | Select-Object Name, AppID', { timeout: 30000 }))
    .filter((a) => a?.Name && a?.AppID)
    .map((a) => ({ name: String(a.Name), id: String(a.AppID) }));
  appCache = { at: Date.now(), apps };
  return apps;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Best match for a spoken or typed name ("photoshop", "word", "calc"). Returns
// { best, others } where others are close alternatives.
export function matchByName(query, items, nameOf = (x) => x.name) {
  const q = norm(query);
  if (!q) return { best: null, others: [] };
  const words = q.split(' ');
  const scored = items.map((it) => {
    const n = norm(nameOf(it));
    let score = 0;
    if (n === q) score = 100;
    else if (n.startsWith(q)) score = 80 - Math.min(20, n.length - q.length) / 2;
    else if (n.split(' ').some((w) => w.startsWith(q))) score = 65 - Math.min(20, n.length - q.length) / 2;
    else if (n.includes(q)) score = 55;
    else {
      const hit = words.filter((w) => n.includes(w)).length;
      if (hit) score = 40 * (hit / words.length);
    }
    return { it, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return { best: scored[0]?.score >= 30 ? scored[0].it : null, others: scored.slice(1, 6).map((x) => x.it) };
}

export async function openApp(name) {
  const apps = await listApps();
  const { best, others } = matchByName(name, apps);
  if (!best) throw new Error(`No installed app matches "${name}". Use list_apps to see what is installed.`);
  await launchApp(best, { viaExplorer: !shellActive });
  return { opened: best.name, others: others.map((a) => a.name) };
}

// ---------- windows ----------
// The real top-level windows, the way the taskbar sees them: visible, with a
// title, not hidden ("cloaked") by Windows. Store apps (Calculator, Settings…)
// live inside a frame window owned by ApplicationFrameHost; acting on the
// window itself (not the process) is what makes them close and switch.
const WINAPI = `Add-Type -TypeDefinition @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class ScorpionWindows {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  public static List<string> List() {
    var o = new List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true; // owned windows (dialogs) are part of their app
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true; // tool windows
      int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512); if (sb.Length == 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      o.Add(h.ToInt64() + "\\t" + pid + "\\t" + sb.ToString());
      return true;
    }, IntPtr.Zero);
    return o;
  }
  public static void Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindowAsync(h, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); // a tap of Alt lets Windows hand over the foreground
    SetForegroundWindow(h);
  }
}
'@;`;

// kept: through the PowerShell kept open (the taskbar's frequent polling).
export async function listWindows({ kept = false } = {}) {
  const script = `${WINAPI} $fg = [ScorpionWindows]::GetForegroundWindow().ToInt64(); $names = @{}; $paths = @{}; Get-Process | ForEach-Object { $names[$_.Id] = $_.ProcessName; $paths[$_.Id] = $_.Path }; [ScorpionWindows]::List() | ForEach-Object { $p = $_.Split("\`t", 3); "$($p[0])\`t$($p[1])\`t$($names[[int]$p[1]])\`t$([int]($p[0] -eq $fg))\`t$($paths[[int]$p[1]])\`t$($p[2])" }`;
  const out = await (kept ? runPsKept(script) : runPs(script));
  return out.split(/\r?\n/).filter(Boolean).map((line) => {
    const [hwnd, pid, proc, active, exe, title] = line.split('\t');
    return { hwnd, pid: Number(pid), process: proc === 'ApplicationFrameHost' ? 'Store app' : proc, title, active: active === '1', exe: exe || null };
  }).filter((w) => w.title && !/^(Program Manager|Windows Input Experience)$/.test(w.title));
}

async function findWindow(target) {
  const wins = await listWindows();
  const { best, others } = matchByName(target, wins, (w) => `${w.title} ${w.process}`);
  if (!best) throw new Error(`No open window matches "${target}". Open windows: ${wins.map((w) => w.title).slice(0, 15).join(' | ') || 'none'}`);
  return { win: best, others };
}

const SHOW = { restore: 9, minimize: 6, maximize: 3 };
export async function windowAction(target, action = 'focus') {
  if (action !== 'focus' && !SHOW[action]) throw new Error('action must be focus, minimize, maximize or restore');
  const { win } = await findWindow(target);
  const h = `([IntPtr][long]${psQuote(win.hwnd)})`;
  await runPs(action === 'focus' ? `${WINAPI} [ScorpionWindows]::Focus(${h})` : `${WINAPI} [ScorpionWindows]::ShowWindowAsync(${h}, ${SHOW[action]}) | Out-Null`);
  return win;
}

// Closes a window the way its X button does (WM_CLOSE): the app can still ask
// to save. Nothing is force-quit.
export async function closeApp(target) {
  const { win } = await findWindow(target);
  await runPs(`${WINAPI} [ScorpionWindows]::PostMessage(([IntPtr][long]${psQuote(win.hwnd)}), 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null`);
  return { ...win, asked: true };
}

// ---------- files and folders ----------
const RUNNABLE = new Set(['.exe', '.bat', '.cmd', '.com', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.msi', '.msp', '.scr', '.reg', '.lnk', '.jar', '.hta', '.cpl', '.pif', '.appref-ms']);
export const isRunnable = (p) => RUNNABLE.has(path.extname(String(p)).toLowerCase());

export function openPath(p, { reveal = false } = {}) {
  if (!fs.existsSync(p)) throw new Error(`${p} does not exist`);
  if (shellActive) {
    const isDir = fs.statSync(p).isDirectory();
    if (isDir || reveal) return folderOpener ? folderOpener(isDir ? p : path.dirname(p), isDir ? null : p) : p;
    return runPs(`Start-Process -FilePath ${psQuote(p)}`).then(() => p);
  }
  return new Promise((resolve) => execFile('explorer.exe', reveal ? [`/select,${p}`] : [p], { windowsHide: false }, () => resolve(p)));
}

// To the Recycle Bin (restorable), never a permanent delete.
export async function recyclePath(p) {
  if (!fs.existsSync(p)) throw new Error(`${p} does not exist`);
  const dir = fs.statSync(p).isDirectory();
  await runPs(`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${dir ? 'DeleteDirectory' : 'DeleteFile'}(${psQuote(p)}, 'OnlyErrorDialogs', 'SendToRecycleBin')`, { timeout: 120000 });
  return { recycled: p, folder: dir };
}

// Copies a file or a whole folder; never overwrites.
export function copyPath(from, to) {
  if (!fs.existsSync(from)) throw new Error(`${from} does not exist`);
  let dest = to;
  if (fs.existsSync(to) && fs.statSync(to).isDirectory()) dest = path.join(to, path.basename(from));
  if (fs.existsSync(dest)) throw new Error(`${dest} already exists; choose another name`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(from, dest, { recursive: true, errorOnExist: true, force: false });
  return dest;
}

// ---------- Windows Settings ----------
export const SETTINGS_PAGES = {
  home: '', display: 'display', sound: 'sound', notifications: 'notifications', power: 'powersleep', battery: 'batterysaver', storage: 'storagesense',
  bluetooth: 'bluetooth', devices: 'connecteddevices', printers: 'printers', mouse: 'mousetouchpad', network: 'network-status', wifi: 'network-wifi', vpn: 'network-vpn',
  personalization: 'personalization', background: 'personalization-background', colors: 'colors', themes: 'themes', lockscreen: 'lockscreen', taskbar: 'taskbar',
  apps: 'appsfeatures', defaultapps: 'defaultapps', startup: 'startupapps', accounts: 'yourinfo', signin: 'signinoptions', time: 'dateandtime', language: 'regionlanguage',
  gaming: 'gaming-gamebar', accessibility: 'easeofaccess', privacy: 'privacy', camera: 'privacy-webcam', microphone: 'privacy-microphone', location: 'privacy-location',
  update: 'windowsupdate', security: 'windowsdefender', about: 'about', recovery: 'recovery', nightlight: 'nightlight', focus: 'quiethours',
};
export function openSettings(page = 'home') {
  const key = norm(page).replace(/ /g, '');
  const found = SETTINGS_PAGES[key] ?? Object.entries(SETTINGS_PAGES).find(([k]) => k.startsWith(key) || key.startsWith(k))?.[1];
  if (found === undefined) throw new Error(`Unknown Settings page "${page}". Pages: ${Object.keys(SETTINGS_PAGES).join(', ')}`);
  if (shellActive) return runPs(`Start-Process ${psQuote(`ms-settings:${found}`)}`).then(() => found || 'home');
  return new Promise((resolve) => execFile('explorer.exe', [`ms-settings:${found}`], { windowsHide: true }, () => resolve(found || 'home')));
}

// ---------- system controls ----------
// Volume and media keys are the keyboard's own keys, sent to Windows.
const KEY = { volume_up: 175, volume_down: 174, mute: 173, play_pause: 179, next_track: 176, previous_track: 177 };
export const ACTIONS = ['volume_up', 'volume_down', 'set_volume', 'mute', 'play_pause', 'next_track', 'previous_track', 'brightness', 'dark_mode', 'light_mode', 'screenshot', 'lock', 'sleep', 'restart', 'shutdown', 'cancel_shutdown', 'empty_recycle_bin'];
// How much the user must be asked: none, ask (unless Auto-approve), always.
export function actionRisk(action) {
  if (['restart', 'shutdown', 'empty_recycle_bin'].includes(action)) return 'always';
  if (['dark_mode', 'light_mode', 'brightness', 'sleep'].includes(action)) return 'ask';
  return 'none';
}

export async function systemControl(action, amount) {
  if (!ACTIONS.includes(action)) throw new Error(`Unknown action. Use one of: ${ACTIONS.join(', ')}`);
  const keys = (code, times = 1) => runPs(`$s = New-Object -ComObject WScript.Shell; 1..${Math.max(1, Math.min(50, Math.round(times)))} | ForEach-Object { $s.SendKeys([char]${code}) }`);
  switch (action) {
    case 'volume_up': case 'volume_down': await keys(KEY[action], Math.round((Number(amount) || 10) / 2)); return `Volume ${action === 'volume_up' ? 'up' : 'down'} about ${Math.round((Number(amount) || 10) / 2) * 2}%.`;
    case 'set_volume': {
      const level = Math.max(0, Math.min(100, Math.round(Number(amount) || 0)));
      await keys(KEY.volume_down, 50);
      if (level) await keys(KEY.volume_up, level / 2);
      return `Volume set to about ${level}%.`;
    }
    case 'mute': case 'play_pause': case 'next_track': case 'previous_track': await keys(KEY[action]); return `Done (${action.replace('_', ' ')}).`;
    case 'brightness': {
      const level = Math.max(5, Math.min(100, Math.round(Number(amount) || 50)));
      await runPs(`(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods) | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = ${level} } | Out-Null`)
        .catch(() => { throw new Error('This screen does not let Windows change its brightness (usual for desktop monitors).'); });
      return `Brightness set to ${level}%.`;
    }
    case 'dark_mode': case 'light_mode': {
      const v = action === 'light_mode' ? 1 : 0;
      await runPs(`$k = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'; Set-ItemProperty -Path $k -Name AppsUseLightTheme -Value ${v} -Type DWord; Set-ItemProperty -Path $k -Name SystemUsesLightTheme -Value ${v} -Type DWord`);
      return `Windows is now in ${v ? 'light' : 'dark'} mode.`;
    }
    case 'screenshot': {
      const dir = path.join(os.homedir(), 'Pictures', 'Screenshots');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `Scorpion ${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.png`);
      await runPs(`Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $b = [System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height; $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size); $bmp.Save(${psQuote(file)}, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()`);
      return `Screenshot saved: ${file}`;
    }
    case 'lock': await new Promise((r) => execFile('rundll32.exe', ['user32.dll,LockWorkStation'], () => r())); return 'Locked.';
    case 'sleep': await runPs("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false) | Out-Null"); return 'Going to sleep.';
    // A 30-second warning that the user can cancel (cancel_shutdown, or shutdown /a).
    case 'restart': await new Promise((r, j) => execFile('shutdown.exe', ['/r', '/t', '30', '/c', 'Scorpion: restarting in 30 seconds.'], (e) => (e ? j(e) : r()))); return 'Restarting in 30 seconds. Say "cancel the restart" to stop it.';
    case 'shutdown': await new Promise((r, j) => execFile('shutdown.exe', ['/s', '/t', '30', '/c', 'Scorpion: shutting down in 30 seconds.'], (e) => (e ? j(e) : r()))); return 'Shutting down in 30 seconds. Say "cancel the shutdown" to stop it.';
    case 'cancel_shutdown': await new Promise((r) => execFile('shutdown.exe', ['/a'], () => r())); return 'Cancelled.';
    case 'empty_recycle_bin': await runPs('Clear-RecycleBin -Force -ErrorAction SilentlyContinue'); return 'Recycle Bin emptied.';
    default: throw new Error('Unknown action');
  }
}

// ---------- system info ----------
export async function systemInfo() {
  const [info] = await psJson(`
    $os = Get-CimInstance Win32_OperatingSystem; $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
    [pscustomobject]@{
      os = "$($os.Caption) $($os.Version)"; uptimeHours = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1)
      cpu = $cpu.Name; cpuLoad = $cpu.LoadPercentage
      ramGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1); ramFreeGB = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
      disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { "$($_.DeviceID) $([math]::Round($_.FreeSpace/1GB)) GB free of $([math]::Round($_.Size/1GB)) GB" })
      battery = if ($bat) { "$($bat.EstimatedChargeRemaining)% $(if ($bat.BatteryStatus -eq 2) { 'charging' } else { 'on battery' })" } else { 'none' }
      network = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { "$($_.InterfaceAlias): $($_.IPAddress)" })
      topApps = @(Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 6 | ForEach-Object { "$($_.ProcessName) $([math]::Round($_.WorkingSet64/1MB)) MB" })
    }`, { timeout: 30000 });
  return info;
}

// ---------- launching without Explorer (for Scorpion as the desktop) ----------
// Explorer normally starts apps for the Start menu. When Scorpion is the
// desktop, starting explorer.exe would bring the Windows desktop back, so each
// kind of app ID is started directly: Store apps through Windows' app
// activation, programs by their path, the rest through their Start menu
// shortcut.
const ACTIVATE = `Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
[ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IApplicationActivationManager { int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string id, [MarshalAs(UnmanagedType.LPWStr)] string args, int options, out uint pid); }
[ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")] class AppActivation {}
public static class ScorpionApps { public static uint Start(string id) { uint pid; ((IApplicationActivationManager)new AppActivation()).ActivateApplication(id, null, 0, out pid); return pid; } }
'@;`;

export function appKind(id) {
  if (id.includes('!')) return 'store';
  if (/^\{[0-9A-F-]+\}\\/i.test(id)) return 'known-folder';
  if (/^[a-z]:\\/i.test(id)) return 'path';
  return 'shortcut';
}

export async function launchApp(app, { viaExplorer = true } = {}) {
  const kind = appKind(app.id);
  if (kind === 'store') return runPs(`${ACTIVATE} [ScorpionApps]::Start(${psQuote(app.id)}) | Out-Null`);
  if (kind === 'path') return runPs(`Start-Process -FilePath ${psQuote(app.id)} -WorkingDirectory ${psQuote(path.dirname(app.id))}`);
  if (kind === 'known-folder') {
    const [, guid, rest] = /^(\{[0-9A-F-]+\})\\(.*)$/i.exec(app.id);
    return runPs(`Add-Type -Namespace ScorpionKf -Name K -MemberDefinition '[DllImport("shell32.dll")] public static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid id, uint f, IntPtr t, out IntPtr p);'; $p = [IntPtr]::Zero; [ScorpionKf.K]::SHGetKnownFolderPath([Guid]${psQuote(guid)}, 0, [IntPtr]::Zero, [ref]$p) | Out-Null; $dir = [Runtime.InteropServices.Marshal]::PtrToStringUni($p); $exe = Join-Path $dir ${psQuote(rest)}; Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe)`);
  }
  // A Start menu shortcut with the app's name.
  const found = await runPs(`$names = @(${psQuote(app.name)}); $dirs = @("$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs", "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs"); $l = Get-ChildItem -Path $dirs -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue | Where-Object { $names -contains $_.BaseName } | Select-Object -First 1; if ($l) { Start-Process -FilePath $l.FullName; 'ok' }`);
  if (found === 'ok') return found;
  if (app.id === 'Microsoft.Windows.ControlPanel') return runPs('Start-Process control.exe');
  if (viaExplorer) return new Promise((resolve) => execFile('explorer.exe', [`shell:AppsFolder\\${app.id}`], { windowsHide: true }, () => resolve()));
  throw new Error(`${app.name} can't be started without the Windows desktop.`);
}

// ---------- Scorpion as the Windows desktop (shell) ----------
// Windows starts the program named in Winlogon's Shell value at sign-in. The
// per-user value (HKCU) overrides the machine one for this account only. It is
// changed only when the user presses the button in Settings → Desktop.
const WINLOGON = "'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon'";
export async function getUserShell() {
  return (await runPs(`(Get-ItemProperty ${WINLOGON} -ErrorAction SilentlyContinue).Shell`)) || null;
}
export async function setUserShell(command) {
  if (command) await runPs(`Set-ItemProperty -Path ${WINLOGON} -Name Shell -Value ${psQuote(command)} -Type String`);
  else await runPs(`Remove-ItemProperty -Path ${WINLOGON} -Name Shell -ErrorAction SilentlyContinue`);
  return getUserShell();
}
export const explorerRunning = async () => (await runPs("if (Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq (Get-Process -Id $PID).SessionId }) { 'yes' }")) === 'yes';
// Explorer only becomes the desktop (taskbar, Start) when it is the shell
// Windows is set to; otherwise it just opens a folder window. So while this
// account's shell is Scorpion, the setting is lifted for Explorer's start and
// put back afterwards (if that is interrupted, the next sign-in is simply the
// Windows desktop).
export async function startExplorer() {
  const custom = await getUserShell().catch(() => null);
  if (custom) await setUserShell(null);
  await new Promise((resolve) => execFile('explorer.exe', [], { windowsHide: false }, () => resolve()));
  if (custom) {
    await new Promise((r) => setTimeout(r, 8000));
    await setUserShell(custom).catch(() => {});
  }
}

// The screen area apps maximize into; the taskbar keeps the bottom strip.
const SPI = `Add-Type -Namespace ScorpionSpi -Name S -MemberDefinition '[StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; } [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint b, ref R r, uint f);';`;
export async function getWorkArea() {
  const out = await runPs(`${SPI} $r = New-Object ScorpionSpi.S+R; [ScorpionSpi.S]::SystemParametersInfo(0x30, 0, [ref]$r, 0) | Out-Null; "$($r.L) $($r.T) $($r.Rt) $($r.B)"`);
  const [left, top, right, bottom] = out.split(' ').map(Number);
  return { left, top, right, bottom };
}
export async function setWorkArea({ left, top, right, bottom }) {
  await runPs(`${SPI} $r = New-Object ScorpionSpi.S+R; $r.L = ${Math.round(left)}; $r.T = ${Math.round(top)}; $r.Rt = ${Math.round(right)}; $r.B = ${Math.round(bottom)}; [ScorpionSpi.S]::SystemParametersInfo(0x2F, 0, [ref]$r, 3) | Out-Null`);
}

// Programs that start with Windows (Run keys and Startup folders), which the
// Windows desktop normally starts at sign-in.
export async function runStartupApps() {
  return runPs(`$sh = New-Object -ComObject WScript.Shell; $n = 0
    foreach ($k in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run') {
      $p = Get-ItemProperty -Path $k -ErrorAction SilentlyContinue
      if ($p) { $p.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' -and $_.Value -notmatch 'Scorpion' } | ForEach-Object { try { $sh.Run([string]$_.Value, 1, $false) | Out-Null; $n++ } catch {} } }
    }
    foreach ($d in "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Startup", "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Startup") {
      Get-ChildItem -Path $d -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in '.lnk', '.url', '.exe' -and $_.Name -notmatch 'Scorpion' } | ForEach-Object { try { Start-Process -FilePath $_.FullName; $n++ } catch {} }
    }
    $n`, { timeout: 60000 });
}

// Windows' own taskbar (and the ones on other screens), hidden while
// Scorpion's takes its place, and shown again after. Only the windows are
// hidden: no Windows setting changes, and restarting Explorer brings it back.
// Explorer sometimes shows it again (opening Start, a screen change), so the
// keeper calls this every few seconds; with a work area it also keeps the
// screen space for apps above Scorpion's bar.
// The work area is in scaled pixels, like Electron's. This runs in the kept
// PowerShell, whose thread the pointer and window helpers switch to real
// pixels; so it switches back first, or on a scaled screen it would read the
// area doubled and "correct" it to half (windows jumping every few seconds).
const TRAY = `Add-Type -Namespace ScorpionTb -Name T -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr c, string cls, string t); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);';`;
export function setWindowsTaskbar(visible, area = null) {
  const keepArea = area ? `[ScorpionTb.T]::SetThreadDpiAwarenessContext([IntPtr](-1)) | Out-Null; ${SPI} $r = New-Object ScorpionSpi.S+R; [ScorpionSpi.S]::SystemParametersInfo(0x30, 0, [ref]$r, 0) | Out-Null; if ($r.B -ne ${Math.round(area.bottom)} -or $r.T -ne ${Math.round(area.top)}) { $r.L = ${Math.round(area.left)}; $r.T = ${Math.round(area.top)}; $r.Rt = ${Math.round(area.right)}; $r.B = ${Math.round(area.bottom)}; [ScorpionSpi.S]::SystemParametersInfo(0x2F, 0, [ref]$r, 3) | Out-Null }` : '';
  return runPsKept(`${TRAY} foreach ($cls in 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd') { $h = [IntPtr]::Zero; while (($h = [ScorpionTb.T]::FindWindowEx([IntPtr]::Zero, $h, $cls, $null)) -ne [IntPtr]::Zero) { if ([ScorpionTb.T]::IsWindowVisible($h) -ne $${Boolean(visible)}) { [ScorpionTb.T]::ShowWindow($h, ${visible ? 5 : 0}) | Out-Null } } } ${keepArea}`);
}

// End task (the taskbar's right-click menu): force-quit the program behind a
// window, like Windows' own End task; unsaved work in it is lost. A Store app's
// window belongs to ApplicationFrameHost, which holds every Store app's frame,
// so the app's own process is found inside it. Windows' own parts and Scorpion
// are never ended.
const END = `Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class ScorpionEnd {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static uint Pid(IntPtr h) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    try {
      if (System.Diagnostics.Process.GetProcessById((int)pid).ProcessName != "ApplicationFrameHost") return pid;
    } catch { return pid; }
    uint frame = pid, found = 0;
    EnumChildWindows(h, (c, l) => { uint p; GetWindowThreadProcessId(c, out p); if (p != frame) { found = p; return false; } return true; }, IntPtr.Zero);
    return found;
  }
}
'@;`;
const KEEP_RUNNING = new Set(['explorer', 'dwm', 'csrss', 'winlogon', 'wininit', 'lsass', 'services', 'smss', 'svchost', 'system', 'fontdrvhost', 'applicationframehost', 'shellexperiencehost', 'startmenuexperiencehost', 'searchhost', 'textinputhost', 'sihost', 'ctfmon']);
// The program End task would stop for a window, or an error saying why not.
export async function endTaskTarget(hwnd, { ownPids = [] } = {}) {
  const pid = Number(await runPsKept(`${END} [ScorpionEnd]::Pid(([IntPtr][long]${psQuote(hwnd)}))`));
  if (!pid) throw new Error("Couldn't find that app's program (it may be suspended).");
  if (ownPids.includes(pid)) throw new Error("That's Scorpion itself: quit it from its own menu instead.");
  const name = (await runPsKept(`(Get-Process -Id ${pid}).ProcessName`)).trim();
  if (/^scorpion$/i.test(name)) throw new Error("That's Scorpion itself: quit it from its own menu instead.");
  if (KEEP_RUNNING.has(name.toLowerCase())) throw new Error(`${name} is part of Windows and can't be ended here.`);
  return { pid, name };
}
export async function endTask(hwnd, opts) {
  const { pid, name } = await endTaskTarget(hwnd, opts);
  await runPsKept(`Stop-Process -Id ${pid} -Force`);
  return name;
}

// ---------- defaults, names, status (also in linux-control.js) ----------
// The program Windows opens for a kind of link ("http": the browser, "mailto": mail).
export async function defaultApp(proto) {
  const cmd = await runPs(`$p = (Get-ItemProperty "HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${proto}\\UserChoice" -ErrorAction SilentlyContinue).ProgId; if ($p) { (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\\$p\\shell\\open\\command" -ErrorAction SilentlyContinue).'(default)' }`).catch(() => '');
  const m = /^\s*"([^"]+\.exe)"/i.exec(cmd || '') || /^\s*(\S+\.exe)/i.exec(cmd || '');
  return m && fs.existsSync(m[1]) ? { id: m[1], name: path.basename(m[1], '.exe') } : null;
}
// A program's own name ("Google Chrome" for chrome.exe).
export async function programName(exe) {
  const desc = await runPs(`(Get-Item -LiteralPath ${psQuote(exe)}).VersionInfo.FileDescription`).catch(() => '');
  return desc.trim() || path.basename(exe, path.extname(exe));
}
// The power menu: right away (programs can still stop a restart to save work).
export const powerNow = (action) => runPs(`shutdown.exe ${action === 'restart' ? '/r' : '/s'} /t 0`);
// The taskbar's volume button and wheel: the keyboard's volume keys (2% a step).
export const volumeStep = (action) => runPsKept(`(New-Object -ComObject WScript.Shell).SendKeys([char]${action === 'up' ? 175 : action === 'down' ? 174 : 173})`);
// What the taskbar shows besides the windows: battery and network.
export async function trayStatus() {
  const out = await runPs(`$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1; $n = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Select-Object -First 1; [pscustomobject]@{ battery = if ($b) { [int]$b.EstimatedChargeRemaining } else { $null }; charging = if ($b) { $b.BatteryStatus -eq 2 } else { $false }; network = if ($n) { $n.Name } else { $null } } | ConvertTo-Json -Compress`).catch(() => '{}');
  try { return JSON.parse(out || '{}'); } catch { return {}; }
}
// Files and folders opened recently: Windows keeps a shortcut to each in its
// Recent folder (unless that is turned off in its privacy settings).
export async function recentOpened(limit = 30) {
  const opened = await runPs(`$sh = New-Object -ComObject WScript.Shell
    Get-ChildItem -Path "$env:APPDATA\\Microsoft\\Windows\\Recent" -Filter '*.lnk' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First ${limit * 2} | ForEach-Object {
      $t = $sh.CreateShortcut($_.FullName).TargetPath
      if ($t -and (Test-Path -LiteralPath $t)) { [pscustomobject]@{ path = $t; dir = (Test-Path -LiteralPath $t -PathType Container); at = [long]($_.LastWriteTime.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds } }
    } | Select-Object -First ${limit} | ConvertTo-Json -Compress`, { timeout: 30000 }).catch(() => '');
  try { return opened ? [].concat(JSON.parse(opened)) : []; } catch { return []; }
}
// Icons come from the program files (main.js) and the Start menu (app-icons.js).
export const iconForApp = async () => null;

// Sign out of Windows (the shell's power menu).
export const signOut = () => new Promise((resolve) => execFile('shutdown.exe', ['/l'], () => resolve()));

// Window actions by handle, for the taskbar (it already knows which window).
export async function windowByHandle(hwnd, action) {
  const h = `([IntPtr][long]${psQuote(hwnd)})`;
  if (action === 'focus') return runPsKept(`${WINAPI} [ScorpionWindows]::Focus(${h})`);
  if (action === 'minimize') return runPsKept(`${WINAPI} [ScorpionWindows]::ShowWindowAsync(${h}, 6) | Out-Null`);
  if (action === 'close') return runPsKept(`${WINAPI} [ScorpionWindows]::PostMessage(${h}, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null`);
  throw new Error('Unknown window action');
}
