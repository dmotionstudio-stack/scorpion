// Switches of the computer that Scorpion turns on and off by command (the agent's system_control tool, and spoken or typed
// commands such as "turn off the camera"): camera and microphone access, Wi-Fi, Bluetooth, airplane mode, do not disturb and
// night light. Each system does it its own way; what a system offers no switch for is said plainly, with its Settings page
// opened for the person to flip it (never a silent failure, never a pretend success).
//
// An action is "<setting>_on" or "<setting>_off". The functions take what they need (running a command, opening a Settings
// page), so each way can be tested without touching the computer.

export const TOGGLES = {
  camera: { label: 'Camera access', page: 'camera' },
  microphone: { label: 'Microphone', page: 'microphone' },
  wifi: { label: 'Wi-Fi', page: 'wifi' },
  bluetooth: { label: 'Bluetooth', page: 'bluetooth' },
  airplane_mode: { label: 'Airplane mode', page: 'network' },
  do_not_disturb: { label: 'Do not disturb', page: 'notifications' },
  night_light: { label: 'Night light', page: 'nightlight' },
};
export const TOGGLE_ACTIONS = Object.keys(TOGGLES).flatMap((s) => [`${s}_on`, `${s}_off`]);

// "camera_off" → { setting: 'camera', on: false }; anything else: null.
export function parseToggle(action) {
  const m = /^([a-z_]+)_(on|off)$/.exec(String(action || ''));
  return m && TOGGLES[m[1]] ? { setting: m[1], on: m[2] === 'on' } : null;
}
// Asking first: turning the camera or microphone back on (a privacy choice) and what could cut the person off (Wi-Fi, Bluetooth, airplane mode).
export const toggleRisk = (action) => (['camera_on', 'microphone_on', 'wifi_off', 'bluetooth_off', 'airplane_mode_on'].includes(action) ? 'ask' : 'none');

// What a toggle says: "Camera access is on." etc.
const said = (setting, on) => `${TOGGLES[setting].label} is ${on ? 'on' : 'off'}.`;
// A switch the system gives Scorpion no way to flip: its Settings page opens, and the answer says so.
async function manual(setting, on, why, deps) {
  let opened = '';
  try { await deps.openSettings(TOGGLES[setting].page); opened = ` Its Settings page is open: turn it ${on ? 'on' : 'off'} there.`; } catch { /* no page here */ }
  return `${TOGGLES[setting].label} can't be switched from outside the system settings${why ? ` (${why})` : ''}.${opened}`;
}

// ---------- Windows ----------
const CONSENT = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore';
// The per-user "let apps use the camera / microphone" switch of Settings → Privacy, for Store apps and desktop apps alike.
export const consentScript = (kind, allow) => {
  const value = allow ? 'Allow' : 'Deny';
  return [`$ErrorActionPreference = 'Stop'`,
    `foreach ($k in '${CONSENT}\\${kind}', '${CONSENT}\\${kind}\\NonPackaged') { if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }; Set-ItemProperty -Path $k -Name Value -Value '${value}' }`,
    `(Get-ItemProperty -Path '${CONSENT}\\${kind}' -Name Value).Value`].join('; ');
};
// The radios (Wi-Fi, Bluetooth, mobile) through Windows' own radio API: no administrator needed. kinds: 'WiFi', 'Bluetooth' or both.
export const radioScript = (kinds, on) => [
  `Add-Type -AssemblyName System.Runtime.WindowsRuntime`,
  `$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]`,
  `function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }`,
  `[Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType=WindowsRuntime] | Out-Null`,
  `[Windows.Devices.Radios.RadioAccessStatus, Windows.System.Devices, ContentType=WindowsRuntime] | Out-Null`,
  `$access = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])`,
  `if ($access -ne 'Allowed') { throw 'Windows did not allow Scorpion to change the radios (' + $access + ')' }`,
  `$radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])`,
  `$kinds = @(${kinds.map((k) => `'${k}'`).join(', ')})`,
  `$mine = @($radios | Where-Object { $kinds -contains [string]$_.Kind })`,
  `if ($mine.Count -eq 0) { 'none'; return }`,
  `foreach ($r in $mine) { Await ($r.SetStateAsync('${on ? 'On' : 'Off'}')) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null }`,
  `'done'`,
].join('; ');
// Do not disturb: banners and sounds from apps held back (Windows' own switch for notification pop-ups).
export const dndScript = (on) => `$k = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings'; if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }; Set-ItemProperty -Path $k -Name NOC_GLOBAL_SETTING_TOASTS_ENABLED -Type DWord -Value ${on ? 0 : 1}; 'done'`;

