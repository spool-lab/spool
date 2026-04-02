---
title: Agent Integration
description: Use Spool as a search backend for your AI coding agents.
---

Spool is designed to work with AI coding agents. Your agent can search your personal data — past sessions, bookmarks, stars — through the `/spool` skill in Claude Code.

## Claude Code integration

The `/spool` skill is available inside Claude Code. When your agent needs context from previous work, it can search Spool and pull matching fragments directly into the conversation.

### Example usage

```
> build on last month's caching discussion
```

Spool returns matching fragments with source attribution (which session, which platform), and your agent uses them as context.

## How it works

1. Your agent invokes the `/spool` skill with a search query
2. Spool searches the local SQLite index (Claude sessions, Codex sessions, OpenCLI data)
3. Matching fragments are returned with source metadata
4. Your agent incorporates the context into its response

## Other agents

:::note[Coming Soon]
A standalone `spool` CLI is under development, which will allow any agent or script to search the Spool index from the terminal.
:::
