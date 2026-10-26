#!/usr/bin/env bash
# Scorpion OS: builds the bootable live / installer ISO from Ubuntu 24.04 LTS
# packages, with Scorpion as the desktop. Run as root on Ubuntu 24.04 (the
# GitHub workflow .github/workflows/scorpion-os.yml does this):
#
#   sudo os/build-iso.sh release/scorpion_0.1.7_amd64.deb
#
# What it does:
#   1. debootstrap: an Ubuntu "noble" base system in work/chroot
#   2. installs the packages in config/packages.list (kernel, firmware and
#      drivers, NetworkManager, PipeWire, Bluetooth, the labwc session,
#      apps, the Calamares installer) and Firefox from Mozilla's repository
#   3. builds lswt (lists windows for Scorpion's taskbar; not in Ubuntu 24.04)
#   4. installs Scorpion's .deb and the files in rootfs/ (session, installer
#      settings, branding)
#   5. packs the system into casper/filesystem.squashfs (the live system)
#   6. makes it bootable: BIOS (GRUB) and UEFI with Secure Boot (Ubuntu's
#      signed shim and GRUB), from a DVD or a USB stick
#   7. writes out/scorpion-os-VERSION-amd64.iso and its SHA-256
#
# Environment: WORK (scratch folder, needs ~25 GB), OUT, MIRROR,
# SCORPION_OS_VERSION, BUNDLE (a folder with models/*.gguf and voice/: the
# built-in model and voice, in /usr/share/scorpion).
set -euo pipefail

OS_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$OS_DIR")"
DEB="$(realpath "${1:?usage: sudo os/build-iso.sh path/to/scorpion_VERSION_amd64.deb}")"
VERSION="${SCORPION_OS_VERSION:-0.1}"
SUITE=noble
MIRROR="${MIRROR:-http://archive.ubuntu.com/ubuntu}"
WORK="${WORK:-$OS_DIR/work}"
OUT="${OUT:-$OS_DIR/out}"
CHROOT="$WORK/chroot"
IMAGE="$WORK/image"
ISO="$OUT/scorpion-os-$VERSION-amd64.iso"
LOGO="$REPO_DIR/resources/icon.png"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "Run as root (sudo)."
[ -f "$DEB" ] || die "No such file: $DEB"
for tool in debootstrap mksquashfs xorriso grub-mkstandalone mkfs.vfat mmd mcopy; do
  command -v "$tool" >/dev/null || die "Missing $tool. Install: apt-get install debootstrap squashfs-tools xorriso grub-pc-bin grub-efi-amd64-bin mtools dosfstools"
done
[ -f /usr/lib/grub/i386-pc/cdboot.img ] || die "Missing GRUB's BIOS images: apt-get install grub-pc-bin"

