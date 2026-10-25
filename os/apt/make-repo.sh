#!/usr/bin/env bash
# Builds Scorpion's apt repository (published on GitHub Pages by the workflow):
#   APT_SIGNING_KEY="$(cat private.asc)" bash os/apt/make-repo.sh <folder with .deb> <site folder>
#
#   site/apt/pool/main/scorpion_VERSION_amd64.deb
#   site/apt/dists/stable/{Release,InRelease,Release.gpg}
#   site/apt/dists/stable/main/binary-amd64/Packages(.gz)
#   site/apt/scorpion.asc       the public key (also in Scorpion OS)
#   site/index.html             how to add the repository
#
# Scorpion OS has this repository and its key built in
# (os/rootfs/etc/apt/sources.list.d/scorpion.sources), so Software Updater
# brings new Scorpion versions like any other update.
set -euo pipefail

DEBS="$(realpath "${1:?usage: make-repo.sh <deb folder> <site folder>}")"
SITE="$(realpath -m "${2:?usage: make-repo.sh <deb folder> <site folder>}")"
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
[ -n "${APT_SIGNING_KEY:-}" ] || { echo "APT_SIGNING_KEY (the private signing key) is not set." >&2; exit 1; }
command -v apt-ftparchive >/dev/null || { echo "Needs apt-ftparchive (apt-utils)." >&2; exit 1; }
ls "$DEBS"/*.deb >/dev/null

rm -rf "$SITE"
APT="$SITE/apt"
mkdir -p "$APT/pool/main" "$APT/dists/stable/main/binary-amd64"
cp "$DEBS"/*.deb "$APT/pool/main/"

cd "$APT"
apt-ftparchive packages pool > dists/stable/main/binary-amd64/Packages
gzip -9kf dists/stable/main/binary-amd64/Packages
apt-ftparchive \
  -o APT::FTPArchive::Release::Origin=Scorpion \
  -o APT::FTPArchive::Release::Label=Scorpion \
  -o APT::FTPArchive::Release::Suite=stable \
  -o APT::FTPArchive::Release::Codename=stable \
  -o APT::FTPArchive::Release::Architectures=amd64 \
  -o APT::FTPArchive::Release::Components=main \
  -o "APT::FTPArchive::Release::Description=Scorpion for Linux and Scorpion OS" \
  release dists/stable > dists/stable/Release

# Signed with the key whose public half Scorpion OS trusts.
GNUPGHOME="$(mktemp -d)"
export GNUPGHOME
trap 'rm -rf "$GNUPGHOME"' EXIT
printf '%s\n' "$APT_SIGNING_KEY" | gpg --batch --quiet --import
gpg --batch --yes --clearsign -o dists/stable/InRelease dists/stable/Release
gpg --batch --yes --armor --detach-sign -o dists/stable/Release.gpg dists/stable/Release
cp "$REPO_DIR/os/rootfs/etc/apt/keyrings/scorpion.asc" scorpion.asc
gpg --batch --verify dists/stable/InRelease

VERSION="$(sed -n 's/^Version: //p' dists/stable/main/binary-amd64/Packages | head -n 1)"
cat > "$SITE/index.html" <<EOF
<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scorpion packages</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;background:#0e0d0b;color:#f2eee2}code,pre{background:#1d1b16;border-radius:6px;padding:.1rem .3rem}pre{padding:.8rem;overflow-x:auto}a{color:#f5c518}</style>
<h1>Scorpion packages</h1>
<p>Scorpion ${VERSION} for 64-bit Debian, Ubuntu and similar systems. Scorpion OS already has this repository, so its Software Updater brings new versions by itself.</p>
<p>To add it to another system:</p>
<pre>sudo install -d -m 755 /etc/apt/keyrings
sudo curl -fsSL https://dmotionstudio-stack.github.io/scorpion/apt/scorpion.asc -o /etc/apt/keyrings/scorpion.asc
echo "deb [signed-by=/etc/apt/keyrings/scorpion.asc] https://dmotionstudio-stack.github.io/scorpion/apt stable main" | sudo tee /etc/apt/sources.list.d/scorpion.list
sudo apt update &amp;&amp; sudo apt install scorpion</pre>
<p>Signing key fingerprint: <code>B877 3FEF A9EA F3C1 7AD1 70EA 466E E54B 849C DE26</code></p>
<p><a href="https://github.com/dmotionstudio-stack/scorpion">Source and Scorpion OS</a></p>
</html>
EOF
echo "Repository ready: Scorpion $VERSION in $SITE"
