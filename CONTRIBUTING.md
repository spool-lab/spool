# Contributing to Spool

Thanks for your interest in contributing! Spool is early-stage and we welcome all kinds of help.

## Getting started

```bash
git clone https://github.com/spool-lab/spool.git
cd spool
pnpm install
pnpm dev
```

## Native module runtimes

`better-sqlite3` is used from both Node-based tests and the Electron app. Rebuild it for the runtime you are about to use:

```bash
pnpm run rebuild:native:node      # Node / vitest / core tests
pnpm run rebuild:native:electron  # Electron app / Playwright e2e
```

If you hit a `NODE_MODULE_VERSION` mismatch, rerun the matching rebuild command and try again.

## Installing a local build (macOS)

To test a production build of the app locally — builds, installs to `/Applications/Spool.app`, and launches it:

```bash
pnpm dev:install:mac
```

Requires Apple Silicon. The script quits any running Spool instance before replacing the bundle and strips the quarantine attribute so Gatekeeper doesn't block the unsigned local build.

## Project structure

```
packages/
  app/      Electron macOS app (React + Vite + Tailwind)
  core/     Indexing engine (SQLite + FTS5)
  cli/      CLI interface
  landing/  spool.pro website
```

## Making changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `pnpm test` to make sure nothing is broken
4. Open a pull request

## What to work on

- Check [Issues](https://github.com/spool-lab/spool/issues) for bugs and feature requests
- Small fixes (typos, docs, UI polish) are always welcome — no issue needed
- For larger changes, open an issue first so we can discuss the approach

## Style

- No linter config yet — just match the surrounding code style
- Commit messages: `feat:`, `fix:`, `docs:`, `ci:`, `refactor:`

## Community

- [Discord](https://discord.gg/aqeDxQUs5E) for questions and discussion
- [Issues](https://github.com/spool-lab/spool/issues) for bugs and feature requests
