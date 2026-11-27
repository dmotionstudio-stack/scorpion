// The last entry of the taskbar's power menu: a way to the computer's own desktop, named for the system Scorpion is on.
//   Windows: Scorpion can replace the Windows taskbar and desktop; this goes back (to the Windows taskbar, or to Explorer's desktop).
//   macOS: Scorpion is an app over the Mac desktop; this hides it to show the desktop (the Dock brings it back).
//   Linux (Scorpion OS): Scorpion is the desktop, and there is no other one to go to, so nothing is offered
//     (only when its taskbar runs over another Linux desktop, "bar" mode, can it go back to that one).
// mode: the desktop shell's mode: 'shell', 'bar' or null.
export function desktopSwitchItem(platform, mode) {
  if (platform === 'win32') return mode === 'bar' ? { label: 'Back to the Windows taskbar', action: 'taskbar-off' } : { label: 'Switch to the Windows desktop', action: 'explorer' };
  if (platform === 'darwin') return { label: 'Switch to the Mac desktop', action: 'hide' };
  if (platform === 'linux') return mode === 'bar' ? { label: 'Back to the Linux taskbar', action: 'taskbar-off' } : null;
  return null;
}
