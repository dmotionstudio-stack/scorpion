// Apps open inside the orb: while the orb is open, an app that comes to the front loses its
// title bar and border and is placed in its own tile on the orb's stage (kept on top of
// Scorpion), with Scorpion's own title bar above it. Several apps at once, side by side
// like Windows Snap (shared/tiles.js decides the tiles; this puts the windows there).
// Leaving the orb or quitting Scorpion gives every app its normal window back; if Scorpion
// stops unexpectedly, the next start does it (frame.json).
//
// Nothing is hidden or closed behind the user's back: the framed apps are the real
// programs, working normally.
import fs from 'node:fs';
import path from 'node:path';
import * as win from './windows-control.js';
import * as helper from './win-helper.js';

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
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr h, IntPtr rgn, bool redraw);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref PT p);
  [DllImport("gdi32.dll")] static extern int CombineRgn(IntPtr dst, IntPtr a, IntPtr b, int mode);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
  public struct PT { public int X, Y; }
  [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int l, int t, int r, int b);
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
  // The smallest size the app lets its window be (WM_GETMINMAXINFO), in physical pixels: "w h".
  public static string MinSize(IntPtr h) {
    Dpi();
    IntPtr p = Marshal.AllocHGlobal(40);
    try {
      for (int i = 0; i < 40; i += 4) Marshal.WriteInt32(p, i, 0);
      SendMessage(h, 0x24, IntPtr.Zero, p);
      return Marshal.ReadInt32(p, 24) + " " + Marshal.ReadInt32(p, 28);
    } catch { return "0 0"; } finally { Marshal.FreeHGlobal(p); }
  }
  // The height of the title bar that apps like Calculator draw themselves (32 at 100%).
  public static int Caption(IntPtr h) { Dpi(); uint d = GetDpiForWindow(h); if (d == 0) d = 96; return (int)Math.Round(32.0 * d / 96.0); }
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
  // An app that keeps its own title bar and its own minimize, maximize and close buttons: the window goes up
  // by that much and its top is cut off, so only what is under the title bar shows in the tile.
  public static void PlaceClipped(IntPtr h, int x, int y, int w, int hh, int clip) {
    Dpi();
    SetWindowPos(h, new IntPtr(-1), x, y - clip, w, hh + clip, 0x0010 | 0x0040);
    SetWindowRgn(h, CreateRectRgn(0, clip, w, hh + clip), true);
  }
  public static void Unclip(IntPtr h) { SetWindowRgn(h, IntPtr.Zero, true); }
  // How far down the window's content starts: the title bar Windows draws (about 32 at 100%), or about 0 when the app draws its own.
  public static int NcTop(IntPtr h) { Dpi(); RECT w; GetWindowRect(h, out w); PT p; p.X = 0; p.Y = 0; ClientToScreen(h, ref p); return p.Y - w.T; }
  // Only the top right corner, where an app's minimize, maximize and close buttons are, is cut out; the rest of its title bar stays.
  public static void PlaceNotched(IntPtr h, int x, int y, int w, int hh, int nw, int nh) {
    Dpi();
    SetWindowPos(h, new IntPtr(-1), x, y, w, hh, 0x0010 | 0x0040);
    IntPtr full = CreateRectRgn(0, 0, w, hh);
    IntPtr cut = CreateRectRgn(Math.Max(0, w - nw), 0, w, nh);
    CombineRgn(full, full, cut, 4);
    DeleteObject(cut);
    SetWindowRgn(h, full, true);
  }
  // An app that will not get as small as its tile (its smallest size is bigger): the window keeps that size, from the tile's top left,
  // and only the tile's part of it shows (a region), so nothing spills over the orb, the taskbar or the next tile. clip: the title bar
  // strip cut off at the top; nw, nh: the corner with the app's own buttons.
  public static void PlaceFit(IntPtr h, int x, int y, int w, int hh, int ww, int wh, int clip, int nw, int nh) {
    Dpi();
    SetWindowPos(h, new IntPtr(-1), x, y - clip, ww, wh + clip, 0x0010 | 0x0040);
    int vw = Math.Min(w, ww), vh = Math.Min(hh, wh);
    IntPtr full = CreateRectRgn(0, clip, vw, clip + vh);
    if (nh > 0) { IntPtr cut = CreateRectRgn(Math.Max(0, vw - nw), clip, vw, clip + nh); CombineRgn(full, full, cut, 4); DeleteObject(cut); }
    SetWindowRgn(h, full, true);
  }
  // The normal window back: its own style, size and place, not on top.
  public static void Release(IntPtr h, int style, int x, int y, int w, int hh, bool minimize, bool top = false) {
    Dpi();
    if (!IsWindow(h)) return;
    SetWindowRgn(h, IntPtr.Zero, true);
    SetWindowLong(h, -16, style);
    SetWindowPos(h, new IntPtr(top ? -1 : -2), x, y, w, hh, 0x0020 | 0x0010);
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
const WS_MINIMIZEBOX = 0x20000;
const WS_MAXIMIZEBOX = 0x10000;
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
// Why a window cannot be framed, in words (null: it can). (An always-on-top flag is no reason: many apps carry it.) Windows with a title bar of their own, and the ones that
// draw their own (ChatGPT, Claude, VS Code…: no Windows title bar, but minimize and maximize boxes) are framed.
export function whyNotFramed(info, { selfPid = process.pid, skip = new Set() } = {}) {
  if (!info) return 'it is not there any more';
  if (!info.visible || info.cloaked) return 'it is hidden';
  if (info.owned) return 'it is a dialog that belongs to another window';
  if (!info.title) return 'it has no title';
  if (SHELL_CLASSES.has(info.cls)) return 'it is part of Windows itself';
  if (info.pid === selfPid) return 'it is Scorpion';
  if (skip.has(info.hwnd)) return 'it would not give up its title bar (an app running as administrator cannot be framed)';
  if (info.ex & WS_EX_TOOLWINDOW) return 'it is a tool window';
  const style = info.style >>> 0;
  const caption = (style & WS_CAPTION) === WS_CAPTION;
  const own = !caption && (style & (WS_MINIMIZEBOX | WS_MAXIMIZEBOX)) !== 0 && (info.iconic || (info.rect.right - info.rect.left >= 200 && info.rect.bottom - info.rect.top >= 120));
  if (!caption && !own) return 'it is not a normal window (a pop-up or a full-screen window)';
  return null;
}
export const frameable = (info, opts) => whyNotFramed(info, opts) === null;
// Whether a window draws its own title bar (no Windows one): its own minimize, maximize and close buttons are inside it.
export const drawsOwnTitleBar = (info) => (((info?.style ?? 0) >>> 0) & WS_CAPTION) !== WS_CAPTION;

let deps = null; // { dataDir, panelToScreen(rect) -> physical rect, notify(views|null) }
let panel = null; // the stage, physical pixels { x, y, w, h }
const tiles = new Map(); // window number -> { hwnd, title, pid, style, rect (its own, to give back), at (its tile, physical) }
let parked = []; // the apps tucked away while a place covers the orb
let focus = null; // the tile the user used last
let timer = 0;
let busy = false;
const refused = new Set(); // windows that would not lose their title bar
let lastWhy = ''; // why the last window asked for could not be framed
export const lastReason = () => lastWhy;
const released = new Set(); // popped out by the user: left as normal windows
export const MAX_FRAMED = 6; // more stay ordinary windows

export function initFrame(d) { deps = d; }
const file = () => path.join(deps.dataDir, 'frame.json');
const save = () => { try { if (tiles.size) fs.writeFileSync(file(), JSON.stringify([...tiles.values()].map(({ hwnd, pid, style, rect, top }) => ({ hwnd, pid, style, rect, top })))); else fs.rmSync(file(), { force: true }); } catch { /* best effort */ } };
const run = (script) => win.runPsKept(`${FRAME} ${script}`);
const ptr = (hwnd) => `([IntPtr][long]${win.psQuote(hwnd)})`;
const near = (a, b) => Math.abs(a - b) <= 3;
const sameRect = (info, at) => near(info.rect.left, at.x) && near(info.rect.top, at.y) && near(info.rect.right - info.rect.left, at.w) && near(info.rect.bottom - info.rect.top, at.h);
const UWP_FRAME = 'ApplicationFrameWindow'; // Store apps keep their own title bar with its three buttons
// The trim (clipDip): 0 none; 1 the corner with the app's own minimize, maximize and close buttons; 32, 40, 48 the top strip, in points.
// The window's size: its tile's, or its own smallest size when that is bigger (then only the tile's part shows).
const winSize = (t) => ({ w: Math.max(t.at.w, t.min?.w || 0), h: Math.max(t.at.h, t.min?.h || 0) });
const placeScript = (t) => { const s = winSize(t); return s.w > t.at.w || s.h > t.at.h ? `[ScorpionFrame]::PlaceFit(${ptr(t.hwnd)}, ${t.at.x}, ${t.at.y}, ${t.at.w}, ${t.at.h}, ${s.w}, ${s.h}, ${t.clip || 0}, ${t.clipDip === 1 ? Math.round(150 * (t.scale || 1)) : 0}, ${t.clipDip === 1 ? Math.round(36 * (t.scale || 1)) : 0})` : placeOne(t); };
const placeOne = (t) => (t.clipDip === 1 ? `[ScorpionFrame]::PlaceNotched(${ptr(t.hwnd)}, ${t.at.x}, ${t.at.y}, ${t.at.w}, ${t.at.h}, ${Math.round(150 * (t.scale || 1))}, ${Math.round(36 * (t.scale || 1))})` : t.clip ? `[ScorpionFrame]::PlaceClipped(${ptr(t.hwnd)}, ${t.at.x}, ${t.at.y}, ${t.at.w}, ${t.at.h}, ${t.clip})` : `[ScorpionFrame]::Place(${ptr(t.hwnd)}, ${t.at.x}, ${t.at.y}, ${t.at.w}, ${t.at.h})`);
// Where the window itself is when it sits in its tile (a clipped one starts above it).
const expected = (t) => { const s = winSize(t); return { x: t.at.x, y: t.at.y - (t.clip || 0), w: s.w, h: s.h + (t.clip || 0) }; };

// min: the least room its tile needs for the app to fit (physical pixels; its title bar, if clipped, is not counted).
const views = () => [...tiles.values()].map((t) => ({ hwnd: t.hwnd, title: t.title, orig: t.rect, focus: t.hwnd === focus, min: t.min || null, clip: t.clipDip || 0 }));
const view = () => (tiles.size ? views() : null);
const tell = () => deps.notify(view());

// Frame an app: its title bar and border off, on top, in a tile. Until the page says where its tile is,
// it stays where it is. False: the app refused, or it is not an app window.
async function frame(hwnd) {
  const why = (m) => { lastWhy = m; if (process.env.SCORPION_FRAME_DEBUG) console.log('[frame]', hwnd, m); return false; };
  lastWhy = '';
  if (!panel) return why('the orb is not open');
  if (tiles.has(hwnd)) return true;
  if (tiles.size >= MAX_FRAMED) return why(`the orb already has ${MAX_FRAMED} apps`);
  let info = parseInfo(await run(`[ScorpionFrame]::Info(${ptr(hwnd)})`));
  const reason = whyNotFramed(info && { ...info, visible: true }, { skip: refused });
  if (reason) return why(reason);
  // Its normal size and place are only known once it is neither minimized nor maximized.
  if (info.iconic || info.zoomed) {
    await run(`[ScorpionFrame]::Restore(${ptr(hwnd)})`);
    info = parseInfo(await run(`[ScorpionFrame]::Info(${ptr(hwnd)})`)) || info;
  }
  const r = info.rect;
  // Measured before its title bar goes: a window with the one Windows draws starts its content about 32 points down; one that
  // draws its own (Chromium apps keep the flag but draw their own, as ChatGPT and Claude do) starts it at the top.
  const capPx = Number(await run(`[ScorpionFrame]::Caption(${ptr(hwnd)})`).catch(() => 0)) || 32;
  const scale = capPx / 32;
  const ncTop = Number(await run(`[ScorpionFrame]::NcTop(${ptr(hwnd)})`).catch(() => 99));
  const ok = (await run(`[ScorpionFrame]::Frame(${ptr(hwnd)}, ${r.left}, ${r.top}, ${r.right - r.left}, ${r.bottom - r.top})`)) === 'True';
  if (!ok) {
    // The app refused (often one running as administrator): give it back.
    refused.add(hwnd);
    why('it would not give up its title bar (an app running as administrator cannot be framed)');
    await run(`[ScorpionFrame]::Release(${ptr(hwnd)}, ${info.style}, ${r.left}, ${r.top}, ${r.right - r.left}, ${r.bottom - r.top}, $false, $${info.ex & WS_EX_TOPMOST ? 'true' : 'false'})`).catch(() => {});
    return false;
  }
  released.delete(hwnd);
  // The title bar it keeps (Store apps) is cut off; the smallest size it allows is told to the page, so its tile is never too small.
  // An app that draws its own title bar (Store apps, and ChatGPT, Claude… with no Windows one) has its own minimize, maximize
  // and close buttons inside it: the top of the window, 32 (at 100%) or more points, is cut off, so only Scorpion's show.
  // The cut can be made taller or shorter per app (the button in its title bar), and is remembered.
  const store = info.cls === UWP_FRAME; // Store apps: the whole strip, with the title Windows draws for them
  const own = store || drawsOwnTitleBar(info) || ncTop < 20 * scale;
  const exe = String(await run(`(Get-Process -Id ${info.pid} -ErrorAction SilentlyContinue).Path`).catch(() => '')).trim().toLowerCase();
  const saved = deps.clips?.()?.[exe];
  const clipDip = [0, 1, 32, 40, 48].includes(saved) ? saved : store ? 32 : own ? 1 : 0;
  const clip = clipDip >= 32 ? Math.round(clipDip * scale) : 0;
  if (process.env.SCORPION_FRAME_DEBUG) console.log('[frame]', hwnd, 'own title bar:', own, '| content starts', ncTop, 'px down | program:', exe, '| saved:', saved, '| trim:', clipDip, '| style 0x' + (info.style >>> 0).toString(16));
  const [mw, mh] = String(await run(`[ScorpionFrame]::MinSize(${ptr(hwnd)})`).catch(() => '0 0')).trim().split(' ').map(Number);
  const min = { w: Math.max(0, mw || 0), h: Math.max(0, (mh || 0) - clip) };
  tiles.set(hwnd, { hwnd, title: info.title, pid: info.pid, style: info.style, top: Boolean(info.ex & WS_EX_TOPMOST), rect: r, clip, clipDip, scale, exe, rawMinH: mh || 0, min, at: { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top } });
  focus = hwnd;
  save();
  tell();
  return true;
}

// Give one app its normal window back (its own style, size and place), minimized or not.
async function release(hwnd, { minimize }) {
  const t = tiles.get(hwnd);
  if (!t) return;
  tiles.delete(hwnd);
  if (focus === hwnd) focus = tiles.keys().next().value || null;
  save();
  const { left, top, right, bottom } = t.rect;
  await run(`[ScorpionFrame]::Release(${ptr(hwnd)}, ${t.style}, ${left}, ${top}, ${right - left}, ${bottom - top}, $${minimize ? 'true' : 'false'}, $${t.top ? 'true' : 'false'})`).catch(() => {});
  tell();
}
const releaseAll = async ({ minimize }) => { for (const h of [...tiles.keys()]) await release(h, { minimize }); };

// Every 0.6 s while the orb is open: frame the app the user brought to the front, keep every framed app in
// its tile, notice when one closed or was minimized from elsewhere.
async function tick() {
  if (busy || !panel) return;
  busy = true;
  try {
    const fg = parseInfo(await run('[ScorpionFrame]::Fg()'));
    if (fg && tiles.has(fg.hwnd)) focus = fg.hwnd;
    else if (fg && !process.env.SCORPION_NO_AUTOFRAME && !released.has(fg.hwnd) && frameable(fg, { skip: refused }) && tiles.size < MAX_FRAMED) { await frame(fg.hwnd); return; } // (SCORPION_NO_AUTOFRAME: for tests that frame chosen windows only)
    if (!tiles.size) return;
    const out = await run([...tiles.keys()].map((h) => `[ScorpionFrame]::Info(${ptr(h)})`).join('; '));
    const infos = new Map(String(out || '').split('\n').map((l) => parseInfo(l.trim())).filter(Boolean).map((i) => [i.hwnd, i]));
    let changed = false;
    for (const t of [...tiles.values()]) {
      const info = infos.get(t.hwnd);
      if (!info || !info.visible) { if (process.env.SCORPION_FRAME_DEBUG) console.log('[frame]', t.hwnd, 'gone:', JSON.stringify(info)); tiles.delete(t.hwnd); changed = true; continue; } // closed
      if (info.iconic) { if (process.env.SCORPION_FRAME_DEBUG) console.log('[frame]', t.hwnd, 'minimized'); await release(t.hwnd, { minimize: true }); continue; } // minimized from elsewhere
      if (info.title !== t.title) { t.title = info.title; changed = true; }
      const want = expected(t);
      if (!sameRect(info, want)) {
        if (process.env.SCORPION_FRAME_DEBUG) console.log('[frame]', t.hwnd, 'moved by the app: it is at', JSON.stringify(info.rect), 'want', JSON.stringify(want));
        const w = info.rect.right - info.rect.left;
        const h = info.rect.bottom - info.rect.top - (t.clip || 0);
        // The window would not get as small as its tile: that is its smallest size. Told to the page, which makes the tile big enough.
        // Only once it has stayed bigger for a few checks (it may still be getting to its tile).
        if (w > want.w + 3 || h > want.h - (t.clip || 0) + 3) {
          t.over = (t.over || 0) + 1;
          if (t.over >= 3) {
            const next = { w: Math.max(t.min?.w || 0, w > want.w + 3 ? w : 0), h: Math.max(t.min?.h || 0, h > t.at.h + 3 ? h : 0) };
            if (!t.min || next.w !== t.min.w || next.h !== t.min.h) { t.min = next; changed = true; }
          }
        } else t.over = 0;
        await run(placeScript(t));
      }
    }
    if (changed) { if (!tiles.has(focus)) focus = tiles.keys().next().value || null; save(); tell(); }
  } catch { /* PowerShell busy or restarting: next tick */ } finally {
    busy = false;
  }
}

// From the orb page: the stage (CSS pixels in Scorpion's window), or null when the orb closes.
export async function setPanel(rect) {
  if (!rect) {
    clearInterval(timer);
    timer = 0;
    panel = null;
    parked = [];
    await releaseAll({ minimize: false });
    return;
  }
  panel = deps.panelToScreen(rect);
  if (!timer) timer = setInterval(tick, 600);
}

// Where each tile is (CSS pixels): [{ hwnd, x, y, w, h }]. The newest layout wins while one is being placed.
let layoutBusy = false;
let layoutNext = null;
export async function setLayout(rects) {
  layoutNext = rects;
  if (layoutBusy) return true;
  layoutBusy = true;
  try {
    while (layoutNext) {
      const list = layoutNext;
      layoutNext = null;
      for (const r of list) {
        const t = tiles.get(String(r.hwnd));
        if (!t) continue;
        const p = deps.panelToScreen({ x: r.x, y: r.y, width: r.w, height: r.h });
        t.at = { x: p.x, y: p.y, w: p.w, h: p.h };
        await run(placeScript(t)).catch(() => {});
      }
    }
  } finally { layoutBusy = false; }
  return true;
}

// A place (Files, Settings…) covers the orb: tuck the apps away until "back".
export async function setAway(away) {
  if (away) { parked = [...tiles.keys()]; await releaseAll({ minimize: true }); }
  else { const list = parked; parked = []; for (const h of list) await frame(h); }
}

// hwnd: the tile a button belongs to. popout: its normal window; minimize: tucked away; close: closed (it
// can still ask to save); focus: in front; minimizeAll: every app tucked away.
export async function action(what, { hwnd = null, dip = 0 } = {}) {
  const h = hwnd ? String(hwnd) : focus;
  if (what === 'clip') { // the trim of the app's own title bar: 0 none, 1 its caption buttons, 32 / 40 / 48 the top strip (points)
    const t = tiles.get(h);
    if (!t) return false;
    const v = [0, 1, 32, 40, 48].includes(Number(dip)) ? Number(dip) : 0;
    t.clipDip = v;
    t.clip = v >= 32 ? Math.round(v * (t.scale || 1)) : 0;
    t.min = { w: t.min?.w || 0, h: Math.max(0, (t.rawMinH || 0) - t.clip) };
    if (!t.clip) await run(`[ScorpionFrame]::Unclip(${ptr(h)})`).catch(() => {});
    await run(placeScript(t)).catch(() => {});
    if (t.exe) deps.setClip?.(t.exe, v);
    tell();
    return true;
  }
  if (what === 'minimizeAll') { await releaseAll({ minimize: true }); return true; }
  if (what === 'popout') { if (h) released.add(h); return release(h, { minimize: false }); }
  if (what === 'minimize') return release(h, { minimize: true });
  if (what === 'close') { if (h) await win.windowByHandle(h, 'close'); return true; }
  if (what === 'focus') { if (h && tiles.has(h)) { focus = h; await run(`[ScorpionFrame]::Place(${ptr(h)}, ${tiles.get(h).at.x}, ${tiles.get(h).at.y}, ${tiles.get(h).at.w}, ${tiles.get(h).at.h})`); } return true; }
  throw new Error('Unknown action');
}

// The framed apps back on top (Scorpion came forward in full mode).
export async function raise() {
  if (panel) for (const t of tiles.values()) await run(placeScript(t)).catch(() => {});
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
// The helper when it's there (a move in a millisecond, so a moving hand keeps
// up); else the same through PowerShell.
const PS_MOUSE = {
  move: (x, y) => `[ScorpionMouse]::Move(${x}, ${y})`,
  click: (x, y, right, times) => `[ScorpionMouse]::Click(${x}, ${y}, ${right === 1}, ${times})`,
  down: (x, y) => `[ScorpionMouse]::Down(${x}, ${y})`,
  up: (x, y) => `[ScorpionMouse]::Up(${x}, ${y})`,
  wheel: (x, y, n, ctrl) => `[ScorpionMouse]::Wheel(${x}, ${y}, ${n}, ${ctrl === 1})`,
  pos: () => '[ScorpionMouse]::Pos()',
};
async function mouseDo(cmd, ...args) {
  if (helper.helperUsable()) { try { return await helper.call(cmd, ...args); } catch { /* PowerShell below */ } }
  return mouseRun(PS_MOUSE[cmd](...args));
}

// cmd: { move: p } | { click: 'left'|'right'|'double', at: p } |
// { drag: 'start'|'move'|'end', at: p } | { wheel: notches, ctrl?: true, at?: p }
// area: physical screen pixels { x, y, w, h }; by default the framed app's panel
// (hands replacing the mouse pass the whole screen).
export async function mouse(cmd = {}, { area = null } = {}) {
  const t = tiles.get(focus) || tiles.values().next().value;
  const a = area || (panel && t ? t.at : null);
  if (!a) return false;
  if (cmd.move) {
    // Moves arrive many times a second: only the newest one waiting counts.
    pendingMove = toPanel(cmd.move, a);
    if (moving) return true;
    moving = true;
    try {
      while (pendingMove) { const m = pendingMove; pendingMove = null; await mouseDo('move', m.x, m.y); }
    } finally { moving = false; }
    return true;
  }
  const at = cmd.at ? toPanel(cmd.at, a) : { x: Math.round(a.x + a.w / 2), y: Math.round(a.y + a.h / 2) };
  pendingMove = null;
  if (cmd.click) return mouseDo('click', at.x, at.y, cmd.click === 'right' ? 1 : 0, cmd.click === 'double' ? 2 : 1).then(() => true);
  if (cmd.drag === 'start') return mouseDo('down', at.x, at.y).then(() => true);
  if (cmd.drag === 'move') return mouseDo('move', at.x, at.y).then(() => true);
  if (cmd.drag === 'end') return mouseDo('up', at.x, at.y).then(() => true);
  if (cmd.wheel) {
    const n = Math.max(-20, Math.min(20, Math.round(cmd.wheel)));
    if (!n) return false;
    // The wheel goes to whatever is under the pointer: keep it in the area.
    const where = cmd.at ? at : await mouseDo('pos').then((o) => {
      const [x, y] = o.split(' ').map(Number);
      return x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h ? { x, y } : at;
    }).catch(() => at);
    return mouseDo('wheel', where.x, where.y, n, cmd.ctrl ? 1 : 0).then(() => true);
  }
  return false;
}
export const framed = () => view();
export const framedCount = () => tiles.size;

// Apps left framed when Scorpion stopped unexpectedly: their windows back.
export async function recover() {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return; }
  fs.rmSync(file(), { force: true });
  if (!Array.isArray(list)) list = [list];
  for (const c of list) {
    // Only the same window of the same program (window numbers get reused).
    const info = parseInfo(await run(`[ScorpionFrame]::Info(${ptr(c.hwnd)})`).catch(() => ''));
    if (!info || info.pid !== c.pid) continue;
    tiles.set(String(c.hwnd), { hwnd: String(c.hwnd), title: info.title, pid: c.pid, style: c.style, top: Boolean(c.top), rect: c.rect, at: c.rect });
    await release(String(c.hwnd), { minimize: false });
  }
}

// A window's state (style, place, minimized…), for checks.
export const windowInfo = async (hwnd) => parseInfo(await run(`[ScorpionFrame]::Info(${ptr(String(hwnd))})`).catch(() => ''));
