# Scorpion OS

A complete operating system with Scorpion as the desktop, built from Ubuntu
24.04 LTS. It runs straight from a USB stick without installing anything, and
installs on a computer alone or alongside Windows. It comes with a model and the
voice built in (Qwen3 4B by default), so Scorpion chats and talks from the first
minute with no internet, and new versions of Scorpion arrive through Software
Updater. See
[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for how it is put together.

## Get the ISO

The ISO is built by GitHub Actions (building one needs Linux; Windows can't):

1. On GitHub, open **Actions → Scorpion OS → Run workflow**.
2. About an hour later, the run has three parts: **Scorpion for Linux** (the
   `.deb` and AppImage), **Scorpion OS ISO**, and **Boot test** (QEMU starts the
   ISO and checks Scorpion comes up; its pictures are in the
   `boot-test-pictures` artifact).
3. Download the `scorpion-os-iso` artifact: `scorpion-os-0.1-amd64.iso` and its
   `.sha256` (about 4.7 GB with the built-in model).

The run also publishes that Scorpion build to the update repository (part
**Update repository**). Options in **Run workflow**: **model** picks the built-in
model (a catalog id: `qwen3-4b`, `llama3.2-3b`, `llama3.2-1b`, `gemma3-1b`, or
`none` for a 1.9 GB ISO without one), and **publish** can be turned off for a
test build.

To build on your own Ubuntu 24.04 machine (about 25 GB free, an hour):

```bash
sudo apt-get install debootstrap squashfs-tools xorriso grub-pc-bin grub-efi-amd64-bin mtools dosfstools
npm ci && npx electron-builder --linux deb --x64
sudo os/build-iso.sh release/scorpion_0.1.7_amd64.deb
```

## Make a USB stick

Any stick of 8 GB or more; **everything on it is erased**.

- **Windows**: [Rufus](https://rufus.ie): pick the stick, **SELECT** the ISO,
  keep **GPT** for current PCs, **START**, and choose **ISO image mode** if asked.
  Or [balenaEtcher](https://etcher.balena.io).
- **Linux**: `sudo dd if=scorpion-os-0.1-amd64.iso of=/dev/sdX bs=4M status=progress oflag=sync`
  (check `/dev/sdX` with `lsblk` first).
- **One stick for everything**: [Ventoy](https://www.ventoy.net) turns a stick
  into a boot menu: copy the ISO onto it like a normal file, and also the
  portable Scorpion for Windows folder. The same stick then boots Scorpion OS and
  runs Scorpion on any Windows PC.

## Start from the stick (nothing is installed)

1. Plug the stick in and restart. Open the boot menu: usually **F12**, **F9**,
   **F11** or **Esc** at power-on (Dell F12, HP F9, Lenovo F12, ASUS F8 or Esc,
   Acer F12, Microsoft Surface: hold volume down). Or, from Windows: **Settings →
   System → Recovery → Advanced startup → Restart now → Use a device**.
2. Pick the USB stick. In the Scorpion OS menu, **Try or install Scorpion OS**.
3. Scorpion opens as the desktop. Nothing on the computer changes; what you do is
   forgotten when you turn it off.

### Keep your changes on the stick

Pick **Scorpion OS, keeping my changes on this USB stick** in the boot menu
instead. The first time, Scorpion OS makes a `writable` partition in the stick's
free space (so use a stick bigger than the ISO: 16 GB or more is comfortable).
From then on everything you do is kept on the stick: chats, memories, models you
download, Wi-Fi networks, settings and apps you install. Choose the same entry
each time. The stick then carries your whole AI from one computer to the next.

This works with sticks written by Rufus (ISO mode), balenaEtcher or `dd`. Rufus
can also make the space itself: its **Persistent partition size** slider.

Secure Boot can stay on (the stick boots through Ubuntu's signed shim). If a
computer refuses, turn Secure Boot off in its firmware settings, or try **Safe
graphics** in the menu for a black screen.

## Try it in a virtual machine

VirtualBox (7.x): a new VM of type **Ubuntu (64-bit)**, 4 processors, 6 GB of
memory or more, 40 GB disk, **Enable EFI**, the ISO in the optical drive. Keep
**3D acceleration off**: the session then draws in software (it detects that
there is no usable GPU), and the orb uses the software 3D renderer, slower but
complete. QEMU/KVM with virtio graphics works the same way.

## Install alongside Windows

Before you start, in Windows:

- **Back up** anything important.
- **Make room**: 40 GB or more free on drive C:.
- **BitLocker**: if drive C: is encrypted (Settings → Privacy & security → Device
  encryption, or BitLocker), **turn it off** and wait for decryption to finish,
  or have the recovery key at hand. The installer can't shrink an encrypted drive.
- **Fast Startup**: turn it off (Control Panel → Power Options → Choose what the
  power buttons do → Turn on fast startup), so Windows' drive isn't left locked.

Then, from the stick: double-click **Install Scorpion OS** (in Apps), and:

1. Language, time zone, keyboard.
2. **Disk**: **Install alongside**, then drag the divider to share the space
   between Windows and Scorpion OS. (**Erase disk** replaces Windows: everything
   on the disk is lost.)
3. Your name, the computer's name, and a password.
4. **Install**, then restart and remove the stick.

From then on, each start shows a menu: **Scorpion OS** or **Windows Boot
Manager**. To make Windows the default, in Scorpion OS edit `/etc/default/grub`
(`GRUB_DEFAULT`) and run `sudo update-grub`.

## After installing

- **NVIDIA graphics**: connect to the internet, then labwc's menu (or Scorpion's
  settings) → **Additional drivers**, pick the recommended NVIDIA driver, restart.
  Scorpion's models then run on the GPU through Vulkan.
- **Updates**: **Software Updater** (`update-manager`) brings Ubuntu's updates
  and new versions of Scorpion, from Scorpion's own repository
  (<https://dmotionstudio-stack.github.io/scorpion/apt>, signed with the key in
  `/etc/apt/keyrings/scorpion.asc`, fingerprint
  `B877 3FEF A9EA F3C1 7AD1 70EA 466E E54B 849C DE26`). Security updates also
  install by themselves (`unattended-upgrades`). Upgrades to a newer Ubuntu
  release aren't offered: a new Scorpion OS version comes as a new ISO.
- **The built-in model and voice** are in `/usr/share/scorpion`. Models you
  download in **Settings → Models** go to your own folder, as usual.
- **Wi-Fi**: the rail's network icon, or `nm-connection-editor`.
- **Customize the session**: copy `/usr/share/scorpion/labwc` to `~/.config/labwc`
  and edit `rc.xml` (keys, window rules), `autostart` and `menu.xml`.

## Keys in the Scorpion session

| Keys | |
|---|---|
| Super+Space | Intent wheel (where the pointer is) |
| Super+Alt+Space | The orb, with search ready |
| Ctrl+Esc | Leave full screen |
| Alt+Tab | Switch windows |
| Super+Up / Down / Left / Right | Maximize / minimize / snap left / snap right |
| Super+Return | Terminal |
| Super+E | Files |
| Super+L | Lock |
| Print | Screenshot to Pictures/Screenshots |

## What isn't there yet

- Scorpion's Windows-only features: taking over the Windows taskbar, apps
  framed inside the orb, the Windows Settings pages.
- The rail's notification count and per-app mail badges.
- The installer is in English; Calamares has translations, not yet set up here.
- Tested by the automatic boot test in QEMU and by installing in VirtualBox. Real
  computers vary; please report what works and what doesn't.
