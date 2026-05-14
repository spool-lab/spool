# Capture

How to record the Spool Electron app as a native macOS window. Output is a
`.mov` per feature, used as the source for each scene in the composition.

## Why native window, not Playwright screenshots

Playwright's `page.screenshot()` and `video` recording only capture the
WebContents — no traffic lights, no rounded corners, no shadow. The
composition shows the window-on-stage, so we need the real OS window.

Solution: capture the rectangular region the macOS window occupies via
`screencapture -R`. Use a Swift one-liner to find the Quartz window id
matching the Electron process pid + bounds.

## Helper functions (already in `packages/app/e2e/helpers/`)

- `nativeWindowInfo(app)` — returns `{id, x, y, width, height}` for the
  front-most Electron BrowserWindow.
- `captureNativeWindow(app, path)` — single PNG (uses `screencapture -l <id>`).
- `recordNativeWindow(app, path, seconds, perform)` — runs `screencapture
  -V <seconds> -R <rect>` while `perform()` drives the app concurrently.
- `launchDemoApp(seed)` + `setDemoWindowBounds(ctx, 1080, 740)` — boot
  Electron with programmatic fixtures, force dark, set canonical size.
- `emitUpdateStatus(app, payload)` — push updater banner state via IPC.
- `pinFirstRowInProject(window, name)` — hover + pin first session row.

## Authoring the per-release seed

Each release demos different features → different sidebar content.

Build a `ProjectSeed[]` (type in `packages/app/e2e/helpers/demo-fixtures.ts`):

```ts
import type { ProjectSeed } from '../e2e/helpers/demo-fixtures'

const PROJECTS: ProjectSeed[] = [
  {
    name: 'spool',
    total: 79,
    leadSessions: [
      { title: 'Audit the share flow in a fresh worktree', source: 'claude', iso: '2026-05-13T15:12:00Z' },
      // ... more titles per project
    ],
    fillerSources: ['claude', 'codex'],
  },
  // ... more projects
]
```

**Rules for seed data:**

- English-only titles
- **Must not reference real user sessions** — invent plausible titles thematically
  relevant to the release (e.g. for a share-feature release, titles about
  "share flow review", "share rate limiting", etc).
- 10–15 projects total feels right in the sidebar.
- One project's `total` should be high (≥ 70) to demo the count badge.
- Mix `source` between `claude` and `codex` so the badges look varied.

## Writing the ad-hoc capture spec

The capture spec is **per-release, not committed**. Put it at
`packages/app/e2e/release-capture.spec.ts` and gitignore-add it (or just
delete after the release ships).

Structure:

```ts
import { test } from '@playwright/test'
import { launchDemoApp, setDemoWindowBounds, waitForDemoSync } from './helpers/demo-launch'
import { recordNativeWindow } from './helpers/native-window-capture'
import { emitUpdateStatus, pinFirstRowInProject } from './helpers/demo-interactions'

const PROJECTS = [/* per-release seed */]

const OUT_DIR = path.join(__dirname, '../../../videos/spool-vX.Y.Z/assets/live')

test('record release clips', async () => {
  test.setTimeout(180_000)

  const ctx = await launchDemoApp(PROJECTS)
  await setDemoWindowBounds(ctx, 1080, 740)
  await waitForDemoSync(ctx.window)

  await recordNativeWindow(ctx.app, path.join(OUT_DIR, '01-home.mov'), 4.0, async () => {
    // Drive the app for ~4s while screencapture records.
    // e.g. ctx.window.mouse.wheel(0, 900)
  })

  // ... more clips per feature

  await ctx.cleanup()
})
```

Run with:
```bash
pnpm --filter @spool/app exec playwright test e2e/release-capture.spec.ts --workers=1
```

## Capture-time constants

| | Value | Why |
|---|---|---|
| Window logical size | 1080×740 | Matches app default (`packages/app/src/main/index.ts`); the composition assumes this aspect |
| Theme | dark forced | `nativeTheme.themeSource = 'dark'` in `setDemoWindowBounds()` |
| GPU | disabled | `ELECTRON_DISABLE_GPU=1` for deterministic frames |
| `screencapture` cursor | off | Default. Add `-C` to args if you want the system cursor in frame — usually you don't, the simulated cursors look unnatural |

## Common capture issues

- **Window not found.** `screencapture -R` failures usually mean the Electron
  window hasn't focused. Call `app.focus({steal: true})` + `win.focus()` before
  recording.
- **Playwright `mouse.click()` does NOT move the OS cursor.** It dispatches
  DOM events directly. If you need cursor-in-frame, drive the OS cursor
  separately (e.g. `cliclick`) — but this is usually a sign you should drop
  the cursor entirely and let the UI change carry the story.
- **First-frame black pixels in the output `.mov`.** `screencapture -V` has
  ~21ms latency before the first frame lands. Padded out at composition time
  via `tpad` (see `poster.md`).
- **Timing slips between perform() and screencapture.** `recordNativeWindow`
  starts the recording, then runs `perform()`. There's a ~500ms lead-in
  where you can `waitForTimeout` to settle before the first action.
