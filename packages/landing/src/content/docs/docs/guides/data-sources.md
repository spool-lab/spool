---
title: Data Sources
description: Platforms and data types that Spool can index.
---

Spool indexes data from two main sources: **agent sessions** (watched automatically) and **platform data** (pulled via OpenCLI).

## Agent sessions (automatic)

Spool watches these directories in real time:

| Agent | Path |
|-------|------|
| Claude Code | `~/.claude/projects/` |
| Claude Code (profiles) | `~/.claude-profiles/*/projects/` |
| Codex CLI | `~/.codex/sessions/` |
| Codex CLI (profiles) | `~/.codex-profiles/*/sessions/` |

New sessions become searchable the moment they're written. No manual export needed.

## Platform data (via OpenCLI)

[OpenCLI](https://github.com/jackwener/opencli) pulls your bookmarks, stars, and saves from 50+ platforms to your machine. Spool indexes everything it captures.

### Supported platforms

- **Code**: GitHub Stars, GitLab Stars, Bitbucket
- **Social**: Twitter/X Bookmarks, Reddit Saved, Hacker News Favorites
- **Video**: YouTube Likes, Bilibili Favorites
- **Reading**: Substack, Medium Bookmarks, Pocket, Instapaper
- **Professional**: LinkedIn Saved, Slack Bookmarks
- **Notes**: Notion, Obsidian, Apple Notes
- And 40+ more

### Pulling data

```bash
# Pull from a specific platform
opencli pull github-stars
opencli pull twitter-bookmarks

# Pull from all configured platforms
opencli pull --all
```

Spool watches the OpenCLI output directory and indexes new data as it arrives.
