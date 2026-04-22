---
title: Data Sources
description: Platforms and data types that Spool can index.
---

Spool indexes data from two main sources: **agent sessions** (watched automatically) and **platform data** (pulled via connector plugins).

## Agent sessions (automatic)

Spool watches these directories in real time:

| Agent | Path |
|-------|------|
| Claude Code | `~/.claude/projects/` |
| Claude Code (profiles) | `~/.claude-profiles/*/projects/` |
| Codex CLI | `~/.codex/sessions/` |
| Codex CLI (profiles) | `~/.codex-profiles/*/sessions/` |
| Gemini CLI | `~/.gemini/tmp/*/chats/` |

New sessions become searchable the moment they're written. No manual export needed.

## Platform data (via connector plugins)

Connector plugins pull your bookmarks, stars, and saves from various platforms to your machine. Spool indexes everything they capture.

### Supported connectors

- **Code**: GitHub Stars, GitLab Stars, Bitbucket
- **Social**: Twitter/X Bookmarks, Reddit Saved, Hacker News Favorites
- **Video**: YouTube Likes, Bilibili Favorites
- **Reading**: Substack, Medium Bookmarks, Pocket, Instapaper
- **Professional**: LinkedIn Saved, Slack Bookmarks
- **Notes**: Notion, Obsidian, Apple Notes

### Syncing data

```bash
# Install a connector
spool connectors install twitter-bookmarks

# Sync all installed connectors
spool connectors sync
```

Spool indexes new data from connectors as it arrives.
