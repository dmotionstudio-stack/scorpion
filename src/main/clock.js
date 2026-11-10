// The computer's clock (Settings → General → System → Date and time): whether
// it follows the internet's time, syncing it now, or setting it by hand.
// Reading how it is set needs no rights. Changing it is the system's to
// allow: Windows asks (UAC), Scorpion OS and macOS ask for the password.
// Nothing here runs unless the person presses a button in Settings.
import { execFile } from 'node:child_process';

// "2026-11-09" and "14:05" (what the date and time fields give) as numbers,
// or an error that says what's wrong.
export function parseWhen({ date, time } = {}) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(time || ''));
  if (!d || !t) throw new Error('Choose a date and a time first.');
  const w = { year: Number(d[1]), month: Number(d[2]), day: Number(d[3]), hour: Number(t[1]), minute: Number(t[2]) };
  const real = new Date(w.year, w.month - 1, w.day, w.hour, w.minute);
  const same = real.getFullYear() === w.year && real.getMonth() === w.month - 1 && real.getDate() === w.day && real.getHours() === w.hour && real.getMinutes() === w.minute;
  if (!same || w.year < 2000 || w.year > 2099) throw new Error("That date and time isn't one the clock can be set to.");
  return w;
}
const two = (n) => String(n).padStart(2, '0');

// What the system is asked to do, for each action:
//   { file, args, elevated }: a program run as it is (elevated: through the
//   system's own permission prompt).
// action: 'auto' (on: true | false), 'sync', 'set' (when: parseWhen's result).
export function clockCommand(platform, action, { on, when } = {}) {
  if (platform === 'win32') {
    const key = "'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\W32Time\\Parameters'";
    const type = (v) => `Set-ItemProperty -Path ${key} -Name Type -Value '${v}'`;
    // (exit 2: the time service answered that it couldn't reach a time server)
    const sync = "if ((Get-Service w32time).StartType -eq 'Disabled') { Set-Service -Name w32time -StartupType Manual }; Start-Service w32time; w32tm /config /update | Out-Null; w32tm /resync /force | Out-Null; if ($LASTEXITCODE -ne 0) { exit 2 }";
    const script = {
      auto: on ? `${type('NTP')}; ${sync}` : `${type('NoSync')}; w32tm /config /update | Out-Null`,
      sync,
      set: when && `${type('NoSync')}; Set-Date -Date (Get-Date -Year ${when.year} -Month ${when.month} -Day ${when.day} -Hour ${when.hour} -Minute ${when.minute} -Second 0) | Out-Null`,
    }[action];
    return script ? { file: 'powershell.exe', script, elevated: true } : null;
  }
  if (platform === 'linux') {
    if (action === 'auto') return { file: 'timedatectl', args: ['set-ntp', on ? 'true' : 'false'] };
    if (action === 'sync') return { file: 'pkexec', args: ['sh', '-c', 'timedatectl set-ntp true && systemctl restart systemd-timesyncd.service'] };
    if (action === 'set' && when) return { file: 'pkexec', args: ['sh', '-c', `timedatectl set-ntp false && timedatectl set-time '${when.year}-${two(when.month)}-${two(when.day)} ${two(when.hour)}:${two(when.minute)}:00'`] };
    return null;
  }
  if (platform === 'darwin') {
    const shell = {
      auto: `/usr/sbin/systemsetup -setusingnetworktime ${on ? 'on' : 'off'}`,
      sync: '/usr/sbin/systemsetup -setusingnetworktime on; /usr/bin/sntp -sS time.apple.com',
      // date's own form: month day hour minute year . seconds
      set: when && `/usr/sbin/systemsetup -setusingnetworktime off; /bin/date ${two(when.month)}${two(when.day)}${two(when.hour)}${two(when.minute)}${when.year}.00`,
    }[action];
    return shell ? { file: '/usr/bin/osascript', args: ['-e', `do shell script "${shell}" with administrator privileges`] } : null;
  }
  return null;
}

