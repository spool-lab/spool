# Pitfalls

What we tried during v0.4.11 that looked bad in motion, and what to do
instead. Read this **before** improvising on the proven layout.

## 1. Faked cursors look uncanny

We built three iterations of an overlaid SVG cursor that flew across the
screen to "click" buttons. Every version felt wrong:

- Linear motion → robotic
- Bezier + overshoot → bouncy in a video-game way
- Designed amber dot with click pulse → still felt artificial because it
  wasn't synced to anything physical in the clip

**Why:** the real clip has no cursor. Adding one creates a disconnect
between the cursor's "intent" and the UI's actual response timing.

**Do instead:** drop the cursor entirely. Use amber annotation rectangles
to call out the *result* of an interaction (the new pinned section, the
status banner change). The viewer doesn't need to see the click — they
see the effect.

If you absolutely need to show a click for clarity, a single amber pulse
ring at the click point (no cursor) is the most you should add.

## 2. Decorative chrome adds nothing

We tried, in turn: a vignette over the canvas, a top-right "callsign"
(`SPOOL · v0.4.11 · LAUNCH`), a bottom 1px amber progress strip, a film
grain overlay. Each one made the video feel more "designed" and *less*
intentional — like a YouTuber's title sequence rather than a product
announcement.

**Do instead:** trust the brand mark in the top-left and the text panel
on the left to anchor the composition. The amber annotations on the
demo window are the only accent layer that earns its place.

## 3. PPT-style title cards kill momentum

First attempt: each scene started with a centered title card (kicker +
big headline), held for ~1s, then cut to the demo. Watching back it
felt like a slide deck.

**Why:** the pause between "title" and "demo" makes the viewer's brain
treat them as separate beats — interrupting the flow.

**Do instead:** text panel + demo coexist continuously. The panel
contents change per scene, the demo plays in parallel. Hard-cuts
between feature clips, no card pauses.

## 4. Smooth multi-second camera drifts feel like PowerPoint pans

We tried slow zooms (~3s) over a scene to "show" the feature area.
Reads as a Ken Burns slideshow effect, not a trailer move.

**Do instead:** zoom into the focal region within ~0.6s (`power2.inOut`),
hold there for the scene, then hard-cut to the next. Camera moves are
short and motivated, not ambient.

## 5. "Pull back to neutral" before the outro feels deflating

We had the camera zoom back out to `scale: 1` before fading to the
Spool lockup. It made the ending feel like the show was retreating
instead of resolving.

**Do instead:** end scene 4 on its feature focus. Fade window + brand +
annotation directly to the outro card from that zoomed state. The cut
is sharper.

## 6. First frame must be content, not animation prelude

When window/panel/brand mark all fade in from `opacity: 0` over the
first 0.5s, the encoded MP4's first frame is mostly black. Twitter
auto-thumbnails grab that black frame as the preview.

**Do instead:** scene 1's elements (`#panel1`, `#window`, `#brand-mark`)
must be `opacity: 1` at `t=0` in the CSS. No entrance animation for
scene 1. Then `tpad clone` the first 0.5s during post-processing for
extra insurance (see `poster.md`).

## 7. The annotation rectangle position is per-release

`pinned-section: top 15%, height 13%` was right for v0.4.11. For
v0.5.0 the UI WILL be different — different feature regions, possibly
different sidebar density, etc.

**Don't:** copy old coords forward.
**Do:** measure fresh from your captured `.mov` frames every release.
The `composition.md` reference explains how.

## 8. Avoid background-bleed at window corners

`screencapture -R` records a rectangle. Outside the macOS window's
rounded corners, you see the desktop background — sometimes white,
sometimes light depending on the user's wallpaper.

**Solution:** the `.window` element in the composition has
`border-radius: 8px; overflow: hidden`. This clips the corners to a
radius close enough to macOS's native that no background pixels show.

`8px` is empirically right. Smaller → background bleeds through.
Larger → app chrome (traffic lights) gets clipped.

## 9. Don't beat-lock everything

The video has ~6–8 strong beats from the BGM. Don't try to land every
scene cut + annotation reveal + camera move on a beat — over-syncing
reads as desperate.

**Do:** anchor the major scene transitions to phrase boundaries
(every ~7s in our BGM). Let everything else float naturally.

## 10. Real screen recordings, not mock UIs

Early v0.4.11 attempts (livecut v1–v6) used a hand-built HTML mockup
of the Spool UI inside the composition. It iterated for hours and
still looked uncanny — wrong row heights, wrong icons, wrong rhythm.

**Lesson:** always record the real Electron app. The capture pipeline
exists for a reason. Don't try to recreate the UI in HTML, ever.
