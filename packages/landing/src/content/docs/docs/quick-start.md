---
title: Quick Start
description: Get up and running with Spool in under 5 minutes.
---

After [installing Spool](/docs/installation/), you can start searching your data right away.

## 1. Launch Spool

Open Spool from your Applications folder. It starts indexing your Claude Code and Codex sessions automatically.

## 2. Search from the app

Use the search bar to find anything across your indexed data — past agent sessions, bookmarks, starred repos, and more.

## 3. Search from your agent

Inside Claude Code, use the `/spool` skill to search your personal data without leaving your workflow:

```
> build on last month's auth discussion
```

Spool feeds matching fragments from your past sessions directly into the conversation.

## 4. Pull more data with OpenCLI

Use [OpenCLI](https://github.com/jackwener/opencli) to pull bookmarks, stars, and saves from 50+ platforms:

```bash
opencli pull github-stars
opencli pull twitter-bookmarks
```

Spool indexes everything OpenCLI captures.
