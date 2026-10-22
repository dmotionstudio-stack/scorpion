// Apps open inside the orb: while the orb is open, the app in front loses its
// title bar and border and is placed in the orb's app panel (kept on top of
// Scorpion), with Scorpion's own strip above it. One app at a time: switching
// minimizes the previous one with its normal window back. Leaving the orb or
// quitting Scorpion gives every app its normal window back; if Scorpion stops
// unexpectedly, the next start does it (frame.json).
//
// Nothing is hidden or closed behind the user's back: the framed app is the
// real program, working normally; the others are ordinary minimized windows.
import fs from 'node:fs';
import path from 'node:path';
import * as win from './windows-control.js';

const FRAME = `Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class ScorpionFrame {
  public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  // Physical pixels, whatever this PowerShell's own DPI setting is.
  static void Dpi() { try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { } }
  public static string Info(IntPtr h) {
    Dpi();
    if (h == IntPtr.Zero || !IsWindow(h)) return "";
    uint pid; GetWindowThreadProcessId(h, out pid);
    var c = new StringBuilder(256); GetClassName(h, c, 256);
    var t = new StringBuilder(512); GetWindowText(h, t, 512);
    int cloaked = 0; DwmGetWindowAttribute(h, 14, out cloaked, 4);
    RECT r; GetWindowRect(h, out r);
    return h.ToInt64() + "\\t" + pid + "\\t" + c + "\\t" + GetWindowLong(h, -16) + "\\t" + GetWindowLong(h, -20) + "\\t" + (GetWindow(h, 4) != IntPtr.Zero ? 1 : 0)
      + "\\t" + (cloaked != 0 ? 1 : 0) + "\\t" + (IsWindowVisible(h) ? 1 : 0) + "\\t" + (IsIconic(h) ? 1 : 0) + "\\t" + (IsZoomed(h) ? 1 : 0)
      + "\\t" + r.L + " " + r.T + " " + r.R + " " + r.B + "\\t" + t;
  }
  public static string Fg() { return Info(GetForegroundWindow()); }
  // Title bar and border off, on top, in the panel. False: the app refused.
  public static bool Frame(IntPtr h, int x, int y, int w, int hh) {
    Dpi();
    if (IsIconic(h) || IsZoomed(h)) ShowWindow(h, 9);
    int s = GetWindowLong(h, -16);
    int ns = s & ~0x00C00000 & ~0x00040000;
    SetWindowLong(h, -16, ns);
    bool ok = GetWindowLong(h, -16) == ns;
    SetWindowPos(h, new IntPtr(-1), x, y, w, hh, 0x0020 | 0x0040);
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(h);
    return ok;
  }
  public static void Restore(IntPtr h) { Dpi(); ShowWindow(h, 9); }
  public static void Place(IntPtr h, int x, int y, int w, int hh) { Dpi(); SetWindowPos(h, new IntPtr(-1), x, y, w, hh, 0x0010 | 0x0040); }
  // The normal window back: its own style, size and place, not on top.
  public static void Release(IntPtr h, int style, int x, int y, int w, int hh, bool minimize) {
    Dpi();
    if (!IsWindow(h)) return;
    SetWindowLong(h, -16, style);
    SetWindowPos(h, new IntPtr(-2), x, y, w, hh, 0x0020 | 0x0010);
    if (minimize) ShowWindow(h, 6);
  }
}
'@;`;

// The air mouse: the real pointer, clicks, drags and the wheel, for hand
// gestures inside the framed app.
const MOUSE = `Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class ScorpionMouse {
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, int dx, int dy, int data, UIntPtr e);
  [DllImport("user32.dll")] static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  static void At(int x, int y) { try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { } SetCursorPos(x, y); }
  public struct P { public int X, Y; }
  [DllImport("user32.dll")] static extern bool GetCursorPos(out P p);
  public static string Pos() { try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { } P p; GetCursorPos(out p); return p.X + " " + p.Y; }
  public static void Move(int x, int y) { At(x, y); }
  public static void Click(int x, int y, bool right, int times) {
    At(x, y);
    for (int i = 0; i < times; i++) { mouse_event(right ? 0x8u : 0x2u, 0, 0, 0, UIntPtr.Zero); mouse_event(right ? 0x10u : 0x4u, 0, 0, 0, UIntPtr.Zero); }
  }
  public static void Down(int x, int y) { At(x, y); mouse_event(0x2, 0, 0, 0, UIntPtr.Zero); }
  public static void Up(int x, int y) { At(x, y); mouse_event(0x4, 0, 0, 0, UIntPtr.Zero); }
  public static void Wheel(int x, int y, int notches, bool ctrl) {
    At(x, y);
    if (ctrl) keybd_event(0x11, 0, 0, UIntPtr.Zero);
    mouse_event(0x800, 0, 0, notches * 120, UIntPtr.Zero);
    if (ctrl) keybd_event(0x11, 0, 2, UIntPtr.Zero);
  }
}
'@;`;

