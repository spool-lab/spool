---
name: launch-video
description: Use when creating a launch, release, or announcement video for the Spool desktop app from real screen recordings. Covers the capture pipeline (Electron + native macOS window recording), the HyperFrames composition layout, common trailer-vs-PPT pitfalls, and the first-frame poster trick for social media. Invoke when the user mentions release video, launch video, announcement video, trailer, demo video, or wants to ship a video for a Spool version bump.
user-invocable: true
argument-hint: "[version (e.g. v0.5.0)]"
---

Build a release video for a Spool version. The output is a 1080p MP4 plus a
poster JPG, intended for X / Twitter. Total runtime ≈ 20s, four feature
beats + brand outro.

## Mental model

A release video for Spool has two halves running in parallel on screen:

1. **Left third** — a text panel that introduces the current scene
   (kicker `01 / 04 — POLISH`, a 2-line headline, a 1–2 line sub).
2. **Right two-thirds** — the real Spool app, recorded as a native macOS
   window. The camera (CSS `transform-origin + scale` on the `.window`)
   zooms into the specific UI region for each feature.

Amber annotation rectangles, positioned inside `.window` so they track the
camera, call out the new feature region (`PINNED · 2 sessions` strip,
`Update available` banner, etc).

This is **not** a PPT: text panel and demo coexist continuously, with hard
match-cuts between feature clips. Don't reintroduce slide-style title cards.

## Required preparation

Read these references before you start composing. They are not optional —
each captures hard-won decisions from prior releases.

- `references/composition.md` — the proven layout, dimensions, drop-shadow
  recipe, panel + annotation timing patterns, beat-sync approach
- `references/capture.md` — how to record native macOS windows of the
  Electron app, helper functions to use, per-release seed authoring
- `references/pitfalls.md` — things we tried that look bad in motion
  (faked cursor, decorative chrome, smooth camera drifts, etc.) and why
- `references/poster.md` — the `tpad clone` trick so Twitter's auto-
  thumbnail grabs the hero frame instead of a leading black frame

## End-to-end checklist

1. **Inventory the features to demo.** A release video shows 3–4 features
   max. Pick the ones with the most visible UI change.
2. **Author a per-release seed.** Write a `ProjectSeed[]` array (see
   `packages/app/e2e/helpers/demo-fixtures.ts` for the type). Titles
   should be English-only and **must not reference real user sessions**
   — invent plausible session titles relevant to the release theme.
3. **Write an ad-hoc capture spec.** A Playwright spec under
   `packages/app/e2e/` (not committed) that:
   - Calls `launchDemoApp(seed)` + `setDemoWindowBounds(ctx, 1080, 740)`
   - Records one `.mov` per feature via `recordNativeWindow()` from
     `helpers/native-window-capture.ts`
   - Outputs to `videos/spool-vX.Y.Z/assets/live/` (gitignored)
4. **Copy `videos/launch-template/` to `videos/spool-vX.Y.Z/`.**
5. **Customise the composition** (`index.html`):
   - Update `<video>` `data-start`, `data-duration`, `src` per clip
   - Author one text panel per scene (kicker + headline + sub)
   - **Measure annotation coords fresh** from your raw `.mov` frames —
     last release's `top: 15%` is wrong for this release
   - Update the brand-mark version + outro version strings
6. **Drop in BGM** at `assets/bgm.mp3`. Identify strong beats with
   `ffmpeg silencedetect`; align scene cuts or camera punches to them.
7. **Iterate with drafts.**
   ```
   cd videos/spool-vX.Y.Z
   npm run check     # lint + validate + inspect
   npm run render -- --quality draft --output renders/draft.mp4
   ```
   Pull frames at scene boundaries to verify before re-rendering.
8. **Render standard quality.**
   ```
   npm run render -- --quality standard --output renders/spool-vX.Y.Z-raw.mp4
   ```
9. **Patch the first frame** for social media (see `references/poster.md`).
   The output of this step is the file you upload to X.
10. **Extract a poster JPG** for tweet thumbnail fallback / preview imagery.

## Hard rules

- **No simulated cursor.** Real screen recordings show real interactions;
  faked GSAP cursors look uncanny. If a click is invisible in the clip,
  use an amber annotation to call out the *result*, not the action.
- **First frame must be the full hero state.** Brand mark + panel 1 + UI
  window all visible at `t=0`, not faded in. Twitter's auto-thumbnail
  grabs this frame.
- **Annotations live inside `.window`**, not on the outer canvas. They
  must move with the camera transform.
- **No decorative chrome.** No vignette, callsign, progress bar, or
  trailer-style overlay flashes. The UI is the protagonist.
- **No "pull back to neutral" before the outro.** End scene 4 on its
  feature focus, then hard-cut/fade to the Spool lockup.

## Files this skill touches

- Reads: `packages/app/e2e/helpers/{demo-fixtures,demo-launch,demo-interactions,native-window-capture}.ts`
- Reads: `videos/launch-template/`
- Creates: `videos/spool-vX.Y.Z/` (new release directory)
- Creates: a temporary Playwright spec under `packages/app/e2e/` (do not commit)
- Outputs: `videos/spool-vX.Y.Z/renders/spool-vX.Y.Z-final.mp4` and `.jpg` poster (both gitignored)
