#!/usr/bin/env bash
# Final master of the rendered tutorial: −16.5 LUFS integrated, −1.5 dBTP, video copied.
#   script/master.sh build/tutorial.mp4 build/tutorial-master.mp4
set -euo pipefail
in="${1:-build/tutorial.mp4}"; out="${2:-build/tutorial-master.mp4}"
ffmpeg -loglevel error -y -i "$in" -c:v copy \
  -af "loudnorm=I=-16.5:TP=-1.5:LRA=9:linear=true,alimiter=limit=0.84:level=false" -c:a aac -b:a 256k -ar 48000 "$out"
echo "$out"
ffmpeg -nostats -i "$out" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I|Peak):" | tail -2