const WS_CAPTION = 0x00C00000;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_TOPMOST = 0x8;
// The Windows shell's own windows, never framed.
const SHELL_CLASSES = new Set(['Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Progman', 'WorkerW', 'Windows.UI.Core.CoreWindow', 'NotifyIconOverflowWindow', 'TopLevelWindowForOverflowXamlIsland', 'XamlExplorerHostIslandWindow', 'ForegroundStaging', 'MultitaskingViewFrame', 'TaskManagerWindow', 'ConsoleWindowClass']);

export function parseInfo(line) {
  if (!line) return null;
  const [hwnd, pid, cls, style, ex, owned, cloaked, visible, iconic, zoomed, rect, ...title] = line.split('\t');
  const [left, top, right, bottom] = rect.split(' ').map(Number);
  return { hwnd, pid: Number(pid), cls, style: Number(style), ex: Number(ex), owned: owned === '1', cloaked: cloaked === '1', visible: visible === '1', iconic: iconic === '1', zoomed: zoomed === '1', rect: { left, top, right, bottom }, title: title.join('\t') };
}

// An ordinary app window: visible, with a title bar, not a dialog (those stay
// with their app, above it), not a tool or always-on-top window, not Windows'
// own shell, not Scorpion's.
export function frameable(info, { selfPid = process.pid, skip = new Set() } = {}) {
  if (!info || !info.visible || info.cloaked || info.owned || !info.title) return false;
  if ((info.style & WS_CAPTION) !== WS_CAPTION) return false;
  if (info.ex & (WS_EX_TOOLWINDOW | WS_EX_TOPMOST)) return false;
  if (SHELL_CLASSES.has(info.cls) || info.pid === selfPid || skip.has(info.hwnd)) return false;
  return true;
}

let deps = null; // { dataDir, panelToScreen(rect) -> physical rect, notify(info|null), icon(hwnd) }
let panel = null; // physical pixels { x, y, w, h }
let current = null; // { hwnd, title, style, rect, pid }
let last = null; // the app parked while a place covers the orb
let timer = 0;
let busy = false;
const refused = new Set(); // windows that would not lose their title bar
const released = new Set(); // popped out by the user: left as normal windows

export function initFrame(d) { deps = d; }
const file = () => path.join(deps.dataDir, 'frame.json');
const save = () => { try { if (current) fs.writeFileSync(file(), JSON.stringify(current)); else fs.rmSync(file(), { force: true }); } catch { /* best effort */ } };
const run = (script) => win.runPsKept(`${FRAME} ${script}`);
const ptr = (hwnd) => `([IntPtr][long]${win.psQuote(hwnd)})`;
const near = (a, b) => Math.abs(a - b) <= 3;

async function frame(hwnd) {
  if (!panel) return false;
  last = null; // a new app in front replaces the one tucked away
  let info = parseInfo(await run(`[ScorpionFrame]::Info(${ptr(hwnd)})`));
  if (!info || !frameable({ ...info, visible: true }, { skip: refused })) return false;
  // Its normal size and place are only known once it is neither minimized
  // nor maximized.
  if (info.iconic || info.zoomed) {
    await run(`[ScorpionFrame]::Restore(${ptr(hwnd)})`);
    info = parseInfo(await run(`[ScorpionFrame]::Info(${ptr(hwnd)})`)) || info;
  }
  if (current && current.hwnd !== hwnd) await release({ minimize: true });
  const ok = (await run(`[ScorpionFrame]::Frame(${ptr(hwnd)}, ${panel.x}, ${panel.y}, ${panel.w}, ${panel.h})`)) === 'True';
  // Its own size and place before (a maximized window comes back restored).
  current = { hwnd, title: info.title, pid: info.pid, style: info.style, rect: info.rect };
  if (!ok) {
    // The app refused (often one running as administrator): give it back.
    refused.add(hwnd);
    await release({ minimize: false });
    return false;
  }
  released.delete(hwnd);
  save();
  deps.notify(view());
  return true;
}

