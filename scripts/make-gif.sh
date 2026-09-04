#!/usr/bin/env bash
# Build assets/demo.gif from the scene SVGs.
# macOS only: uses qlmanage to rasterise, ffmpeg to assemble.
set -euo pipefail
cd "$(dirname "$0")/.."
FR=assets/frames
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

command -v qlmanage >/dev/null || { echo "qlmanage not found (macOS only)"; exit 1; }
command -v ffmpeg   >/dev/null || { echo "ffmpeg not found"; exit 1; }

for f in "$FR"/scene*.svg; do
  qlmanage -t -s 1600 -o "$TMP" "$f" >/dev/null 2>&1
done

# ffmpeg concat with per-scene durations
HOLDS=$(node -e "console.log(require('./$FR/holds.json').join(' '))")
i=0; : > "$TMP/list.txt"
for h in $HOLDS; do
  png="$TMP/scene$i.svg.png"
  [ -f "$png" ] || { echo "missing $png"; exit 1; }
  echo "file '$png'"      >> "$TMP/list.txt"
  echo "duration $h"      >> "$TMP/list.txt"
  i=$((i+1))
done
# concat demuxer needs the last frame repeated to honour its duration
echo "file '$TMP/scene$((i-1)).svg.png'" >> "$TMP/list.txt"

# qlmanage pads the render to a square, so crop back to the SVG's aspect
# ratio (800x360) before assembling.
ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i "$TMP/list.txt" \
  -vf "crop=iw:iw*360/800:0:0,fps=8,scale=800:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none" \
  -loop 0 assets/demo.gif

echo "wrote assets/demo.gif ($(du -h assets/demo.gif | cut -f1))"
