#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VROOT="$ROOT/.local/vulkan/root"
if [[ ! -f "$VROOT/usr/share/vulkan/icd.d/lvp_icd.json" ]]; then
  echo 'Lavapipe is not installed. Run: npm run setup:vulkan' >&2
  exit 1
fi
export LD_LIBRARY_PATH="$VROOT/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export VK_ICD_FILENAMES="$VROOT/usr/share/vulkan/icd.d/lvp_icd.json"
exec "$@"