# Everything mounted into the chroot is unmounted again, even after an error.
MOUNTS=()
unmount_all() {
  local i
  for ((i = ${#MOUNTS[@]} - 1; i >= 0; i--)); do umount -lf "${MOUNTS[$i]}" 2>/dev/null || true; done
  MOUNTS=()
}
trap unmount_all EXIT
mount_in() { mount "$@"; MOUNTS+=("${!#}"); }
# A command inside the new system, with a clean environment.
in_chroot() { chroot "$CHROOT" /usr/bin/env -i HOME=/root TERM=dumb PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8 DEBIAN_FRONTEND=noninteractive "$@"; }
# The package names in a list file (comments and blank lines skipped).
packages() { sed -e 's/#.*//' -e '/^[[:space:]]*$/d' "$1" | xargs; }
APT_INSTALL=(apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

rm -rf "$WORK"
mkdir -p "$CHROOT" "$IMAGE" "$OUT"

log "1/7 Ubuntu $SUITE base system"
debootstrap --arch=amd64 --variant=minbase --components=main,restricted,universe,multiverse "$SUITE" "$CHROOT" "$MIRROR"

mount_in -t proc proc "$CHROOT/proc"
mount_in -t sysfs sysfs "$CHROOT/sys"
mount_in --bind /dev "$CHROOT/dev"
mount_in --bind /dev/pts "$CHROOT/dev/pts"
mount_in -t tmpfs tmpfs "$CHROOT/run"
rm -f "$CHROOT/etc/resolv.conf"
cp /etc/resolv.conf "$CHROOT/etc/resolv.conf"

rm -f "$CHROOT/etc/apt/sources.list"
cat > "$CHROOT/etc/apt/sources.list.d/ubuntu.sources" <<EOF
Types: deb
URIs: $MIRROR
Suites: $SUITE $SUITE-updates $SUITE-backports
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: http://security.ubuntu.com/ubuntu
Suites: $SUITE-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF
# Services don't start inside the build.
printf '#!/bin/sh\nexit 101\n' > "$CHROOT/usr/sbin/policy-rc.d"
chmod 755 "$CHROOT/usr/sbin/policy-rc.d"
echo scorpion > "$CHROOT/etc/hostname"

log "2/7 System packages: kernel, drivers, network, sound, session, apps, installer"
in_chroot apt-get update
in_chroot "${APT_INSTALL[@]}" $(packages "$OS_DIR/config/packages.list")
for p in $(packages "$OS_DIR/config/packages-optional.list"); do
  in_chroot "${APT_INSTALL[@]}" "$p" || echo "(optional package $p skipped)"
done

# Firefox from Mozilla's own repository (Ubuntu's is a snap, which can't be
# set up inside an image build).
install -d -m 755 "$CHROOT/etc/apt/keyrings"
curl -fsSL https://packages.mozilla.org/apt/repo-signing-key.gpg -o "$CHROOT/etc/apt/keyrings/packages.mozilla.org.asc"
cat > "$CHROOT/etc/apt/sources.list.d/mozilla.sources" <<'EOF'
Types: deb
URIs: https://packages.mozilla.org/apt
Suites: mozilla
Components: main
Signed-By: /etc/apt/keyrings/packages.mozilla.org.asc
EOF
cat > "$CHROOT/etc/apt/preferences.d/mozilla" <<'EOF'
Package: *
Pin: origin packages.mozilla.org
Pin-Priority: 1000
EOF
in_chroot apt-get update
in_chroot "${APT_INSTALL[@]}" firefox
# Flathub for apps (system-wide; Scorpion's agent installs apps from it).
in_chroot flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo

log "3/7 lswt (the window list for Scorpion's taskbar)"
in_chroot "${APT_INSTALL[@]}" gcc make libc6-dev libwayland-dev libwayland-bin git
in_chroot sh -c 'cd /tmp && (git clone --depth 1 --branch v2.0.0 https://git.sr.ht/~leon_plickat/lswt || git clone --depth 1 https://git.sr.ht/~leon_plickat/lswt) && make -C lswt && make -C lswt install PREFIX=/usr && rm -rf lswt'
in_chroot apt-get purge -y gcc make libc6-dev libwayland-dev git
in_chroot apt-get autoremove -y --purge
in_chroot lswt --help >/dev/null 2>&1 || in_chroot test -x /usr/bin/lswt || die "lswt didn't build"

log "4/7 Scorpion and the Scorpion OS files"
cp "$DEB" "$CHROOT/tmp/scorpion.deb"
in_chroot "${APT_INSTALL[@]}" /tmp/scorpion.deb
rm -f "$CHROOT/tmp/scorpion.deb"
# System files belong to root: the checkout's owner (the build user) would
# make sudo ignore /etc/sudoers.d and leave files writable by user 1001.
cp -a --no-preserve=ownership "$OS_DIR/rootfs/." "$CHROOT/"
chmod 755 "$CHROOT/usr/bin/scorpion-session" "$CHROOT/usr/bin/scorpion-install" "$CHROOT"/usr/lib/scorpion-os/*
chmod 600 "$CHROOT/etc/netplan/01-network-manager-all.yaml"
# System snapshots: the command, its sudo rule (checked: a broken sudoers file
# would lock sudo out) and apt's hook (checked: a broken one stops apt).
chmod 755 "$CHROOT/usr/bin/scorpion-snapshot"
chmod 440 "$CHROOT/etc/sudoers.d/scorpion-snapshot"
in_chroot visudo -cf /etc/sudoers.d/scorpion-snapshot
in_chroot apt-config dump >/dev/null

# The built-in model and voice: Scorpion talks and answers from the first
# minute, with no download (read from here; nothing is copied to the user).
if [ -n "${BUNDLE:-}" ] && [ -d "$BUNDLE" ]; then
  install -d -m 755 "$CHROOT/usr/share/scorpion/models" "$CHROOT/usr/share/scorpion/voice"
  find "$BUNDLE/models" -maxdepth 1 -name "*.gguf" -exec cp {} "$CHROOT/usr/share/scorpion/models/" \;
  [ -f "$BUNDLE/voice/installed.json" ] && cp -a --no-preserve=ownership "$BUNDLE/voice/." "$CHROOT/usr/share/scorpion/voice/"
  chmod -R a+rX "$CHROOT/usr/share/scorpion"
  du -sh "$CHROOT/usr/share/scorpion"/*
fi

# The system's name (Ubuntu's name and logo are Canonical's trademarks, so a
# system built from it carries its own). The Ubuntu files stay for the tools
# that read them (lsb-release).
in_chroot dpkg-divert --local --no-rename --add /usr/lib/os-release
cat > "$CHROOT/usr/lib/os-release" <<EOF
PRETTY_NAME="Scorpion OS $VERSION"
NAME="Scorpion OS"
VERSION_ID="24.04"
VERSION="$VERSION (based on Ubuntu 24.04 LTS)"
VERSION_CODENAME=noble
ID=scorpion
ID_LIKE="ubuntu debian"
HOME_URL="https://github.com/dmotionstudio-stack/scorpion"
SUPPORT_URL="https://github.com/dmotionstudio-stack/scorpion/issues"
BUG_REPORT_URL="https://github.com/dmotionstudio-stack/scorpion/issues"
UBUNTU_CODENAME=noble
LOGO=scorpion
EOF
ln -sf ../usr/lib/os-release "$CHROOT/etc/os-release"
# The boot splash shows Scorpion's logo.
for f in /usr/share/plymouth/ubuntu-logo.png /usr/share/plymouth/themes/spinner/watermark.png /usr/share/plymouth/themes/spinner/bgrt-fallback.png; do
  [ -e "$CHROOT$f" ] && install -m 644 "$LOGO" "$CHROOT$f"
done
mkdir -p "$CHROOT/etc/default/grub.d"
cat > "$CHROOT/etc/default/grub.d/50-scorpion.cfg" <<'EOF'
# Scorpion OS: its own name in the boot menu, and Windows listed too.
GRUB_DISTRIBUTOR="Scorpion OS"
GRUB_DISABLE_OS_PROBER=false
GRUB_TIMEOUT_STYLE=menu
GRUB_TIMEOUT=10
EOF

in_chroot locale-gen en_US.UTF-8
echo 'LANG=en_US.UTF-8' > "$CHROOT/etc/default/locale"
in_chroot systemctl set-default graphical.target
in_chroot systemctl enable NetworkManager.service bluetooth.service lightdm.service scorpion-boot-report.service || true
in_chroot update-initramfs -u -k all

# Tidy up: nothing from the build machine stays in the system.
rm -f "$CHROOT/usr/sbin/policy-rc.d"
in_chroot apt-get clean
rm -rf "$CHROOT"/tmp/* "$CHROOT"/var/tmp/* "$CHROOT"/var/lib/apt/lists/*
truncate -s 0 "$CHROOT/etc/machine-id"
rm -f "$CHROOT/var/lib/dbus/machine-id"
find "$CHROOT/var/log" -type f -exec truncate -s 0 {} +
rm -f "$CHROOT/etc/resolv.conf"
ln -s ../run/systemd/resolve/stub-resolv.conf "$CHROOT/etc/resolv.conf"
in_chroot dpkg-query -W --showformat='${Package} ${Version}\n' > "$WORK/filesystem.manifest"
unmount_all

log "5/7 The live system (squashfs)"
# Nothing in the system folders may belong to the build user.
stray="$(find "$CHROOT/etc" "$CHROOT/usr" "$CHROOT/opt" -xdev -uid "$(id -u "${SUDO_USER:-nobody}" 2>/dev/null || echo 65534)" -print -quit 2>/dev/null)"
[ -z "$stray" ] || die "$stray belongs to the build user, not root"
mkdir -p "$IMAGE/casper" "$IMAGE/.disk" "$IMAGE/boot/grub/fonts" "$IMAGE/EFI/boot"
KERNEL="$(ls -1 "$CHROOT"/boot/vmlinuz-* | sort -V | tail -n 1)"
INITRD="$CHROOT/boot/initrd.img-${KERNEL##*/vmlinuz-}"
cp "$KERNEL" "$IMAGE/casper/vmlinuz"
cp "$INITRD" "$IMAGE/casper/initrd"
cp "$WORK/filesystem.manifest" "$IMAGE/casper/filesystem.manifest"
mksquashfs "$CHROOT" "$IMAGE/casper/filesystem.squashfs" -noappend -comp xz -b 1M -Xbcj x86 -wildcards -e 'proc/*' 'sys/*' 'dev/*' 'run/*'
du -sx --block-size=1 "$CHROOT" | cut -f1 > "$IMAGE/casper/filesystem.size"
echo "Scorpion OS $VERSION \"Noble\" - amd64 ($(date -u +%Y%m%d))" > "$IMAGE/.disk/info"
touch "$IMAGE/.disk/base_installable"
echo "full_cd/single" > "$IMAGE/.disk/cd_type"
cp "$CHROOT/usr/share/grub/unicode.pf2" "$IMAGE/boot/grub/fonts/"

log "6/7 Boot menu, BIOS and UEFI (Secure Boot)"
cat > "$IMAGE/boot/grub/grub.cfg" <<'EOF'
# Scorpion OS live / installer boot menu.
set default=0
set timeout=10
set timeout_style=menu
if loadfont /boot/grub/fonts/unicode.pf2; then
  set gfxmode=auto
  insmod all_video
  insmod gfxterm
  terminal_output gfxterm
fi
set menu_color_normal=light-gray/black
set menu_color_highlight=black/yellow

menuentry "Try or install Scorpion OS" {
  set gfxpayload=keep
  linux /casper/vmlinuz boot=casper ignore_uuid quiet splash ---
  initrd /casper/initrd
}
# Persistent: changes (chats, models, settings, apps) are kept on the USB stick.
# The first time, casper makes a "writable" partition in the stick's free space.
menuentry "Scorpion OS, keeping my changes on this USB stick" {
  set gfxpayload=keep
  linux /casper/vmlinuz boot=casper ignore_uuid persistent quiet splash ---
  initrd /casper/initrd
}
menuentry "Scorpion OS (safe graphics)" {
  set gfxpayload=keep
  linux /casper/vmlinuz boot=casper ignore_uuid nomodeset quiet splash ---
  initrd /casper/initrd
}
menuentry "Scorpion OS (copy to memory first; the USB stick can then be removed)" {
  set gfxpayload=keep
  linux /casper/vmlinuz boot=casper ignore_uuid toram quiet splash ---
  initrd /casper/initrd
}
if [ "$grub_platform" = "efi" ]; then
  menuentry "Boot from the next disk (Windows)" { exit 1 }
  menuentry "UEFI firmware settings" { fwsetup }
fi
EOF
# The little config built into the boot images: find this disc, read its menu.
cat > "$WORK/embedded.cfg" <<'EOF'
search --no-floppy --set=root --file /.disk/info
set prefix=($root)/boot/grub
configfile ($root)/boot/grub/grub.cfg
EOF

# BIOS: GRUB from the El Torito boot image, and the USB stick's MBR.
grub-mkstandalone --format=i386-pc --output="$WORK/core.img" \
  --install-modules="linux16 linux normal iso9660 biosdisk memdisk search tar ls configfile all_video gfxterm font echo test" \
  --modules="linux16 linux normal iso9660 biosdisk search configfile" --locales="" --fonts="" \
  "boot/grub/grub.cfg=$WORK/embedded.cfg"
cat /usr/lib/grub/i386-pc/cdboot.img "$WORK/core.img" > "$IMAGE/boot/grub/bios.img"

# UEFI: Ubuntu's Microsoft-signed shim and Canonical-signed GRUB for discs
# (gcdx64), so it boots with Secure Boot on; unsigned GRUB if they're missing.
SHIM="$(ls "$CHROOT"/usr/lib/shim/shimx64.efi.signed.latest "$CHROOT"/usr/lib/shim/shimx64.efi.signed 2>/dev/null | head -n 1 || true)"
GCD="$CHROOT/usr/lib/grub/x86_64-efi-signed/gcdx64.efi.signed"
MM="$CHROOT/usr/lib/shim/mmx64.efi"
if [ -n "$SHIM" ] && [ -f "$GCD" ]; then
  cp "$SHIM" "$IMAGE/EFI/boot/bootx64.efi"
  cp "$GCD" "$IMAGE/EFI/boot/grubx64.efi"
  [ -f "$MM" ] && cp "$MM" "$IMAGE/EFI/boot/mmx64.efi"
else
  echo "WARNING: signed shim/GRUB not found; this ISO needs Secure Boot turned off." >&2
  grub-mkstandalone --format=x86_64-efi --output="$IMAGE/EFI/boot/bootx64.efi" --locales="" --fonts="" "boot/grub/grub.cfg=$WORK/embedded.cfg"
fi
# The EFI system partition image inside the ISO.
EFI_IMG="$WORK/efiboot.img"
EFI_KB=$(( $(du -sk "$IMAGE/EFI" | cut -f1) + 2048 ))
dd if=/dev/zero of="$EFI_IMG" bs=1k count="$EFI_KB" status=none
mkfs.vfat -n SCORPIONEFI "$EFI_IMG" >/dev/null
mmd -i "$EFI_IMG" ::/EFI ::/EFI/boot
mcopy -i "$EFI_IMG" "$IMAGE"/EFI/boot/* ::/EFI/boot/

# Checksums of the disc's files, for casper's "check disc for defects".
(cd "$IMAGE" && find . -type f ! -name md5sum.txt ! -path './boot/grub/bios.img' -print0 | sort -z | xargs -0 md5sum > md5sum.txt)

log "7/7 The ISO"
rm -f "$ISO"
(cd "$IMAGE" && xorriso -as mkisofs \
  -iso-level 3 -full-iso9660-filenames -joliet -joliet-long -rational-rock \
  -volid "SCORPION_OS" \
  -eltorito-boot boot/grub/bios.img -no-emul-boot -boot-load-size 4 -boot-info-table \
  --eltorito-catalog boot/grub/boot.cat \
  --grub2-boot-info --grub2-mbr /usr/lib/grub/i386-pc/boot_hybrid.img \
  -eltorito-alt-boot -e EFI/efiboot.img -no-emul-boot \
  -append_partition 2 0xef "$EFI_IMG" \
  -output "$ISO" \
  -graft-points . /EFI/efiboot.img="$EFI_IMG")
(cd "$OUT" && sha256sum "$(basename "$ISO")" > "$(basename "$ISO").sha256")
log "Done: $ISO ($(du -h "$ISO" | cut -f1))"
