---
title: Quick Start
description: Get up and running with Spool in under 5 minutes.
---

After [installing Spool](/docs/installation), you can start searching your sessions right away.

## 1. Launch Spool

Open Spool from your Applications folder. It starts indexing your Claude Code, Codex, and Gemini CLI sessions automatically.

## 2. Search from the app

Use the search bar to find anything across your indexed sessions. Try a keyword from a recent conversation — it's there the moment the session file is written.

## 3. Search from your terminal

The bundled CLI runs the same search engine:

```bash
spool search "auth middleware"
spool list -n 10
spool show <uuid>
```

## What about platform data (Twitter, GitHub, Reddit, …)?

Bookmarks, stars, and saves live in **[Spool Daemon](/daemon/)** — a sibling app focused on capture sync. Once you install Daemon, its captures appear alongside Spool sessions in the same search box.
