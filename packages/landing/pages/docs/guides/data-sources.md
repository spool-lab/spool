---
title: Data Sources
description: AI agent session sources that Spool indexes.
---

Spool indexes your AI agent sessions automatically. Each source is watched in real time — new sessions become searchable the moment they're written, no manual export needed.

## Agent sessions

| Agent | Path |
|-------|------|
| Claude Code | `~/.claude/projects/` |
| Claude Code (profiles) | `~/.claude-profiles/*/projects/` |
| Codex CLI | `~/.codex/sessions/` |
| Codex CLI (profiles) | `~/.codex-profiles/*/sessions/` |
| Gemini CLI | `~/.gemini/tmp/*/chats/` |

## Platform data (Twitter, GitHub, Reddit, etc.)

Connector-based platform sync (bookmarks, stars, saves) lives in **[Spool Daemon](/daemon/)**, a sibling app. Daemon's captures show up alongside Spool sessions in the same search box when both apps are installed.
