# Poster

How to make the rendered MP4's first frame social-media-friendly so X / Twitter auto-thumbnails grab the full hero, not a black frame.

## The problem

After `hyperframes render`, the MP4 looks correct in any player, but its **first encoded frame** can be:

1. Black or partially loaded (Chrome's video element hasn't decoded its first frame at composition time `t=0`)
2. Slightly offset (`screencapture -V` introduces a ~21ms lead-in)
3. Missing one of the composition layers (panel + window + brand mark not all fully composited at the exact `t=0` snapshot)

X / Twitter, Finder, Quicklook, and most embedded video players sample the first frame as the preview thumbnail. Black preview = nobody clicks.

## Solution: `tpad clone` the first 0.5s

Use FFmpeg's `tpad` filter to clone the first decoded frame for an extra 0.5s at the start. Combined with `adelay` to keep audio in sync.

```bash
ffmpeg -i renders/spool-vX.Y.Z-raw.mp4 \
  -vf "tpad=start_mode=clone:start_duration=0.5" \
  -af "adelay=500|500" \
  -c:v libx264 -preset slow -crf 18 \
  -c:a aac -b:a 192k -pix_fmt yuv420p -movflags +faststart \
  renders/spool-vX.Y.Z-final.mp4
```

Output: total duration is `original + 0.5s`. The added 0.5s shows the first decoded frame frozen. Players paused at the start now show the hero state.

## Belt + braces: also keep scene 1 elements visible at `t=0`

The `tpad` trick handles encoder-level leading frames, but the composition itself should also have scene 1 visible at `t=0`:

- `#panel1`, `#window`, `#brand-mark` all `opacity: 1` from CSS (no entrance `fromTo`)
- `clip-home` (or whatever clip plays first) has `data-start="0.00"` so HyperFrames doesn't hide it before its play window starts

Both layers (composition CSS + post-process `tpad`) protect against different failure modes. Use both.

## Extracting a poster JPG

Some tweet workflows want a separate poster image to attach as the preview (e.g. Premium accounts that can set custom thumbnails):

```bash
ffmpeg -i renders/spool-vX.Y.Z-final.mp4 \
  -vframes 1 \
  -q:v 1 \
  renders/spool-vX.Y.Z-poster.jpg
```

The first frame of the final MP4 (after `tpad`) is the hero state, so this grabs the right thumbnail.

## Verifying

Quick checks after post-processing:

```bash
# duration
ffprobe -v error -show_entries format=duration -of csv=p=0 renders/final.mp4

# first packet timestamp (should be 0.000)
ffprobe -v error -select_streams v:0 -show_entries packet=pts_time -of csv \
  renders/final.mp4 | head -2

# extract t=0 frame to look at
ffmpeg -i renders/final.mp4 -vframes 1 /tmp/check-t0.png
```

The first packet `pts_time` should be `0.000000` (or very close). `/tmp/check-t0.png` should show the full Scene 1 hero state.

## Sanity check by opening in QuickTime

Open the final `.mp4` in QuickTime Player without pressing play. The paused frame should be the hero state. If it's black, the `tpad` step didn't take — re-run with verbose ffmpeg output to debug.

This is the closest local proxy to "what Twitter will show as the preview thumbnail before someone clicks play". If QuickTime shows hero, Twitter will too.
