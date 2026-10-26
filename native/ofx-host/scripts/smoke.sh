#!/usr/bin/env bash
# Smoke test: builds avpe-ofx-host if needed, scans /Library/OFX/Plugins and
# ~/Library/OFX/Plugins, renders a gradient through Buckswood Post Plugins Optics Lab
# (preset 6) and other Buckswood Post Plugins plugins, writes PNG/PPM previews and bakes a
# 1 s test clip (if ffmpeg is available).
#
#   native/ofx-host/scripts/smoke.sh [--out DIR] [--no-bake] [--all]
#
# Environment: SMOKE_OUT (output dir, default $TMPDIR/avpe-ofx-smoke), FFMPEG.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_DIR="$(cd "$HERE/.." && pwd)"

if [[ ! -x "$HOST_DIR/build/avpe-ofx-host" ]]; then
  make -C "$HOST_DIR"
fi
exec node "$HERE/smoke.mjs" "$@"
