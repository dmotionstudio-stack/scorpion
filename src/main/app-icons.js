// The apps' own icons, for the Apps screen and the taskbar. One PowerShell pass
// finds, for every app in the Start menu, the file its icon comes from: a Store
// app's logo picture (from its package), a program's .exe, or the Start menu
// shortcut. Electron turns those into pictures; the results are kept on disk so
// the next start shows them at once.
import fs from 'node:fs';
import path from 'node:path';
import * as win from './windows-control.js';

const SOURCES = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Namespace IconKf -Name K -MemberDefinition '[DllImport("shell32.dll")] public static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid id, uint f, IntPtr t, out IntPtr p);'
$pkgs = @{}; Get-AppxPackage | ForEach-Object { $pkgs[$_.PackageFamilyName] = $_ }
$links = @{}
foreach ($d in "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs", "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs") {
  Get-ChildItem -Path $d -Recurse -Filter '*.lnk' | ForEach-Object { if (-not $links.ContainsKey($_.BaseName)) { $links[$_.BaseName] = $_.FullName } }
}
# A shortcut's own icon file, or the program it starts (a shortcut file shows only a generic picture).
$sh = New-Object -ComObject WScript.Shell
function Target($lnk) {
  $l = $sh.CreateShortcut($lnk)
  $icon = [Environment]::ExpandEnvironmentVariables((($l.IconLocation -split ',')[0]).Trim())
  if ($icon -and (Test-Path -LiteralPath $icon)) { return $icon }
  if ($l.TargetPath -and (Test-Path -LiteralPath $l.TargetPath)) { return $l.TargetPath }
  return $lnk
}
# A Store app's logo: the best of the picture's size variants.
function Logo($pkg, $appId) {
  $m = [xml](Get-Content -Raw (Join-Path $pkg.InstallLocation 'AppxManifest.xml'))
  $app = @($m.Package.Applications.Application) | Where-Object { $_.Id -eq $appId } | Select-Object -First 1
  if (-not $app) { $app = @($m.Package.Applications.Application)[0] }
  $rel = $app.VisualElements.Square44x44Logo; if (-not $rel) { $rel = $app.VisualElements.Logo }
  if (-not $rel) { return $null }
  $full = Join-Path $pkg.InstallLocation $rel
  if (Test-Path $full) { return $full }
  $dir = Split-Path $full; $base = [IO.Path]::GetFileNameWithoutExtension($full)
  $files = Get-ChildItem -Path $dir -Filter "$base*.png"
  $rank = { param($n) if ($n -match 'targetsize-48_altform-unplated') { 0 } elseif ($n -match 'targetsize-48') { 1 } elseif ($n -match 'targetsize-(32|64)_altform-unplated') { 2 } elseif ($n -match 'targetsize-(32|64)') { 3 } elseif ($n -match 'scale-200') { 4 } elseif ($n -match 'scale-100') { 5 } else { 6 } }
  ($files | Sort-Object { & $rank $_.Name } | Select-Object -First 1).FullName
}
$out = foreach ($a in Get-StartApps) {
  $id = $a.AppID; $file = $null
  if ($id -like '*!*') { $fam, $appId = $id.Split('!', 2); $p = $pkgs[$fam]; if ($p) { $file = Logo $p $appId } }
  elseif ($id -match '^(\\{[0-9A-Fa-f-]+\\})\\\\(.*)$') {
    $ptr = [IntPtr]::Zero
    if ([IconKf.K]::SHGetKnownFolderPath([Guid]$Matches[1], 0, [IntPtr]::Zero, [ref]$ptr) -eq 0) { $file = Join-Path ([Runtime.InteropServices.Marshal]::PtrToStringUni($ptr)) $Matches[2] }
  }
  elseif ($id -match '^[A-Za-z]:\\\\') { $file = $id }
  if (-not $file -or -not (Test-Path $file)) { $file = $links[$a.Name] }
  if ($file -like '*.lnk') { $file = Target $file }
  if ($file) { [pscustomobject]@{ id = $id; file = $file } }
}
@($out) | ConvertTo-Json -Compress
`;

let deps = null; // { app, nativeImage, dataDir }
let cache = {}; // app id -> { file, url }
const urls = () => Object.fromEntries(Object.entries(cache).map(([id, c]) => [id, c.url]));
let loading = null;

export function initAppIcons(d) {
  deps = d;
  try { cache = JSON.parse(fs.readFileSync(path.join(d.dataDir, 'app-icons.json'), 'utf8')); } catch { cache = {}; }
  // An older cache held bare pictures: start again.
  if (Object.values(cache).some((c) => typeof c === 'string')) cache = {};
}

async function picture(file) {
  if (/\.(png|ico)$/i.test(file)) {
    const img = deps.nativeImage.createFromPath(file);
    return img.isEmpty() ? null : img.resize({ width: 48, height: 48, quality: 'best' }).toDataURL();
  }
  const img = await deps.app.getFileIcon(file, { size: 'large' }).catch(() => null);
  return img && !img.isEmpty() ? img.toDataURL() : null;
}

// All the icons known so far; with fresh, look the apps up again (in the
// background the first time, so the Apps screen opens without waiting).
export async function appIcons({ fresh = false } = {}) {
  if (process.platform !== 'win32') return {};
  if (fresh || !Object.keys(cache).length) await refresh();
  return urls();
}

export function refresh() {
  loading ??= (async () => {
    try {
      const out = await win.runPs(SOURCES, { timeout: 120000 });
      const list = out ? [].concat(JSON.parse(out)) : [];
      const next = {};
      for (const { id, file } of list) {
        if (!id || !file) continue;
        // The same file as last time: the same picture.
        const url = cache[id]?.file === file ? cache[id].url : await picture(file);
        if (url) next[id] = { file, url };
      }
      cache = next;
      fs.writeFileSync(path.join(deps.dataDir, 'app-icons.json'), JSON.stringify(cache));
    } finally {
      loading = null;
    }
    return urls();
  })();
  return loading;
}

// The icon for a program file (a pinned app or a window's program).
export const iconForFile = (file) => picture(file).catch(() => null);
