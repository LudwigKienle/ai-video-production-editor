#!/usr/bin/env bash
# TTS scenes come back at different loudness (TrendCraft: −22.3 to −26.7 LUFS).
# Bring every narration clip to −21 LUFS with a −1.5 dBTP limiter before the edit.
#   script/normalize-voice.sh            # all build/audio/s*.mp3 → build/audio/norm/
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/audio/norm
for f in build/audio/s*.mp3; do
  out="build/audio/norm/$(basename "$f" .mp3).wav"
  ffmpeg -loglevel error -y -i "$f" -af "loudnorm=I=-21:TP=-1.5:LRA=7:linear=true,alimiter=limit=0.84:level=false" -ar 48000 "$out"
  printf '%s  ' "$(basename "$f")"
  ffmpeg -nostats -i "$out" -af ebur128 -f null - 2>&1 | grep -E "^\s+I:" | tail -1
done
