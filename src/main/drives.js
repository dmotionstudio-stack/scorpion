// USB sticks, SD cards and external hard drives, for the taskbar's drives
// icon: which are plugged in, open one, take one out safely (eject). Reading
// the list needs no rights; ejecting is what the system's own tray does.
// The parsers and commands are plain functions (test/drives.test.js).
import { execFile } from 'node:child_process';
import fs from 'node:fs';

// ---------- what each system says ----------
// Windows: a USB disk's partitions with a letter, and card readers / flash
// drives Windows calls removable. One JSON line (a lone drive isn't an array).
export const WIN_SCRIPT = `$out = @();
foreach ($d in (Get-Disk -ErrorAction SilentlyContinue | Where-Object { $_.BusType -eq 'USB' })) {
  foreach ($p in ($d | Get-Partition -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter })) {
    $v = Get-Volume -DriveLetter $p.DriveLetter -ErrorAction SilentlyContinue
    if ($v) { $out += [pscustomobject]@{ letter = [string]$p.DriveLetter; label = [string]$v.FileSystemLabel; size = [double]$v.Size; free = [double]$v.SizeRemaining } }
  }
}
foreach ($l in (Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' -ErrorAction SilentlyContinue)) {
  $c = ([string]$l.DeviceID).Substring(0, 1)
  if (-not ($out | Where-Object { $_.letter -eq $c })) { $out += [pscustomobject]@{ letter = $c; label = [string]$l.VolumeName; size = [double]$l.Size; free = [double]$l.FreeSpace } }
}
ConvertTo-Json -InputObject @($out) -Compress`;

const asList = (x) => (Array.isArray(x) ? x : x ? [x] : []);
export function parseWindows(out) {
  let list = [];
  try { list = asList(JSON.parse(String(out || '[]').trim() || '[]')); } catch { return []; }
  return list.filter((d) => /^[A-Za-z]$/.test(String(d?.letter || ''))).map((d) => {
    const letter = String(d.letter).toUpperCase();
    return { id: `${letter}:`, name: String(d.label || '').trim() || 'Removable drive', mount: `${letter}:\\`, size: Number(d.size) || 0, free: Number(d.free) || 0 };
  }).sort((a, b) => a.id.localeCompare(b.id));
}
// Scorpion OS and other Linux: `lsblk -J -b -o NAME,PKNAME,LABEL,SIZE,RM,TRAN,HOTPLUG,MOUNTPOINT,TYPE`.
export function parseLinux(out) {
  let tree;
  try { tree = JSON.parse(String(out || '{}')); } catch { return []; }
  const found = [];
  const walk = (node, disk) => {
    const here = node.type === 'disk' ? node : disk;
    const removable = (n) => n.rm === true || n.rm === '1' || n.rm === 1 || n.hotplug === true || n.hotplug === '1' || n.hotplug === 1 || String(n.tran || '') === 'usb';
    if (node.mountpoint) {
      if (removable(node) || (here && removable(here))) {
        found.push({ id: `/dev/${node.name}`, name: String(node.label || '').trim() || String(here?.model || '').trim() || 'Removable drive', mount: node.mountpoint, size: Number(node.size) || 0, free: 0, dev: `/dev/${node.name}`, parent: here ? `/dev/${here.name}` : null });
      }
    }
    for (const c of node.children || []) walk(c, here);
  };
  for (const n of tree.blockdevices || []) walk(n, null);
  return found.filter((d) => d.mount && !/^\/(boot|efi)?$/.test(d.mount) && !d.mount.startsWith('/boot') && d.mount !== '[SWAP]');
}
// macOS: what `diskutil info -plist <mount>` says about one volume in /Volumes.
export function parseMacInfo(xml) {
  const flag = (k) => { const m = new RegExp(`<key>${k}</key>\\s*<(true|false)\\s*/>`).exec(String(xml || '')); return m ? m[1] === 'true' : null; };
  const str = (k) => { const m = new RegExp(`<key>${k}</key>\\s*<string>([^<]*)</string>`).exec(String(xml || '')); return m ? m[1] : ''; };
  const num = (k) => { const m = new RegExp(`<key>${k}</key>\\s*<integer>(\\d+)</integer>`).exec(String(xml || '')); return m ? Number(m[1]) : 0; };
  return { internal: flag('Internal'), removable: flag('RemovableMedia') ?? flag('Removable'), name: str('VolumeName'), size: num('TotalSize') || num('Size'), free: num('FreeSpace') || num('APFSContainerFree'), dev: str('DeviceNode') };
}

