---
title: Agent Integration
description: Use Spool as a search backend for your AI coding agents.
---

:::note[Coming Soon]
Agent integration is under active development. The `/spool` skill and standalone CLI are not yet functional — stay tuned.
:::

Spool is designed to work with AI coding agents. Once the integration is ready, your agent will be able to search your personal data — past sessions, bookmarks, stars — without leaving your workflow.

## Planned: Claude Code skill

A `/spool` skill for Claude Code is in progress. It will let your agent search past sessions and pull matching context directly into the current conversation.

### Example (planned)

```
> build on last month's caching discussion
```

Spool will return matching fragments with source attribution (which session, which platform), and your agent will use them as context.

## Planned: CLI integration

A standalone `spool` CLI is also under development, which will allow any agent or script to search the Spool index from the terminal.

## How it will work

1. Your agent sends a search query to Spool
2. Spool searches the local SQLite index (Claude sessions, Codex sessions, connector data)
3. Matching fragments are returned with source metadata
4. Your agent incorporates the context into its response
