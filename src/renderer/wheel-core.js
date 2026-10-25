// The intent wheel's geometry and wording (summon.js), kept apart so it can be
// tested: six intents around the centre, picked by where you flick or click,
// and the recent windows on the outer ring, each with what it is and when it
// was last used.

// Clockwise from the top: each intent has 60 degrees, Browse from 12 to 2 o'clock.
export const INTENTS = [
  { id: 'browse', label: 'Browse' },
  { id: 'talk', label: 'Talk' },
  { id: 'create', label: 'Create' },
  { id: 'files', label: 'Files' },
  { id: 'focus', label: 'Focus' },
  { id: 'write', label: 'Write' },
];
export const SEGMENT = 360 / INTENTS.length;

// Degrees clockwise from straight up for an offset from the centre (screen
// coordinates: y grows downward).
export function angleOf(dx, dy) {
  const a = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return (a + 360) % 360;
}

// The intent at an offset from the centre, or null inside the centre button.
export function segmentAt(dx, dy, inner = 0) {
  if (Math.hypot(dx, dy) < inner) return null;
  return INTENTS[Math.floor(angleOf(dx, dy) / SEGMENT) % INTENTS.length].id;
}

// A flick: far enough from where it started to mean a direction.
export function flick(dx, dy, min = 36) {
  return Math.hypot(dx, dy) >= min ? segmentAt(dx, dy) : null;
}

// The centre angle of an intent's segment (for placing its icon and label).
export const centreOf = (id) => INTENTS.findIndex((i) => i.id === id) * SEGMENT + SEGMENT / 2;

// "just now", "2m ago", "1h ago", "3d ago".
export function ago(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// What a window is, from its program: "Browser", "Music", "Chat", "Document"…
const KINDS = [
  [/^(chrome|msedge|firefox|brave|opera|vivaldi|arc|iexplore)$/i, 'Browser'],
  [/^(spotify|music|itunes|vlc|wmplayer|foobar2000|musicbee|applemusic)$/i, 'Music'],
  [/^(teams|ms-teams|slack|discord|whatsapp|telegram|signal|zoom|skype)$/i, 'Chat'],
  [/^(winword|notepad|wordpad|soffice|swriter|acrobat|acrord32|sumatrapdf|obsidian|onenote|notion)$/i, 'Document'],
  [/^(excel|scalc)$/i, 'Spreadsheet'],
  [/^(powerpnt|simpress)$/i, 'Slides'],
  [/^(code|devenv|idea64|pycharm64|webstorm64|sublime_text|notepad\+\+|windowsterminal|cmd|powershell|pwsh)$/i, 'Code'],
  [/^(explorer)$/i, 'Folder'],
  [/^(outlook|olk|thunderbird|hxoutlook)$/i, 'Mail'],
  [/^(photoshop|illustrator|mspaint|paint|figma|blender|gimp|krita|afterfx|premiere|resolve)$/i, 'Design'],
];
export function kindOf(w = {}) {
  const exe = String(w.exe || '').split(/[\\/]/).pop().replace(/\.exe$/i, '');
  const name = exe || String(w.process || '');
  for (const [re, kind] of KINDS) if (re.test(name)) return kind;
  return name ? name[0].toUpperCase() + name.slice(1) : 'App';
}

// A window's own name, without the program's ("Project Notes - Google Docs -
// Google Chrome" is "Project Notes").
export function titleOf(w = {}) {
  const t = String(w.title || '').trim();
  return t.split(/ [-–—|] /)[0].trim() || t || kindOf(w);
}

// Where the recent windows sit on the outer ring: along the right-hand arc,
// spread evenly (degrees clockwise from up), each tilted a little along it.
export function ringSlots(n) {
  if (n <= 0) return [];
  if (n === 1) return [{ angle: 40, tilt: -8 }];
  const span = Math.min(250, 52 * (n - 1));
  const start = 65 - span / 2;
  return Array.from({ length: n }, (_, i) => {
    const angle = start + (span * i) / (n - 1);
    return { angle, tilt: Math.round((angle - 90) * 0.16) };
  });
}

// A point on a circle around the centre for an angle (degrees clockwise from up).
export function polar(angle, r) {
  const a = (angle * Math.PI) / 180;
  return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
}

// The SVG path of a ring segment between two angles.
export function sectorPath(a0, a1, r0, r1, gap = 0) {
  const p = (a, r) => { const q = polar(a, r); return `${q.x.toFixed(2)} ${q.y.toFixed(2)}`; };
  const g0 = (gap / r0) * (180 / Math.PI) / 2;
  const g1 = (gap / r1) * (180 / Math.PI) / 2;
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${p(a0 + g1, r1)} A ${r1} ${r1} 0 ${large} 1 ${p(a1 - g1, r1)} L ${p(a1 - g0, r0)} A ${r0} ${r0} 0 ${large} 0 ${p(a0 + g0, r0)} Z`;
}
