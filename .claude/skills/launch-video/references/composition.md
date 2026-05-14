# Composition

The proven HyperFrames composition layout. Copy from
`videos/launch-template/index.html` and customise per release; this doc
explains *why* the template looks the way it does so you don't accidentally
revert hard-won decisions.

## Canvas + window dimensions

| Element | Value | Notes |
|---|---|---|
| Canvas | 1920×1080 | 16:9, Twitter-friendly |
| Window logical size | 1000×685 | Renders the captured 1080×740 .mov at 1.46:1 aspect |
| Window position | left 700, top 197 | Right of canvas centre, vertical centre |
| Window `border-radius` | 8px | Matches macOS native window curve in the captured `.mov`. Smaller → `screencapture -R` desktop background bleeds into corners. Larger → app chrome gets clipped. |
| Drop shadow | three layers (60/120, 24/48, 6/12 px) | Gives a "floating" feel. Single-layer shadow looks flat. |

## Text panel (left)

- `x=132, top=410, width=540`
- Three rows: `panel-kicker` (mono, 13px) → `panel-headline` (sans 70px, 2 lines, weight 600, letter-spacing -0.05em) → `panel-sub` (18px, 1.45 line-height)
- Amber accent bar before the kicker (`width: 40px, height: 2px`)
- Period in headline ends with `<span class="accent">.</span>` for the amber dot

## Persistent brand mark (top-left)

- `x=132, top=200`, always visible
- `Spool. vX.Y.Z · Launch` in 26px wordmark + 11px mono version
- Anchors the composition; without it the left-third can feel empty during scene 1

## Camera moves

Camera = `transform-origin + scale` on the `.window`. The annotation rectangles inherit the same transform because they live inside `.window`.

| Scene | Pattern |
|---|---|
| First-screen / overview | No zoom (`scale: 1`) |
| Sidebar collapse / expand | Light zoom (`scale: 1.12–1.18`) with origin near sidebar centre (`8%, 50%`) |
| Pinned-section emergence | Tight zoom (`scale: 1.25–1.35`) with origin on top-left sidebar (`12%, 17%`) |
| Updater banner | Tight zoom (`scale: 1.28–1.5`) with origin on bottom-left sidebar (`10%, 85–95%`) |

Avoid:
- Smooth slow drifts during a scene — they read as "PowerPoint pan" not "trailer move". Zoom into a region, hold, cut.
- "Pull back to neutral" before the outro — end on the feature focus, cut to the lockup.

## Annotation rectangles

The amber outline that says "look here". Lives inside `.window`. Coords are in `%` of the un-transformed window.

```html
<div id="annot-feature-X" class="annot"></div>
<div id="annot-feature-X-label" class="annot-label">Feature X</div>
```

```css
#annot-feature-X { left: 1%; top: 15%; width: 21%; height: 16%; }
#annot-feature-X-label { left: 1%; top: 10.5%; }
```

**Measuring annotation coords (do this fresh every release):**

1. Pick a raw `.mov` frame where the feature is fully visible. Extract with
   `ffmpeg -ss <t> -i <clip>.mov -frames:v 1 frame.png`.
2. Crop the relevant region:
   `ffmpeg -i frame.png -vf "crop=600:600:0:0" cropped.png` (adjust to where
   the feature lives in the frame).
3. Open the crop in any image viewer that shows pixel coords. Measure the
   bounding box of the feature region in source pixels.
4. Divide by the source frame dimensions (typically 2160×1480 for retina
   recordings) to get `%`. Apply small internal padding (1% on left/right)
   so the rectangle has breathing room.

Symmetry matters — `left: 0.5%, width: 22%` will look unbalanced (touches
sidebar left edge but stops short of right edge). Pick `left: 1%, width: 20%`
for symmetric inset.

## Annotation timing

Fade the annotation in **after** the feature is fully visible in the clip,
not when the clip starts. For example, if the `PINNED · N sessions` strip
finishes populating at clip-time `2.5s`, the annotation should fade in at
timeline `clip-start + 2.5s + 0.1s`. Earlier = empty rectangle on screen.

Fade out **with the scene**, not after. When the panel exits and the camera
transitions, the annotation goes with them.

## Beat sync

Run `ffmpeg -i bgm.mp3 -af "highpass=200,lowpass=4000,silencedetect=n=-30dB:d=0.05" -f null -` to find strong beats in the BGM (look at `silence_end` timestamps). Align:

- Scene cuts (clip swap) — to a beat if possible
- Camera punches — to a beat
- Annotation fade-ins — slightly after a beat (so it lands as an answer to the beat, not on it)

The video doesn't need to be tightly beat-locked — just lining up the major
moments to phrase boundaries makes the whole thing feel intentional.

## Panel + annotation animations

Already encoded in the template as `panelIn()`, `panelOut()`, `zoomTo()`,
`clipFade()` GSAP helpers. Don't rewrite them per release; just call them
with new timing values.

Word-by-word stagger on `panel-headline` is the one place where motion is
*allowed* to be slightly playful — keeps the text from feeling like a static
slide.
