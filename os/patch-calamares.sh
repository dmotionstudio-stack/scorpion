#!/bin/sh
# Calamares 3.3.5 with Ubuntu 24.04's util-linux 2.39: after creating the
# Btrfs subvolumes, `umount` of the top level unmounts it but exits 1, and
# Calamares stops the install ("Bad main script file", mount job). Carry on
# when the volume is in fact unmounted. Usage: patch-calamares.sh [root]
set -e
MOUNTPY="${1:-}/usr/lib/x86_64-linux-gnu/calamares/modules/mount/main.py"
grep -q 'umount succeeded or not' "$MOUNTPY" && exit 0 # already patched
grep -q '^ *subprocess.check_call(\["umount", "-v", root_mount_point\])$' "$MOUNTPY" || {
  echo "patch-calamares: the umount line in $MOUNTPY changed; check whether the patch is still needed" >&2
  exit 1
}
sed -i 's|^\( *\)subprocess.check_call(\["umount", "-v", root_mount_point\])$|\1subprocess.call(["umount", "-v", root_mount_point])  # umount succeeded or not: see os/patch-calamares.sh\n\1if os.path.ismount(root_mount_point):\n\1    raise RuntimeError("Could not unmount " + root_mount_point)|' "$MOUNTPY"
python3 -m py_compile "$MOUNTPY"
echo "patch-calamares: patched $MOUNTPY"