// ---------- the commands ----------
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
// A drive taken out: Windows' own Eject; Linux unmounts, then powers the disk off; macOS diskutil.
export function ejectCommands(platform, drive) {
  if (platform === 'win32') {
    if (!/^[A-Za-z]:$/.test(drive.id)) return null;
    return [{ file: 'powershell.exe', ps: `$s = New-Object -ComObject Shell.Application; $i = $s.Namespace(17).ParseName(${psQuote(drive.id)}); if (-not $i) { throw 'not found' }; $i.InvokeVerb('Eject')` }];
  }
  if (platform === 'linux') {
    if (!/^\/dev\/[\w-]+$/.test(drive.dev || '')) return null;
    const steps = [{ file: 'udisksctl', args: ['unmount', '-b', drive.dev] }];
    if (drive.parent && /^\/dev\/[\w-]+$/.test(drive.parent)) steps.push({ file: 'udisksctl', args: ['power-off', '-b', drive.parent], optional: true });
    return steps;
  }
  if (platform === 'darwin') return drive.mount ? [{ file: 'diskutil', args: ['eject', drive.mount] }] : null;
  return null;
}
// "29.8 GB", "512 MB".
export function sizeText(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return '';
  return n >= 1e9 ? `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB` : `${Math.round(n / 1e6)} MB`;
}
// One line in the menu: "Backup (E:) · 119 GB".
export const driveLabel = (d) => `${d.name}${d.id.length <= 3 ? ` (${d.id})` : ''}${d.size ? ` · ${sizeText(d.size)}` : ''}`;

// ---------- doing it ----------
const run = (file, args, timeout = 15000) => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).split(/\r?\n/)[0])) : resolve(String(stdout))));
});
const encode = (script) => Buffer.from(`$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; ${script}`, 'utf16le').toString('base64');
const runPs = (script, timeout) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(script)], timeout);

// deps (for tests): { platform, exec(file, args), ps(script), listVolumes(), readdir, realpath }
export function createDrives({ platform = process.platform, exec = run, ps = runPs, readdir = fs.readdirSync, realpath = fs.realpathSync } = {}) {
  async function list() {
    try {
      if (platform === 'win32') return parseWindows(await ps(WIN_SCRIPT, 20000));
      if (platform === 'linux') return parseLinux(await exec('lsblk', ['-J', '-b', '-o', 'NAME,LABEL,SIZE,RM,TRAN,HOTPLUG,MOUNTPOINT,TYPE,MODEL']));
      if (platform === 'darwin') {
        const out = [];
        for (const name of readdir('/Volumes')) {
          const mount = `/Volumes/${name}`;
          let real = mount;
          try { real = realpath(mount); } catch { continue; }
          if (real === '/') continue;
          const info = parseMacInfo(await exec('diskutil', ['info', '-plist', mount]).catch(() => ''));
          if (info.internal === false || info.removable === true) out.push({ id: mount, name: info.name || name, mount, size: info.size, free: info.free, dev: info.dev });
        }
        return out;
      }
    } catch { /* nothing readable */ }
    return [];
  }
  async function eject(id) {
    const drive = (await list()).find((d) => d.id === id);
    if (!drive) throw new Error('That drive is not connected any more.');
    const steps = ejectCommands(platform, drive);
    if (!steps) throw new Error("This system can't eject that drive from here.");
    for (const s of steps) {
      try { await (s.ps ? ps(s.ps, 30000) : exec(s.file, s.args, 30000)); } catch (err) {
        if (s.optional) continue;
        throw new Error(/busy|in use|target is busy/i.test(err.message) ? `${drive.name} is in use: close what is open on it, then try again.` : `${drive.name} could not be ejected: ${err.message.slice(0, 160)}`);
      }
    }
    return drive;
  }
  return { list, eject };
}
