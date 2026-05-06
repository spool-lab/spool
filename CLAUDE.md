# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev                        # start all packages in dev mode
pnpm build                      # build all packages
pnpm test                       # run all tests
pnpm test:core                  # run @spool-lab/core tests only
pnpm test:e2e                   # run Electron e2e tests
pnpm lint                       # lint all packages
pnpm rebuild:native:node        # rebuild better-sqlite3 for Node (before unit tests)
pnpm rebuild:native:electron    # rebuild better-sqlite3 for Electron (before app/e2e)
pnpm --filter @spool/app build:mac  # local macOS build without cutting a release
```

Run `pnpm rebuild:native:node` before unit tests and `pnpm rebuild:native:electron` before running the app or e2e tests — `better-sqlite3` is a native module that must be rebuilt separately for each target.

## Architecture

Turborepo + pnpm monorepo with four packages:

- **`packages/core`** (`@spool-lab/core`) — indexing engine: watches Claude/Codex/Gemini session dirs on disk, indexes into SQLite with FTS5 full-text search via `better-sqlite3`. This is the data layer everything else depends on.
- **`packages/app`** (`@spool/app`) — Electron macOS app (React + Vite + Tailwind). Consumes `core` to render the session library, project sidebar, pinned sessions, and `⌘K` search overlay.
- **`packages/cli`** (`@spool-lab/cli`) — `spool search ...` terminal command; also provides a `/spool` skill for Claude Code via ACP, feeding matching fragments back into conversations.
- **`packages/landing`** (`@spool/landing`) — standalone marketing site, independent of the other packages.

Data flow: `core` indexes sessions → `app` and `cli` query `core` → `cli` can surface results back into Claude Code via ACP.

The app is Apple Silicon / macOS only.

## Design System

Always read `DESIGN.md` before making any visual or UI decisions.
All font choices, colors, spacing, layout, and aesthetic direction are defined there.
Do not deviate without explicit user approval.

Key rules at a glance:
- Search bar is centered on home screen (Google homepage feel), moves to top on results
- Warm amber accent `#C85A00` (light) / `#F07020` (dark) — never blue or purple
- Warm near-black `#141410` for dark mode — never pure `#000` or cold `#0A0A0A`
- Geist Sans for all UI chrome; Geist Mono for indexed content (fragments, URLs, paths)
- Emoji are placeholder icons only — production UI uses Lucide React SVGs
- Result metadata is first-person: "You discussed this" not "Claude Code · Mar 15"
- "via ACP · local" label always shown on AI-mode answers — non-negotiable trust signal

In QA mode, flag any code that doesn't match DESIGN.md.
