// While Scorpion is in full mode, its exit keys must work wherever the keyboard
// is (an app inside the orb has it, too), and Ctrl+Esc must not open the Start
// menu instead, which Windows does before any app sees the key. A small
// PowerShell process holds a keyboard hook that only looks at Esc: Ctrl+Esc is
// taken (and reported), and Esc pressed twice quickly is reported (and still
// passed on). It runs only in full mode, nothing else is read or kept, and it
// quits by itself if Scorpion is gone (so a crash can't leave Ctrl+Esc taken).
import { spawn } from 'node:child_process';

const hook = (parent) => `
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System; using System.Diagnostics; using System.Runtime.InteropServices; using System.Windows.Forms;
public static class ScorpionKeys {
  delegate IntPtr Proc(int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Proc p, IntPtr mod, uint tid);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int k);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string n);
  static Proc keep; static IntPtr hook; static int lastEsc;
  public static void Run(int parent) {
    keep = Hook;
    hook = SetWindowsHookEx(13, keep, GetModuleHandle(null), 0);
    Console.WriteLine(hook == IntPtr.Zero ? "FAILED" : "READY");
    var t = new Timer { Interval = 2000 };
    t.Tick += (s, e) => { try { if (Process.GetProcessById(parent).HasExited) Application.Exit(); } catch { Application.Exit(); } };
    t.Start();
    Application.Run();
  }
  static IntPtr Hook(int n, IntPtr w, IntPtr l) {
    if (n >= 0 && (w == (IntPtr)0x100 || w == (IntPtr)0x104) && Marshal.ReadInt32(l) == 0x1B) {
      if ((GetAsyncKeyState(0x11) & 0x8000) != 0) { Console.WriteLine("CTRL_ESC"); return (IntPtr)1; }
      int now = Environment.TickCount;
      if (now - lastEsc < 450) { lastEsc = 0; Console.WriteLine("ESC_TWICE"); } else lastEsc = now;
    }
    return CallNextHookEx(hook, n, w, l);
  }
}
'@
[ScorpionKeys]::Run(${parent})
`;

let proc = null;

// onKey('ctrl-esc' | 'esc-twice')
export function startKeyWatch(onKey) {
  if (process.platform !== 'win32' || proc) return;
  const encoded = Buffer.from(hook(process.pid), 'utf16le').toString('base64');
  proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line === 'CTRL_ESC') onKey('ctrl-esc');
      else if (line === 'ESC_TWICE') onKey('esc-twice');
    }
  });
  const gone = () => { proc = null; };
  proc.on('exit', gone);
  proc.on('error', gone);
}

export function stopKeyWatch() {
  proc?.kill();
  proc = null;
}