async function release({ minimize }) {
  const c = current;
  if (!c) return;
  current = null;
  save();
  const { left, top, right, bottom } = c.rect;
  await run(`[ScorpionFrame]::Release(${ptr(c.hwnd)}, ${c.style}, ${left}, ${top}, ${right - left}, ${bottom - top}, $${minimize ? 'true' : 'false'})`).catch(() => {});
  deps.notify(null);
}

const view = () => (current ? { hwnd: current.hwnd, title: current.title } : null);

// Every 0.6 s while the orb is open: frame the app the user brought to the
// front, keep the framed one in its panel, notice when it closed.
async function tick() {
  if (busy || !panel) return;
  busy = true;
  try {
    const fg = parseInfo(await run('[ScorpionFrame]::Fg()'));
    if (fg && fg.hwnd !== current?.hwnd && !released.has(fg.hwnd) && frameable(fg, { skip: refused })) {
      await frame(fg.hwnd);
      return;
    }
    if (!current) return;
    const info = parseInfo(await run(`[ScorpionFrame]::Info(${ptr(current.hwnd)})`));
    if (!info || !info.visible) { current = null; save(); deps.notify(null); return; } // closed
    if (info.iconic) { await release({ minimize: true }); return; } // minimized from elsewhere
    if (info.title !== current.title) { current.title = info.title; deps.notify(view()); }
    const r = info.rect;
    if (!near(r.left, panel.x) || !near(r.top, panel.y) || !near(r.right - r.left, panel.w) || !near(r.bottom - r.top, panel.h)) {
      await run(`[ScorpionFrame]::Place(${ptr(current.hwnd)}, ${panel.x}, ${panel.y}, ${panel.w}, ${panel.h})`);
    }
  } catch { /* PowerShell busy or restarting: next tick */ } finally {
    busy = false;
  }
}

// From the orb page: where the panel is (CSS pixels in Scorpion's window), or
// null when the orb closes.
export async function setPanel(rect) {
  if (!rect) {
    clearInterval(timer);
    timer = 0;
    panel = null;
    last = null;
    await release({ minimize: false });
    return;
  }
  panel = deps.panelToScreen(rect);
  if (!timer) timer = setInterval(tick, 600);
  if (current) await run(`[ScorpionFrame]::Place(${ptr(current.hwnd)}, ${panel.x}, ${panel.y}, ${panel.w}, ${panel.h})`).catch(() => {});
}

// A place (Files, Settings…) covers the orb: tuck the app away until "back".
export async function setAway(away) {
  if (away) { last = current?.hwnd || null; await release({ minimize: true }); }
  else if (last) { const h = last; last = null; await frame(h); }
}

export async function action(what, { windows = [] } = {}) {
  if (what === 'orb') return release({ minimize: true });
  if (what === 'popout') { if (current) released.add(current.hwnd); return release({ minimize: false }); }
  if (what === 'close') { if (current) await win.windowByHandle(current.hwnd, 'close'); return true; }
  if (what === 'prev' || what === 'next') {
    const list = windows.filter((w) => !refused.has(w.hwnd));
    if (!list.length) return false;
    const i = list.findIndex((w) => w.hwnd === current?.hwnd);
    const next = list[(i < 0 ? 0 : i + (what === 'next' ? 1 : -1) + list.length) % list.length];
    return frame(next.hwnd);
  }
  throw new Error('Unknown action');
}