export async function windowsToggle(setting, on, { runPs, openSettings }) {
  if (setting === 'camera' || setting === 'microphone') {
    const kind = setting === 'camera' ? 'webcam' : 'microphone';
    const now = await runPs(consentScript(kind, on));
    if (String(now).trim() !== (on ? 'Allow' : 'Deny')) throw new Error(`${TOGGLES[setting].label} did not change.`);
    return `${said(setting, on)} (Windows: Settings → Privacy → ${setting === 'camera' ? 'Camera' : 'Microphone'}; apps that were using it may need a restart.)`;
  }
  if (setting === 'wifi' || setting === 'bluetooth' || setting === 'airplane_mode') {
    const kinds = setting === 'wifi' ? ['WiFi'] : setting === 'bluetooth' ? ['Bluetooth'] : ['WiFi', 'Bluetooth', 'MobileBroadband', 'Other'];
    // Airplane mode: on means every radio off.
    const radiosOn = setting === 'airplane_mode' ? !on : on;
    const out = String(await runPs(radioScript(kinds, radiosOn), { timeout: 30000 })).trim();
    if (out === 'none') return `This PC has no ${setting === 'wifi' ? 'Wi-Fi' : setting === 'bluetooth' ? 'Bluetooth' : 'radio'} to switch.`;
    return said(setting, on);
  }
  if (setting === 'do_not_disturb') {
    await runPs(dndScript(on));
    return `${said(setting, on)} (Notification banners and sounds are ${on ? 'held back' : 'back'}.)`;
  }
  return manual(setting, on, 'Windows keeps it in a store Scorpion cannot write', { openSettings });
}

// ---------- macOS ----------
export const macMajor = (release) => Number(String(release || '').split('.')[0]) || 0; // Darwin 22 is macOS 13
// The Wi-Fi device (en0 and so on) from networksetup -listallhardwareports.
export function wifiDevice(out) {
  const m = /Hardware Port: (?:Wi-?Fi|AirPort)\s*\nDevice: (\S+)/i.exec(String(out));
  return m ? m[1] : null;
}
export async function macToggle(setting, on, { run, osa, openSettings, release = '' }) {
  if (setting === 'microphone') {
    // No switch for the microphone itself: its input level to 0 is silence, and back to a normal level is on.
    await osa([`set volume input volume ${on ? 75 : 0}`]);
    return `${said(setting, on)} (The input volume is ${on ? 'back to 75%' : 'at 0, so nothing is heard'}.)`;
  }
  if (setting === 'wifi') {
    const dev = wifiDevice(await run('networksetup', ['-listallhardwareports'])) || 'en0';
    await run('networksetup', ['-setairportpower', dev, on ? 'on' : 'off']);
    return said(setting, on);
  }
  if (setting === 'bluetooth') {
    try { await run('blueutil', ['--power', on ? '1' : '0']); return said(setting, on); } catch (err) {
      if (!/ENOENT|not found/i.test(String(err.message))) throw err;
      return manual(setting, on, 'a Mac needs the free blueutil tool for that', { openSettings });
    }
  }
  if (setting === 'do_not_disturb') {
    if (macMajor(release) >= 22) return manual(setting, on, 'macOS 13 and newer keep Focus to themselves', { openSettings: () => openSettings('notifications') });
    await run('defaults', ['-currentHost', 'write', 'com.apple.notificationcenterui', 'doNotDisturb', '-boolean', on ? 'true' : 'false']);
    await run('killall', ['NotificationCenter']).catch(() => {});
    return said(setting, on);
  }
  if (setting === 'camera') return manual(setting, on, 'macOS decides per app, in Privacy & Security', { openSettings });
  if (setting === 'night_light') return manual(setting, on, 'Night Shift is in Displays', { openSettings: () => openSettings('display') });
  return manual(setting, on, 'a Mac has no airplane mode: turn off Wi-Fi and Bluetooth instead', { openSettings });
}

// ---------- Linux (Scorpion OS) ----------
export async function linuxToggle(setting, on, { run, openSettings }) {
  if (setting === 'wifi') { await run('nmcli', ['radio', 'wifi', on ? 'on' : 'off']); return said(setting, on); }
  if (setting === 'bluetooth') { await run('bluetoothctl', ['power', on ? 'on' : 'off']); return said(setting, on); }
  if (setting === 'airplane_mode') { await run('rfkill', [on ? 'block' : 'unblock', 'all']); return said(setting, on); }
  if (setting === 'microphone') {
    // The default input, muted or not (PipeWire's wpctl).
    await run('wpctl', ['set-mute', '@DEFAULT_AUDIO_SOURCE@', on ? '0' : '1']);
    return said(setting, on);
  }
  if (setting === 'do_not_disturb') {
    await run('makoctl', ['mode', on ? '-a' : '-r', 'do-not-disturb']);
    return said(setting, on);
  }
  if (setting === 'night_light') return manual(setting, on, 'Scorpion OS sets it in the display tool', { openSettings });
  return manual(setting, on, 'Scorpion OS has no switch for the camera', { openSettings });
}
