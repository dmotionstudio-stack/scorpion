// Everything Scorpion can do in one step, in one list: its own places, its
// Settings tabs, the wheel's intents and the system's settings and controls.
// The command palette (Ctrl+K) searches it, the orb matches spoken commands
// against it, and the main process runs the entries marked `main`. Plain data
// and functions, used by both the main process and the pages.
//
// run: { view } a place in Scorpion's window; { ui } something the window
// does itself; { main: 'settings' | 'control' | 'wheel' | 'stage', arg } done by the main
// process (intent:run). only: the one platform an entry exists on; live:
// only in Scorpion OS's live session (from the ISO or a USB stick).

export const INTENTS = [
  // ---- places ----
  { id: 'home', label: 'Home', group: 'Go to', keys: ['home screen', 'start page'], run: { view: 'home' } },
  { id: 'chat', label: 'Chats', group: 'Go to', keys: ['chat', 'conversations', 'messages'], run: { view: 'chat' } },
  { id: 'library', label: 'Library', group: 'Go to', keys: ['photos', 'pictures', 'music', 'videos'], run: { view: 'library' } },
  { id: 'apps', label: 'Apps', group: 'Go to', keys: ['applications', 'programs', 'start menu'], run: { view: 'apps' } },
  { id: 'get-apps', label: 'Get more apps', group: 'Go to', keys: ['install an app', 'app store', 'store', 'software', 'get apps', 'flathub'], run: { view: 'apps' }, only: 'linux' },
  { id: 'files', label: 'Files', group: 'Go to', keys: ['my files', 'file explorer', 'explorer', 'folders'], run: { view: 'files' } },
  // ---- Scorpion's settings ----
  { id: 'settings', label: 'Settings', group: 'Scorpion settings', keys: ['general', 'preferences', 'options', 'performance', 'theme', 'appearance', 'orb look'], run: { view: 'settings' } },
  { id: 'models', label: 'Models', group: 'Scorpion settings', keys: ['ai models', 'language models', 'download a model'], run: { view: 'models' } },
  { id: 'docs', label: 'Documents', group: 'Scorpion settings', keys: ['my documents', 'knowledge'], run: { view: 'docs' } },
  { id: 'agents', label: 'Agents', group: 'Scorpion settings', keys: ['assistants'], run: { view: 'agents' } },
  { id: 'skills', label: 'Skills', group: 'Scorpion settings', keys: [], run: { view: 'skills' } },
  { id: 'personality', label: 'Personality', group: 'Scorpion settings', keys: ['persona', 'character'], run: { view: 'personality' } },
  { id: 'schedules', label: 'Schedules', group: 'Scorpion settings', keys: ['scheduled tasks', 'reminders'], run: { view: 'schedules' } },
  { id: 'memory', label: 'Memory', group: 'Scorpion settings', keys: ['memories', 'what you remember'], run: { view: 'memory' } },
  { id: 'people', label: 'People', group: 'Scorpion settings', keys: ['faces', 'face lock', 'face recognition'], run: { view: 'people' } },
  { id: 'connections', label: 'Connections', group: 'Scorpion settings', keys: ['telegram', 'phone', 'integrations', 'mcp'], run: { view: 'connections' } },
  // ---- things to do ----
  { id: 'new-chat', label: 'New chat', group: 'Do', keys: ['start a new chat', 'new conversation'], run: { ui: 'newChat' } },
  { id: 'talk', label: 'Talk to Scorpion', group: 'Do', keys: ['talk', 'voice', 'listen', 'speak'], run: { ui: 'talk' } },
  { id: 'write', label: 'Write a note', group: 'Do', keys: ['write', 'notes', 'text editor', 'notepad'], run: { main: 'wheel', arg: 'write' } },
  { id: 'browse', label: 'Browse the web', group: 'Do', keys: ['browse', 'browser', 'web', 'internet browser'], run: { main: 'wheel', arg: 'browse' } },
  { id: 'create', label: 'Draw something', group: 'Do', keys: ['create', 'draw', 'paint', 'drawing'], run: { main: 'wheel', arg: 'create' } },
  { id: 'focus', label: 'Focus timer', group: 'Do', keys: ['focus', 'timer', 'clock', 'stopwatch'], run: { main: 'wheel', arg: 'focus' } },
  { id: 'stage', label: 'Stage on or off', group: 'Do', keys: ['stage', 'stage manager', 'one window at a time', 'recent windows strip'], run: { main: 'stage' }, only: 'win32' },
  { id: 'sidebar', label: 'Show or hide the sidebar', group: 'Do', keys: ['sidebar', 'toggle sidebar'], hint: 'Ctrl+B', run: { ui: 'sidebar' } },
  { id: 'welcome', label: 'Show the welcome again', group: 'Do', keys: ['welcome', 'tour', 'first start', 'tutorial'], run: { ui: 'welcome' } },
  // ---- the system ----
  { id: 'install', label: 'Install Scorpion OS', group: 'System', keys: ['install', 'install scorpion', 'install scorpion os', 'install the system', 'install it on this computer'], run: { main: 'install' }, only: 'linux', live: true },
  { id: 'wifi', label: 'Wi-Fi settings', group: 'System', keys: ['wifi', 'wi fi', 'wireless', 'network', 'internet', 'network settings'], run: { main: 'settings', arg: 'wifi' } },
  { id: 'bluetooth', label: 'Bluetooth settings', group: 'System', keys: ['bluetooth', 'headphones', 'pair a device'], run: { main: 'settings', arg: 'bluetooth' } },
  { id: 'sound', label: 'Sound settings', group: 'System', keys: ['sound', 'audio', 'volume', 'speakers', 'microphone'], run: { main: 'settings', arg: 'sound' } },
  { id: 'display', label: 'Display settings', group: 'System', keys: ['display', 'displays', 'screen', 'monitor', 'resolution', 'night light'], run: { main: 'settings', arg: 'display' } },
  { id: 'power', label: 'Power and battery', group: 'System', keys: ['power', 'battery', 'sleep settings'], run: { main: 'settings', arg: 'power' } },
  { id: 'storage', label: 'Storage', group: 'System', keys: ['disk space', 'disks', 'drives'], run: { main: 'settings', arg: 'storage' } },
  { id: 'printers', label: 'Printers', group: 'System', keys: ['printer', 'printing', 'scanner'], run: { main: 'settings', arg: 'printers' } },
  { id: 'updates', label: 'Software updates', group: 'System', keys: ['update', 'updates', 'windows update', 'software update'], run: { main: 'settings', arg: 'update' } },
  { id: 'notifications', label: 'Notification settings', group: 'System', keys: ['notifications', 'do not disturb'], run: { main: 'settings', arg: 'notifications' }, only: 'win32' },
  { id: 'system-settings', label: 'Windows Settings', group: 'System', keys: ['control panel', 'system settings', 'pc settings'], run: { main: 'settings', arg: 'home' }, only: 'win32' },
  { id: 'lock', label: 'Lock the screen', group: 'System', keys: ['lock', 'lock screen', 'lock the computer', 'lock my pc'], run: { main: 'control', arg: 'lock' } },
  { id: 'screenshot', label: 'Take a screenshot', group: 'System', keys: ['screenshot', 'screen shot', 'capture the screen'], run: { main: 'control', arg: 'screenshot' } },
  { id: 'dark-mode', label: 'Dark mode', group: 'System', keys: ['dark theme', 'night mode'], run: { main: 'control', arg: 'dark_mode' } },
  { id: 'light-mode', label: 'Light mode', group: 'System', keys: ['light theme', 'day mode'], run: { main: 'control', arg: 'light_mode' } },
];

