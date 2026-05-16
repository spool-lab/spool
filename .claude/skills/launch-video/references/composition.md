# Composition

The proven HyperFrames composition layout. Copy from `videos/launch-template/index.html` and customise per release; this doc explains *why* the template looks the way it does so you don't accidentally revert hard-won decisions.

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

1. Pick a raw `.mov` frame where the feature is fully visible. Extract with `ffmpeg -ss <t> -i <clip>.mov -frames:v 1 frame.png`.
2. Crop the relevant region: `ffmpeg -i frame.png -vf "crop=600:600:0:0" cropped.png` (adjust to where the feature lives in the frame).
3. Open the crop in any image viewer that shows pixel coords. Measure the bounding box of the feature region in source pixels.
4. Divide by the source frame dimensions (typically 2160×1480 for retina recordings) to get `%`. Apply small internal padding (1% on left/right) so the rectangle has breathing room.

Symmetry matters — `left: 0.5%, width: 22%` will look unbalanced (touches sidebar left edge but stops short of right edge). Pick `left: 1%, width: 20%` for symmetric inset.

## Annotation timing

Fade the annotation in **after** the feature is fully visible in the clip, not when the clip starts. For example, if the `PINNED · N sessions` strip finishes populating at clip-time `2.5s`, the annotation should fade in at timeline `clip-start + 2.5s + 0.1s`. Earlier = empty rectangle on screen.

Fade out **with the scene**, not after. When the panel exits and the camera transitions, the annotation goes with them.

## Spotlight focus (alternative to amber rectangles)

For releases where the action is "user clicks control X, preview Y changes" — i.e. cause-and-effect, not "look at this strip" — use a spotlight mask instead of amber rectangles. See `spotlight.md` for the full pattern. Brief summary:

- SVG mask with 1–2 transparent holes punched through a dim overlay
- Holes' coords retarget via `tl.set` (hard snaps, no morph)
- Single hole for one-target scenes; dual hole for "preview + control" scenes
- Soft alpha falloff at hole edges hides ±10px coordinate drift — much more forgiving than amber outlines, which read as misaligned at ±3px

A single composition can mix both: amber rectangles for "look here" scenes, spotlight for "watch this control move that preview" scenes.

## Panel-leads-spotlight timing

The single most impactful rule for readability. When `panelIn()` and the spotlight retarget (or annotation reveal) fire at the same instant, the viewer's eyes don't know whether to read or watch — they end up doing neither.

Stagger them:

```
t=0.00s   panelIn()                           ← headline anchors first
t=0.40s   spotlightSnap(...) or annotation    ← eye guided to focal region
t=0.80s   click / state change                ← action lands
```

The 0.4s lead is the natural-feel range. Anything below 0.25s reads as simultaneous; above 0.6s reads as a delay.

If your scene has only one panel-led beat per scene, this is automatic. For multi-click scenes where the spotlight retargets per click, only the *first* spotlight needs the lead — subsequent retargets can fire ~0.3–0.4s before each click.

## Beat sync

Two tools, pick by BGM type:

- `ffmpeg -i bgm.mp3 -af "highpass=200,lowpass=4000,silencedetect=n=-30dB:d=0.05" -f null -` — finds silence boundaries, good for tracks with clear gaps between phrases
- `brew install aubio && aubiotrack bgm.mp3 | awk 'NR % 4 == 0 || NR == 1'` — beat-tracks the music itself, returns timestamps every 4 beats (~half-phrase). More reliable for atmospheric or sustained tracks where `silencedetect` returns nothing

Align:

- Scene cuts (clip swap) — to a beat / phrase boundary if possible
- Camera punches — to a beat
- Outro fade-in — to a phrase boundary (the lockup landing on a musical resolution feels intentional)
- Annotation fade-ins — slightly after a beat (so it lands as an answer to the beat, not on it)

The video doesn't need to be tightly beat-locked — just lining up the major moments to phrase boundaries makes the whole thing feel intentional.

## BGM duration mismatch

If your video needs to be longer than the source BGM (e.g. a 39s 7-beat video on a 30s track), stretch the audio with `atempo`:

