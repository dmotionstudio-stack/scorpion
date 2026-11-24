// What a person on the remote screen does (move, click, scroll, type, press keys), checked and turned into the computer's own input.
// remote-control.js hands every request here first: nothing outside this list is ever sent on to the computer.
//
// Coordinates arrive as fractions of the shared screen (0 to 1), so the page works at any size, and leave as the computer's own
// pixels (Windows) or points (Mac).

const MODS = ['ctrl', 'alt', 'shift', 'meta'];
const BUTTONS = ['left', 'right'];

// Named keys: the Windows virtual-key code (and whether it is an "extended" key), and the Mac key code.
export const NAMED_KEYS = {
  Enter: { vk: 13, mac: 36 }, Backspace: { vk: 8, mac: 51 }, Tab: { vk: 9, mac: 48 }, Escape: { vk: 27, mac: 53 },
  Delete: { vk: 46, ext: true, mac: 117 }, Insert: { vk: 45, ext: true, mac: 114 },
  ArrowLeft: { vk: 37, ext: true, mac: 123 }, ArrowUp: { vk: 38, ext: true, mac: 126 }, ArrowRight: { vk: 39, ext: true, mac: 124 }, ArrowDown: { vk: 40, ext: true, mac: 125 },
  Home: { vk: 36, ext: true, mac: 115 }, End: { vk: 35, ext: true, mac: 119 }, PageUp: { vk: 33, ext: true, mac: 116 }, PageDown: { vk: 34, ext: true, mac: 121 },
  F1: { vk: 112, mac: 122 }, F2: { vk: 113, mac: 120 }, F3: { vk: 114, mac: 99 }, F4: { vk: 115, mac: 118 }, F5: { vk: 116, mac: 96 }, F6: { vk: 117, mac: 97 },
  F7: { vk: 118, mac: 98 }, F8: { vk: 119, mac: 100 }, F9: { vk: 120, mac: 101 }, F10: { vk: 121, mac: 109 }, F11: { vk: 122, mac: 103 }, F12: { vk: 123, mac: 111 },
};

const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));
const num = (n, lo, hi, d = 0) => Math.min(hi, Math.max(lo, Math.round(Number(n)) || d));

// A request from the page → a plain command, or null when it is not something the page may do.
export function normalizeInput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '');
  const at = () => ({ x: clamp01(raw.x), y: clamp01(raw.y) });
  const button = BUTTONS.includes(raw.button) ? raw.button : 'left';
  switch (type) {
    case 'move': return { type, ...at() };
    case 'down': case 'up': return { type, ...at(), button };
    case 'click': return { type, ...at(), button, count: num(raw.count, 1, 2, 1) };
    case 'wheel': return { type, ...at(), notches: num(raw.notches, -20, 20) }; // up is positive
    case 'text': {
      const text = String(raw.text ?? '').slice(0, 400);
      return text ? { type, text } : null;
    }
    case 'key': {
      const mods = {};
      for (const m of MODS) mods[m] = Boolean(raw.mods?.[m]);
      const name = String(raw.key ?? '');
      if (NAMED_KEYS[name]) return { type, name, mods };
      // A single letter or digit with a modifier held is a shortcut (Ctrl+C); anything else typed is text.
      if (/^[a-z0-9]$/i.test(name) && (mods.ctrl || mods.alt || mods.meta)) return { type, char: name.toLowerCase(), mods };
      if (name.length === 1) return { type: 'text', text: name };
      return null;
    }
    default: return null;
  }
}

export const modMask = (m) => (m.ctrl ? 1 : 0) | (m.alt ? 2 : 0) | (m.shift ? 4 : 0) | (m.meta ? 8 : 0);