// The framed app back on top (Scorpion came forward in full mode).
export async function raise() {
  if (current && panel) await run(`[ScorpionFrame]::Place(${ptr(current.hwnd)}, ${panel.x}, ${panel.y}, ${panel.w}, ${panel.h})`);
}
export const hasPanel = () => Boolean(panel);
// The app in front, if it is an ordinary app window (not Scorpion, not Windows' own).
export async function foregroundApp() {
  const fg = parseInfo(await run('[ScorpionFrame]::Fg()'));
  return fg && !released.has(fg.hwnd) && frameable(fg, { skip: refused }) ? fg : null;
}

export const frameWindow = (hwnd) => { released.delete(String(hwnd)); return frame(String(hwnd)); };

// ---------- the air mouse ----------
// Hand positions (0..1 across the camera) map onto the framed app's panel,
// stretched a little so the edges are reachable. The pointer never leaves the
// panel, so a gesture can only ever click inside the app the user is looking at.
const clamp01 = (v) => Math.max(0, Math.min(1, v));
export function toPanel(p, area) {
  return {
    x: Math.round(area.x + clamp01((p.x - 0.5) * 1.7 + 0.5) * (area.w - 1)),
    y: Math.round(area.y + clamp01((p.y - 0.5) * 1.7 + 0.5) * (area.h - 1)),
  };
}
let pendingMove = null;
let moving = false;
const mouseRun = (script) => win.runPsKept(`${MOUSE} ${script}`);

// cmd: { move: p } | { click: 'left'|'right'|'double', at: p } |
// { drag: 'start'|'move'|'end', at: p } | { wheel: notches, ctrl?: true, at?: p }
// area: physical screen pixels { x, y, w, h }; by default the framed app's panel
// (hands replacing the mouse pass the whole screen).
export async function mouse(cmd = {}, { area = null } = {}) {
  const a = area || (panel && current ? panel : null);
  if (!a) return false;
  if (cmd.move) {
    // Moves arrive many times a second: only the newest one waiting counts.
    pendingMove = toPanel(cmd.move, a);
    if (moving) return true;
    moving = true;
    try {
      while (pendingMove) { const m = pendingMove; pendingMove = null; await mouseRun(`[ScorpionMouse]::Move(${m.x}, ${m.y})`); }
    } finally { moving = false; }
    return true;
  }
  const at = cmd.at ? toPanel(cmd.at, a) : { x: Math.round(a.x + a.w / 2), y: Math.round(a.y + a.h / 2) };
  pendingMove = null;
  if (cmd.click) return mouseRun(`[ScorpionMouse]::Click(${at.x}, ${at.y}, $${cmd.click === 'right'}, ${cmd.click === 'double' ? 2 : 1})`).then(() => true);
  if (cmd.drag === 'start') return mouseRun(`[ScorpionMouse]::Down(${at.x}, ${at.y})`).then(() => true);
  if (cmd.drag === 'move') return mouseRun(`[ScorpionMouse]::Move(${at.x}, ${at.y})`).then(() => true);
  if (cmd.drag === 'end') return mouseRun(`[ScorpionMouse]::Up(${at.x}, ${at.y})`).then(() => true);
  if (cmd.wheel) {
    const n = Math.max(-20, Math.min(20, Math.round(cmd.wheel)));
    if (!n) return false;
    // The wheel goes to whatever is under the pointer: keep it in the area.
    const where = cmd.at ? at : await mouseRun('[ScorpionMouse]::Pos()').then((o) => {
      const [x, y] = o.split(' ').map(Number);
      return x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h ? { x, y } : at;
    }).catch(() => at);
    return mouseRun(`[ScorpionMouse]::Wheel(${where.x}, ${where.y}, ${n}, $${Boolean(cmd.ctrl)})`).then(() => true);
  }
  return false;
}
export const framed = () => view();

// An app left framed when Scorpion stopped unexpectedly: its window back.
export async function recover() {
  let c = null;
  try { c = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return; }
  fs.rmSync(file(), { force: true });
  // Only the same window of the same program (window numbers get reused).
  const info = parseInfo(await run(`[ScorpionFrame]::Info(${ptr(c.hwnd)})`).catch(() => ''));
  if (!info || info.pid !== c.pid) return;
  current = c;
  await release({ minimize: false });
}

// A window's state (style, place, minimized…), for checks.
export const windowInfo = async (hwnd) => parseInfo(await run(`[ScorpionFrame]::Info(${ptr(String(hwnd))})`).catch(() => ''));