// The main process may only run these from intent:run (no restart, shut down
// or anything else that asks first).
export const MAIN_CONTROLS = ['lock', 'screenshot', 'dark_mode', 'light_mode'];

export const intentsFor = (platform, { live = false } = {}) => INTENTS.filter((i) => (!i.only || i.only === platform) && (!i.live || live));
export const findIntent = (id, platform, opts) => intentsFor(platform, opts).find((i) => i.id === id) || null;

const clean = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// How well a typed query fits one name: whole name, its start, a word's start,
// anywhere in it, or its letters in order ("btth" → "bluetooth"). 0 = no fit.
function fit(q, name) {
  const n = clean(name);
  if (!n) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 80 - Math.min(10, n.length - q.length) / 2;
  if (n.split(' ').some((w) => w.startsWith(q))) return 60;
  if (n.includes(q)) return 45;
  if (q.replace(/ /g, '').length < 3) return 0; // two letters in order match almost anything
  let at = -1, gaps = 0;
  for (const ch of q.replace(/ /g, '')) {
    const next = n.indexOf(ch, at + 1);
    if (next < 0) return 0;
    if (at >= 0) gaps += next - at - 1;
    at = next;
  }
  return Math.max(5, 30 - gaps * 2);
}

// The entries for a query, best first. An empty query lists them all, in order.
export function rankIntents(query, list) {
  const q = clean(query);
  if (!q) return list.slice();
  return list
    .map((it, order) => ({ it, order, score: Math.max(fit(q, it.label), ...it.keys.map((k) => fit(q, k) - 2)) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((r) => r.it);
}

const OPENERS = /^(?:please )?(?:open|show(?: me)?|go to|switch to|bring up|take me to|launch|start|turn on|switch on)(?: the| my)? /;

// A short spoken command that names an entry exactly ("open Wi-Fi settings",
// "lock the screen", "dark mode"): the entry, or null for the model.
export function matchSpoken(text, list) {
  const t = clean(text).replace(/ please$/, '');
  if (!t || t.split(' ').length > 6) return null;
  const said = [t, t.replace(OPENERS, '')];
  return list.find((it) => [it.label, ...it.keys].some((n) => said.includes(clean(n)))) || null;
}
