# @spool/share-kit

Internal React library that powers Spool's share editor — templates, exporters, parsers, and the snapshot type. Consumed by `@spool/app` (Electron renderer) and, in Phase 1, by `@spool/share-web`.

## Status

Phase 0 scaffold. Source ports from the standalone `quilt` demo project land in subsequent commits.

## Scripts

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # vite build (lib mode) → dist/index.js + dist/index.d.ts
```

## Layout (target — incoming over PR 1)

```
src/
  snapshot/      Snapshot type, serialize, new-draft helpers
  editor/        Editor surface, TurnList, StylePanel, TopBar
  canvas/        LivePreview
  templates/     Atelier / Letter / Transcript / Interview / Ribbon
  exporters/     png, pdf, spool-file
  parsers/       r.jina.ai + per-source extractors (Phase 1)
  components/    Icons, source-mark, wordmark
  styles/        Fonts + tokens + global CSS
  lib/           Type registries, fixtures, redaction detection
```