// ---------- Windows: Scorpion's helper (win-helper.cs) ----------
// call(cmd, ...args) is win-helper.js' call; toScreen(x, y) turns fractions into the screen's pixels.
export function windowsInput({ call, toScreen }) {
  return {
    async handle(c) {
      const p = c.x !== undefined ? toScreen(c.x, c.y) : null;
      switch (c.type) {
        case 'move': return call('move', p.x, p.y);
        case 'click': return call('click', p.x, p.y, c.button === 'right' ? 1 : 0, c.count);
        case 'down': return c.button === 'right' ? call('rdown', p.x, p.y) : call('down', p.x, p.y);
        case 'up': return c.button === 'right' ? call('rup', p.x, p.y) : call('up', p.x, p.y);
        case 'wheel': return call('wheel', p.x, p.y, c.notches, 0);
        case 'text': return call('type', Buffer.from(c.text, 'utf8').toString('base64'));
        case 'key': {
          const named = c.name ? NAMED_KEYS[c.name] : null;
          const vk = named ? named.vk : c.char.toUpperCase().charCodeAt(0);
          return call('key', vk, (named?.ext ? 16 : 0) | modMask(c.mods));
        }
        default: throw new Error('Unknown input');
      }
    },
  };
}

// ---------- macOS: osascript (System Events and JavaScript for Automation) ----------
// run(args) starts osascript with these arguments. The scripts are fixed text; what varies goes in as numbers or argv.
export function jxaMouse(kind, x, y, button = 'left', count = 1) {
  const b = button === 'right' ? 'Right' : 'Left';
  const ev = { move: 'MouseMoved', down: `${b}MouseDown`, up: `${b}MouseUp` }[kind];
  const lines = ["ObjC.import('ApplicationServices');", `var p = { x: ${Number(x)}, y: ${Number(y)} };`];
  const post = (name, n = 0) => {
    lines.push(`var e${name}${n} = $.CGEventCreateMouseEvent(null, $.kCGEvent${name}, p, $.kCGMouseButton${b});`);
    if (n) lines.push(`$.CGEventSetIntegerValueField(e${name}${n}, $.kCGMouseEventClickState, ${n});`);
    lines.push(`$.CGEventPost($.kCGHIDEventTap, e${name}${n});`);
  };
  if (kind === 'click') {
    for (let i = 1; i <= count; i++) { post(`${b}MouseDown`, i); post(`${b}MouseUp`, i); }
  } else post(ev);
  return lines.join('\n');
}

export function jxaWheel(x, y, notches) {
  return ["ObjC.import('ApplicationServices');", `var p = { x: ${Number(x)}, y: ${Number(y)} };`,
    '$.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, p, $.kCGMouseButtonLeft));',
    `$.CGEventPost($.kCGHIDEventTap, $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitLine, 1, ${Number(notches) * 3}));`].join('\n');
}

const asString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function appleKeyLine(c) {
  const using = [c.mods.meta && 'command down', c.mods.ctrl && 'control down', c.mods.alt && 'option down', c.mods.shift && 'shift down'].filter(Boolean);
  const tail = using.length ? ` using {${using.join(', ')}}` : '';
  const named = c.name ? NAMED_KEYS[c.name] : null;
  return `tell application "System Events" to ${named ? `key code ${named.mac}` : `keystroke ${asString(c.char)}`}${tail}`;
}

export function macInput({ run, toScreen }) {
  const js = (script) => run(['-l', 'JavaScript', '-e', script]);
  return {
    async handle(c) {
      const p = c.x !== undefined ? toScreen(c.x, c.y) : null;
      switch (c.type) {
        case 'move': return js(jxaMouse('move', p.x, p.y));
        case 'click': return js(jxaMouse('click', p.x, p.y, c.button, c.count));
        case 'down': return js(jxaMouse('down', p.x, p.y, c.button));
        case 'up': return js(jxaMouse('up', p.x, p.y, c.button));
        case 'wheel': return js(jxaWheel(p.x, p.y, c.notches));
        case 'text': return run(['-e', `tell application "System Events" to keystroke ${asString(c.text)}`]);
        case 'key': return run(['-e', appleKeyLine(c)]);
        default: throw new Error('Unknown input');
      }
    },
  };
}
