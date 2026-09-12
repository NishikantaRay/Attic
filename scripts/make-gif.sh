#!/usr/bin/env bash
# Build a GIF from a directory of scene SVGs.
#
#   scripts/make-gif.sh hero        -> assets/frames-hero/       -> assets/hero.gif
#   scripts/make-gif.sh hero-light  -> assets/frames-hero-light/ -> assets/hero-light.gif
#   ... and the same for clip and library.
#
# Frames come from scripts/make-extension-gifs.js; `npm run make:gifs` does
# both steps for every GIF and both themes.
#
# Rasterises with rsvg-convert (exact SVG dimensions) and assembles with
# ffmpeg. Falls back to macOS qlmanage if rsvg-convert is not installed.
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${1:-hero}"
FR="assets/frames-$NAME"
OUTFILE="assets/$NAME.gif"

[ -d "$FR" ] || { echo "no such frame directory: $FR"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

command -v ffmpeg >/dev/null || { echo "ffmpeg not found"; exit 1; }

# Scene dimensions, so the render and the output agree.
# size.json is written next to the frames; assets/frames predates it.
if [ -f "$FR/size.json" ]; then
  W=$(node -e "console.log(require('./$FR/size.json').w)")
  H=$(node -e "console.log(require('./$FR/size.json').h)")
else
  W=800; H=360
fi

# rsvg-convert honours the SVG's own dimensions exactly. qlmanage does not: it
# renders into a padded square whose content box is NOT the SVG's aspect ratio
# (a 900x500 scene came out 1600x1042, ratio 1.54 rather than 1.80), so any
# fixed crop letterboxes or clips the frame. Hence rsvg-convert first, with
# qlmanage plus a measured crop only as a fallback.
CROP=""
if command -v rsvg-convert >/dev/null; then
  # -b flattens the transparent area outside the rounded corners onto the
  # scene's own background. Left transparent, ffmpeg spends palette entries on
  # the anti-aliased alpha edge and the file balloons (4.3MB -> ~200KB).
  # It must MATCH the scene background, or a light scene gets a dark halo
  # around its corners — hence the -light suffix check.
  case "$NAME" in *-light) BG='#ffffff' ;; *) BG='#0d1117' ;; esac
  for f in "$FR"/scene*.svg; do
    rsvg-convert -b "$BG" -w $((W * 2)) -h $((H * 2)) "$f" -o "$TMP/$(basename "$f").png"
  done
elif command -v qlmanage >/dev/null; then
  echo "rsvg-convert not found; falling back to qlmanage (brew install librsvg for exact sizing)"
  for f in "$FR"/scene*.svg; do
    qlmanage -t -s 1600 -o "$TMP" "$f" >/dev/null 2>&1
  done
  CROP="crop=iw:iw*$H/$W:0:0,"
else
  echo "need rsvg-convert (brew install librsvg) or qlmanage"; exit 1
fi

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

# A flat UI bands badly under dithering and the file gets bigger, hence
# dither=none. 64 colours is plenty for this palette.
ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i "$TMP/list.txt" \
  -vf "${CROP}fps=8,scale=$W:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none" \
  -loop 0 "$OUTFILE"

echo "wrote $OUTFILE ($(du -h "$OUTFILE" | cut -f1))"
