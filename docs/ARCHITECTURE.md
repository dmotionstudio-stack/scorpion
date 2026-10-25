# Scorpion: architecture and tech stack

Scorpion is one application that runs three ways:

| Form | What it is | Where it comes from |
|---|---|---|
| **Scorpion for Windows** | An app, or the Windows desktop itself (shell mode), installed or portable | `npm run dist:win`, `npm run dist:portable` |
| **Scorpion for Linux** | An app (`.deb`, AppImage) on any Wayland desktop | `npm run dist:linux` (on Linux) |
| **Scorpion OS** | A complete operating system: Ubuntu 24.04 LTS underneath, Scorpion as the desktop. Boots from a USB stick, installs alone or alongside Windows | `os/build-iso.sh`, built by GitHub Actions |

The same code is the desktop in all three. Only a thin system layer differs per OS.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Scorpion (Electron: HTML, CSS, JavaScript)                           │
│  src/renderer  the orb, home, chats, Files, Apps, the taskbar         │
│                (edge rail, intent wheel), hand gestures, voice         │
│  src/main      the agent, local models (llama.cpp), voice, faces,     │
│                memory, library, schedules, the taskbar windows         │
├──────────────────────────────────────────────────────────────────────┤
│ System layer: src/main/system.js picks one                           │
│  windows-control.js  PowerShell + Win32 (apps, windows, Settings,     │
│                      volume keys, Recycle Bin, Winlogon shell)        │
│  linux-control.js    freedesktop + Wayland tools (below)              │
├──────────────────────────────────────────────────────────────────────┤
│ Windows 10/11        │ Scorpion OS: Ubuntu 24.04 LTS                  │
│                      │  labwc (Wayland window manager) + XWayland     │
│                      │  systemd, NetworkManager, PipeWire, BlueZ      │
│                      │  Linux kernel (HWE) + linux-firmware           │
└──────────────────────────────────────────────────────────────────────┘
```

## Tech stack

| Layer | Technology |
|---|---|
| Interface | Electron 44 (Chromium + Node.js), plain ES modules, no framework; Three.js for the orb; MediaPipe for hand tracking |
| AI | node-llama-cpp (llama.cpp: CPU, Vulkan on any GPU, CUDA on Windows), GGUF models; ONNX Runtime for faces and media; Kokoro for the voice; all offline |
| Windows integration | PowerShell with small C# helpers (Win32 window list, focus, work area, keyboard hook), Start menu and Store app activation |
| Linux integration | `.desktop` entries (apps), `lswt` + `wlrctl` (Wayland foreign-toplevel: the window list, focus, minimize, close), `wpctl` (PipeWire volume), `playerctl` (media), `brightnessctl`, `nmcli` (network), `/sys/class/power_supply` (battery), `loginctl`/`systemctl` (power), `gio` (Trash), `grim` (screenshots), `xdg-open`/`xdg-mime` |
| Scorpion OS base | Ubuntu 24.04 LTS (noble) packages, built with `debootstrap` |
| Scorpion OS session | labwc 0.7 (stacking Wayland compositor, Openbox-style), XWayland for Scorpion's own windows, LightDM sign-in, mako notifications, swaylock/swayidle |
| Live system and installer | casper (Ubuntu's live boot), Calamares 3.3 (installs alone, alongside Windows, or on a chosen partition; LUKS encryption optional) |
| Snapshots | Btrfs (`@` system, `@home`, `@cache`, `@log`, `@swap`); `scorpion-snapshot` takes read-only snapshots (after installing, before apt changes, before the agent changes the system) and undoes to one at the next restart; `@home` is never rolled back |
| Apps | apt (Ubuntu), Flatpak with Flathub, and Scorpion's own signed apt repository on GitHub Pages for Scorpion updates |
| Boot | GRUB 2: BIOS, and UEFI through Ubuntu's Microsoft-signed shim and Canonical-signed GRUB (Secure Boot stays on); `os-prober` adds Windows to the installed system's menu |
| Packaging | electron-builder: NSIS installer (with an install-or-portable page), portable `.zip`, `.deb`, AppImage, macOS `.dmg`; `xorriso` hybrid ISO (DVD and USB) |
| Build and test | GitHub Actions on Ubuntu 24.04: Linux app, ISO, then a QEMU boot test (KVM, OVMF for UEFI) with screenshots |

## Hardware support (drivers)

Scorpion OS uses Ubuntu's kernel and firmware, the same hardware support as
Ubuntu 24.04 (with its newer HWE kernel):

- **Network**: Ethernet and Wi-Fi drivers are in the kernel, their firmware in
  `linux-firmware` (Intel, Realtek, Qualcomm/Atheros, MediaTek, Broadcom
  brcmfmac). NetworkManager joins networks; mobile broadband through ModemManager;
  OpenVPN.
- **Sound**: the kernel's ALSA drivers, Intel SOF firmware (`firmware-sof-signed`)
  for recent laptops, PipeWire with WirePlumber, `alsa-ucm-conf` for laptop
  speaker and microphone routing.
- **Bluetooth**: BlueZ, Blueman to pair.
- **Graphics**: Mesa (Intel, AMD, and NVIDIA's open driver) with Vulkan, which
  Scorpion's models use for GPU speed. NVIDIA's own driver: **Additional drivers**
  (`software-properties-gtk`, `ubuntu-drivers`), once installed and online.
- **Processors**: Intel and AMD microcode; `thermald`; `power-profiles-daemon`.
- **Firmware updates**: `fwupd` (LVFS).
- **Printers**: CUPS with driverless IPP printing (`ipp-usb`).
- **Disks**: NTFS (Windows drives), exFAT, FAT, Btrfs, ext4.

Scorpion OS writes no drivers of its own: what Ubuntu supports, it supports.

## How Scorpion OS starts

1. The firmware starts GRUB (from the USB stick, or the installed disk).
2. Live: casper finds `casper/filesystem.squashfs` and runs the system from it,
   with changes in memory, and signs in the live user `scorpion` automatically.
   Installed: LightDM's sign-in screen, the **Scorpion** session by default.
3. `scorpion-session` sets the session up and starts labwc with
   `/usr/share/scorpion/labwc` (copy it to `~/.config/labwc` to customize).
4. labwc's `autostart` starts the password prompt agent, notifications,
   the idle lock, then `run-scorpion`, which starts Scorpion with `--shell`
   (and starts it again if it crashes).
5. Scorpion is the desktop (kept under other windows), the edge rail on the
   right (labwc keeps its 76 pixels free) and the summon dot. Keys: Super+Space
   opens the intent wheel, Super+Alt+Space the orb, Ctrl+Esc leaves full
   screen (labwc passes them to Scorpion as `scorpion --wheel`, `--orb`,
   `--exit-full`).

## Files

| Path | What |
|---|---|
| `src/main/system.js` | Picks the system layer for this OS |
| `src/main/windows-control.js`, `src/main/linux-control.js` | The two system layers (same functions) |
| `os/build-iso.sh` | Builds the Scorpion OS ISO |
| `os/config/packages.list` | Every Ubuntu package in Scorpion OS |
| `os/rootfs/` | Files laid over the system: the session, labwc settings, LightDM, casper, Calamares, branding |
| `os/test/boot-test.mjs` | Boots the ISO in QEMU and checks Scorpion comes up |
| `.github/workflows/scorpion-os.yml` | Builds and tests all of it |
| `resources/installer.nsh` | The Windows installer's install-or-portable page |
| `scripts/make-portable.mjs`, `scripts/make-usb.mjs` | The portable `.zip`, and a USB stick folder for Windows and Mac |

## Names

Ubuntu is a trademark of Canonical. Scorpion OS is built from Ubuntu's freely
licensed packages and carries its own name and logo (`/usr/lib/os-release`,
the boot splash, the boot menu, the installer); it is not Ubuntu and not
endorsed by Canonical.
