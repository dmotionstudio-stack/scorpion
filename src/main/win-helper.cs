// Scorpion's helper on Windows (win-helper.js builds and runs it): lists the
// open windows, works them, moves the mouse, types (Type what I say) and keeps
// the taskbar's room as an app bar, answering each request over a pipe in a
// millisecond or two.
//
// One request per line on stdin:  id <TAB> command <TAB> arguments...
// One answer per line on stdout:  id <TAB> ok|err <TAB> result
// A list comes back as records split by \x1e, their fields by \x1f.
// It ends when stdin closes (Scorpion went away).
//
// C# 5 (the compiler that comes with Windows' .NET Framework 4).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class ScorpionHelper {
  // ---------- windows ----------
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder name, ref int size);

  static string Clean(string s) {
    return (s ?? "").Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ').Replace('\x1e', ' ').Replace('\x1f', ' ');
  }

  // A program's path from its process id (works for most processes, elevated ones aside).
  static string ExePath(uint pid) {
    IntPtr h = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
    if (h == IntPtr.Zero) return "";
    try {
      var sb = new StringBuilder(1024);
      int size = sb.Capacity;
      return QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString() : "";
    } finally { CloseHandle(h); }
  }

  // The same windows as windows-control.js's PowerShell list: visible, not
  // owned (dialogs belong to their app), not tool windows, not cloaked, with
  // a title. hwnd, pid, process, in front, path, minimized, title.
  static string Windows() {
    var fg = GetForegroundWindow();
    var names = new Dictionary<uint, string[]>();
    var rows = new List<string>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true;
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true;
      int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512); if (sb.Length == 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      string[] who;
      if (!names.TryGetValue(pid, out who)) {
        string exe = ExePath(pid);
        string name = exe.Length > 0 ? Path.GetFileNameWithoutExtension(exe) : "";
        if (name.Length == 0) { try { name = Process.GetProcessById((int)pid).ProcessName; } catch { } }
        who = new string[] { name, exe };
        names[pid] = who;
      }
      rows.Add(string.Join("\x1f", new string[] { h.ToInt64().ToString(), pid.ToString(), Clean(who[0]), h == fg ? "1" : "0", Clean(who[1]), IsIconic(h) ? "1" : "0", Clean(sb.ToString()) }));
      return true;
    }, IntPtr.Zero);
    return string.Join("\x1e", rows.ToArray());
  }

  static void Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindowAsync(h, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); // a tap of Alt lets Windows hand over the foreground
    SetForegroundWindow(h);
  }

  // ---------- the mouse (screen pixels: this process is DPI aware) ----------
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, int dx, int dy, int data, UIntPtr e);
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr c);

  static void Click(int x, int y, bool right, int times) {
    SetCursorPos(x, y);
    for (int i = 0; i < times; i++) { mouse_event(right ? 0x8u : 0x2u, 0, 0, 0, UIntPtr.Zero); mouse_event(right ? 0x10u : 0x4u, 0, 0, 0, UIntPtr.Zero); }
  }
  static void Wheel(int x, int y, int notches, bool ctrl) {
    SetCursorPos(x, y);
    if (ctrl) keybd_event(0x11, 0, 0, UIntPtr.Zero);
    mouse_event(0x800, 0, 0, notches * 120, UIntPtr.Zero);
    if (ctrl) keybd_event(0x11, 0, 2, UIntPtr.Zero);
  }

  // ---------- the taskbar's room: an app bar (Windows' own way) ----------
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] struct APPBARDATA { public int cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge; public RECT rc; public IntPtr lParam; }
  [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA d);
  static readonly HashSet<long> bars = new HashSet<long>();

  // A window (Scorpion's taskbar) keeps a strip along an edge (0 left, 1 top,
  // 2 right, 3 bottom) for itself: apps maximize beside it. Windows takes the
  // room back by itself if the window goes. Returns the strip it got.
  static string AppBar(IntPtr h, uint edge, int l, int t, int r, int b) {
    var d = new APPBARDATA();
    d.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
    d.hWnd = h;
    if (!bars.Contains(h.ToInt64())) {
      d.uCallbackMessage = 0x8000 + 0x5C; // WM_APP + n: told to Scorpion's window, which ignores it
      if (SHAppBarMessage(0, ref d) == UIntPtr.Zero) throw new Exception("Windows didn't take the app bar");
      bars.Add(h.ToInt64());
    }
    int w = r - l, ht = b - t;
    d.uEdge = edge;
    d.rc.left = l; d.rc.top = t; d.rc.right = r; d.rc.bottom = b;
    SHAppBarMessage(2, ref d); // ABM_QUERYPOS: Windows moves it clear of other bars
    if (edge == 0) d.rc.right = d.rc.left + w;
    else if (edge == 2) d.rc.left = d.rc.right - w;
    else if (edge == 1) d.rc.bottom = d.rc.top + ht;
    else d.rc.top = d.rc.bottom - ht;
    SHAppBarMessage(3, ref d); // ABM_SETPOS
    return d.rc.left + " " + d.rc.top + " " + d.rc.right + " " + d.rc.bottom;
  }
  static void AppBarRemove(IntPtr h) {
    var d = new APPBARDATA();
    d.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
    d.hWnd = h;
    SHAppBarMessage(1, ref d); // ABM_REMOVE
    bars.Remove(h.ToInt64());
  }

  // ---------- typing (Type what I say) ----------
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);

  static INPUT Key(ushort vk, ushort scan, uint flags) {
    var i = new INPUT();
    i.type = 1; // keyboard
    i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags;
    return i;
  }
  // Text into whatever has the keyboard, as if typed: each character as
  // itself (any language), a line break as Enter. Base64 (UTF-8), since a
  // request is one line.
  static string Type(string b64) {
    var text = Encoding.UTF8.GetString(Convert.FromBase64String(b64)).Replace("\r\n", "\n");
    var keys = new List<INPUT>();
    foreach (char c in text) {
      if (c == '\n') { keys.Add(Key(0x0D, 0, 0)); keys.Add(Key(0x0D, 0, 2)); }
      else { keys.Add(Key(0, c, 4)); keys.Add(Key(0, c, 4 | 2)); } // KEYEVENTF_UNICODE (| KEYUP)
    }
    if (keys.Count == 0) return "0";
    uint sent = SendInput((uint)keys.Count, keys.ToArray(), Marshal.SizeOf(typeof(INPUT)));
    if (sent == 0) throw new Exception("Windows didn't take the typing (error " + Marshal.GetLastWin32Error() + ")");
    return (sent / 2).ToString();
  }
  // Backspace n times ("delete that").
  static string Erase(int n) {
    var keys = new List<INPUT>();
    for (int k = 0; k < Math.Min(n, 2000); k++) { keys.Add(Key(0x08, 0, 0)); keys.Add(Key(0x08, 0, 2)); }
    if (keys.Count > 0) SendInput((uint)keys.Count, keys.ToArray(), Marshal.SizeOf(typeof(INPUT)));
    return "";
  }
  // The window in front: hwnd, pid, program path, title.
  static string Foreground() {
    var h = GetForegroundWindow();
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    var t = new StringBuilder(512);
    GetWindowText(h, t, t.Capacity);
    return h.ToInt64() + "\x1f" + pid + "\x1f" + Clean(ExePath(pid)) + "\x1f" + Clean(t.ToString());
  }

  // ---------- requests ----------
  static IntPtr Hwnd(string s) { return new IntPtr(long.Parse(s)); }
  static int I(string s) { return int.Parse(s); }

  static string Run(string[] p) {
    switch (p[1]) {
      case "ping": return "pong";
      case "windows": return Windows();
      case "focus": Focus(Hwnd(p[2])); return "";
      case "minimize": ShowWindowAsync(Hwnd(p[2]), 6); return "";
      case "maximize": ShowWindowAsync(Hwnd(p[2]), 3); return "";
      case "restore": ShowWindowAsync(Hwnd(p[2]), 9); return "";
      case "close": PostMessage(Hwnd(p[2]), 0x0010, IntPtr.Zero, IntPtr.Zero); return ""; // like its X button: it may still ask to save
      case "move": SetCursorPos(I(p[2]), I(p[3])); return "";
      case "click": Click(I(p[2]), I(p[3]), p[4] == "1", I(p[5])); return "";
      case "down": SetCursorPos(I(p[2]), I(p[3])); mouse_event(0x2, 0, 0, 0, UIntPtr.Zero); return "";
      case "up": SetCursorPos(I(p[2]), I(p[3])); mouse_event(0x4, 0, 0, 0, UIntPtr.Zero); return "";
      case "wheel": Wheel(I(p[2]), I(p[3]), I(p[4]), p[5] == "1"); return "";
      case "pos": { POINT q; GetCursorPos(out q); return q.X + " " + q.Y; }
      case "appbar": return AppBar(Hwnd(p[2]), uint.Parse(p[3]), I(p[4]), I(p[5]), I(p[6]), I(p[7]));
      case "appbar-remove": AppBarRemove(Hwnd(p[2])); return "";
      case "type": return Type(p[2]);
      case "erase": return Erase(I(p[2]));
      case "foreground": return Foreground();
      default: throw new Exception("unknown request " + p[1]);
    }
  }

  public static void Main() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { } // per-monitor: real screen pixels
    var utf8 = new UTF8Encoding(false);
    var input = new StreamReader(Console.OpenStandardInput(), utf8);
    var output = new StreamWriter(Console.OpenStandardOutput(), utf8);
    output.AutoFlush = true;
    string line;
    while ((line = input.ReadLine()) != null) {
      var p = line.Split('\t');
      if (p.Length < 2) continue;
      string result; bool ok = true;
      try { result = Run(p); } catch (Exception e) { ok = false; result = Clean(e.Message); }
      output.WriteLine(p[0] + "\t" + (ok ? "ok" : "err") + "\t" + result);
    }
    foreach (var h in new List<long>(bars)) { try { AppBarRemove(new IntPtr(h)); } catch { } } // Scorpion went away: its room goes too
  }
}
