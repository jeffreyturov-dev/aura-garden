#!/usr/bin/env bash
set -euo pipefail
# Optional, root-free CPU Vulkan for Linux x86_64 (Debian 13 packages).
# Needed only when SmartSpectra reports "Vulkan is not available on this system".
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/.local/vulkan"
DEBS="$DEST/debs"
mkdir -p "$DEBS" "$DEST/root"
fetch() {
  local url="$1" file="$2" expected="$3"
  curl -fsSL "$url" -o "$DEBS/$file"
  printf '%s  %s\n' "$expected" "$DEBS/$file" | sha256sum -c -
  dpkg-deb -x "$DEBS/$file" "$DEST/root"
}
fetch 'https://deb.debian.org/debian/pool/main/m/mesa/mesa-vulkan-drivers_25.0.7-2+deb13u1_amd64.deb' mesa.deb 'caf2f7d296b7522efe74e40a74bce762a3ce84c33b53b5e54e1248ac2e0a13a5'
fetch 'https://deb.debian.org/debian/pool/main/v/vulkan-loader/libvulkan1_1.4.309.0-1_amd64.deb' libvulkan.deb 'f47da79cd140264fe21cceb08bc87a71bc7fec05819e4a421f3f518d21101a37'
fetch 'https://deb.debian.org/debian/pool/main/l/llvm-toolchain-19/libllvm19_19.1.7-3+b1_amd64.deb' libllvm.deb 'db0d614d61345ca710fb73e75105f1ec6e38898fa7b3aa99fa7eb7d8b0a11d57'
echo "Lavapipe installed without root in $DEST/root"
echo 'Start Aura with: npm run start:lavapipe'
