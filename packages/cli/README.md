# @spool-lab/cli

Command-line interface for [Spool](https://spool.pro) — search your AI sessions and manage connector plugins from the terminal.

## Install

```bash
npm install -g @spool-lab/cli
```

This gives you the `spool` command.

## Commands

### Search & browse

```bash
spool search <query>           # Full-text search across all AI sessions
spool search "auth" --json     # Output as JSON
spool search "bug" -n 5        # Limit results
spool search "fix" --since 7d  # Only recent sessions

spool list                     # List recent sessions
spool list -s claude -n 10     # Filter by source
spool list --json              # Output as JSON

spool show <uuid>              # Print full session content
spool show <uuid> --json       # Output as JSON

spool status                   # Show index stats (session count, DB size)
```

### Sync

```bash
spool sync                     # Index new AI sessions (Claude, Codex, Gemini)
spool sync --watch             # Keep watching for new sessions
```

### Connector management

```bash
spool connector list                              # List installed connectors
spool connector list --json                       # Output as JSON
spool connector install <package>                 # Install from npm
spool connector install @spool-lab/connector-github -y  # Skip confirmation
spool connector uninstall <id>                    # Remove a connector + data
spool connector status <id>                       # Detailed sync state + auth check
spool connector sync <id>                         # Run sync manually
spool connector sync <id> --reset                 # Clear data and resync
spool connector update                            # Check all for npm updates
spool connector update --apply                    # Apply available updates
```

## Available connectors

Browse the full list at [spool.pro/connectors](https://spool.pro/connectors). Some examples:

```bash
spool connector install @spool-lab/connector-github
spool connector install @spool-lab/connector-twitter-bookmarks
spool connector install @spool-lab/connector-reddit
spool connector install @graydawnc/connector-youtube
```

## Data location

All data is stored locally in `~/.spool/`:
- `spool.db` — SQLite database with sessions, messages, and captures
- `connectors/` — installed connector plugins

## License

MIT

## Trademark

Spool™ is a trademark of TypeSafe Limited. The MIT License covers the source code only and does not grant permission to use the Spool name or logo.