```bash
ffmpeg -i source.mp3 -filter:a "atempo=0.85,afade=t=out:st=37.9:d=0.8" -t 38.75 -b:a 192k out.mp3
```

Quality floor by tempo factor:

- **0.85** — slight pitch drop, no audible quality loss. The comfortable default for ~15% extension.
- **0.79** — still acceptable, mild "underwater" feel on percussive tracks; fine for atmospheric.
- **< 0.75** — starts to degrade. Either find a longer BGM or split the video.

Always append a 0.6–0.8s `afade=t=out` tail so the music decays into the lockup instead of stopping flat.

## Artifact fan (optional capstone scene)

For releases whose centrepiece produces a tangible export (PDFs, share files, etc), an optional scene *between* the final feature beat and the brand outro: four document cards materialise centre-stage as a stylised fan, each pairing a paper × template combo with a format tag.

Why it works:

- The Export scene shows the *mechanism* (open a dropdown, see 4 formats). The artifact scene shows the *outcome* (here are 4 documents leaving the editor). Together they close the "tune → publish" arc.
- Cards are pure CSS — no new captures, no fake browsers, no fake Twitter / Slack screenshots. The documents themselves are the demo.

Composition:

- 4 cards, 220×300px each, arranged in a subtle fan: rotations roughly -10° / -3° / +3° / +10°, slight Y arc (corner cards drop ~30px below middle cards)
- Each card has: paper background colour (mirrors `share-kit`'s `PaperDef`), header with `Spool.` mark + template name, body in template-faithful style, bottom-left format tag (mono uppercase), bottom-right meta line (page count, image dimensions, file type)
- Body styles are stylised per template: chat bubbles for Chat, threaded posts with avatars for Forum, vertical rail with markers for Timeline, monospace `# heading > quote` source view for Markdown (the MD card deliberately shows source code, not rendered output — that's what an .md file actually is, and the visual contrast against the other three keeps the formats distinct)
- Stagger in 0.10–0.15s apart over ~0.55s each, hold 0.7–1.5s, fade out
- Total scene: 3–4s including transitions

Skip this scene if the release isn't export-focused — it adds runtime and would feel forced for, say, a sidebar polish release. Earned only when the export itself is the headline.

## Panel + annotation animations

Already encoded in the template as `panelIn()`, `panelOut()`, `zoomTo()`, `clipFade()` GSAP helpers. Don't rewrite them per release; just call them with new timing values.

The `clipCut(outSel, inSel, at)` helper that swaps videos should use the v0.5.0 timings — incoming clip opacity 1 at `at - 0.20`, outgoing opacity 0 at `at + 0.10` — so the renderer has time to decode the incoming clip's first frame before the outgoing one disappears. A tighter overlap can produce a one-frame dark gap that reads as a flash. See `pitfalls.md` #11.

Word-by-word stagger on `panel-headline` is the one place where motion is *allowed* to be slightly playful — keeps the text from feeling like a static slide.

## End-of-timeline anchor

The composition's last frame must be the lockup, not a fade-to-blank. GSAP's `fromTo` keeps a tween at its end-state after completion, but at the timeline's natural end the renderer may revert to the from-state if you don't pin the final state explicitly. Add zero-duration `.to()` tweens just before the composition boundary:

```js
tl.fromTo("#outro-lockup",
  { y: 10, opacity: 0, scale: 0.98 },
  { y: 0, opacity: 1, scale: 1, duration: 0.55, ease: "power3.out" }, 33.80);
// Anchor the held state at the composition boundary so the last
// frame is the lockup, not a fade-to-blank.
tl.to("#outro-lockup", { opacity: 1, y: 0, scale: 1, duration: 0.001 }, 35.49);
tl.to("#outro",        { opacity: 1, duration: 0.001 }, 35.49);
tl.to("#outro-fade",   { opacity: 1, duration: 0.001 }, 35.49);
```

The composition `data-duration` is 35.50 in this example; the anchor tweens fire at 35.49 to guarantee the last rendered frame holds the lockup's full opacity.