// How the clock is set now, from what the system prints.
export function parseAuto(platform, out) {
  const s = String(out || '');
  if (platform === 'win32') return /\bNoSync\b/i.test(s) ? false : /\b(NTP|NT5DS|AllSync)\b/i.test(s) ? true : null;
  if (platform === 'linux') return /^\s*yes\s*$/im.test(s) ? true : /^\s*no\s*$/im.test(s) ? false : null;
  if (platform === 'darwin') return /Network Time:\s*On/i.test(s) ? true : /Network Time:\s*Off/i.test(s) ? false : null;
  return null;
}
// A refusal or failure in plain words.
export function clockError(platform, err) {
  const m = String(err?.message || err || '');
  if (/cancell?ed by the user|operation was cancell?ed|User canceled|\(-128\)|Not authorized|Request dismissed/i.test(m)) {
    return platform === 'win32' ? "The clock wasn't changed: Windows needs your OK (choose Yes when it asks)." : "The clock wasn't changed: the system needs your password to allow it.";
  }
  if (/resync|no time data|0x800705B4|timed out|time-out/i.test(m)) return "The clock couldn't be synced: check that this computer is on the internet, then try again.";
  return `The clock couldn't be changed: ${m.split(/\r?\n/)[0].slice(0, 200) || 'the system refused'}`;
}

const run = (file, args, { timeout = 120000 } = {}) => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) reject(new Error(String(stderr || err.message).replace(/#< CLIXML[\s\S]*/, '').trim() || 'failed'));
    else resolve(String(stdout).trim());
  });
});
const encode = (script) => Buffer.from(script, 'utf16le').toString('base64');
// Windows: the script in an elevated PowerShell (Windows asks first). Its
// own errors come back through the exit code and a message.
function runElevatedPs(script) {
  const inner = encode(`$ErrorActionPreference = 'Stop'; try { ${script}; exit 0 } catch { exit 1 }`);
  const outer = `$ErrorActionPreference = 'Stop'; $p = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${inner}'; if ($p.ExitCode -eq 2) { throw 'resync failed: no time data' } elseif ($p.ExitCode -ne 0) { throw 'the change was refused by Windows' }`;
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(outer)]);
}

// deps (for tests): { platform, run(file, args), elevate(script) }
export function createClock({ platform = process.platform, exec = run, elevate = runElevatedPs } = {}) {
  const supported = ['win32', 'linux', 'darwin'].includes(platform);
  async function status(extra = {}) {
    let auto = null;
    if (supported) {
      const read = {
        win32: () => exec('reg.exe', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\W32Time\\Parameters', '/v', 'Type'], { timeout: 8000 }),
        linux: () => exec('timedatectl', ['show', '-p', 'NTP', '--value'], { timeout: 8000 }),
        darwin: () => exec('/usr/sbin/systemsetup', ['-getusingnetworktime'], { timeout: 8000 }),
      }[platform];
      auto = await read().then((out) => parseAuto(platform, out), () => null);
    }
    return { supported, platform, auto, zone: Intl.DateTimeFormat().resolvedOptions().timeZone || '', now: Date.now(), ...extra };
  }
  async function change(action, opts = {}) {
    if (!supported) throw new Error("This system's clock can't be changed from Scorpion.");
    const when = action === 'set' ? parseWhen(opts) : null;
    const cmd = clockCommand(platform, action, { on: Boolean(opts.on), when });
    if (!cmd) throw new Error('Unknown clock action');
    try {
      if (cmd.elevated) await elevate(cmd.script);
      else await exec(cmd.file, cmd.args, { timeout: 120000 });
    } catch (err) { throw new Error(clockError(platform, err)); }
    const done = { auto: opts.on ? 'The clock now follows the internet\'s time.' : 'Automatic time is off: the clock keeps the time you set.', sync: 'The clock was synced with the internet\'s time.', set: 'The clock was set. Automatic time is off, so it stays as you set it.' }[action];
    return status({ done });
  }
  return { status, setAuto: (on) => change('auto', { on }), syncNow: () => change('sync'), setManual: (when) => change('set', when) };
}
