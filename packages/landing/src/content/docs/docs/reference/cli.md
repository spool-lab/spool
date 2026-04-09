---
title: CLI Commands
description: Reference for the spool command-line interface.
---

:::note[Coming Soon]
The standalone `spool` CLI is under development. Currently, you can search your data through the Spool app or the `/spool` skill in Claude Code.
:::

The `spool` CLI will let you search your indexed data directly from the terminal.

## Planned commands

### `spool search`

Search across all indexed sources.

```bash
spool search "auth middleware"
spool search "auth middleware" --source claude
spool search "auth middleware" --source gemini
spool search '"auth middleware"'
```

By default, whitespace-separated terms are treated as a multi-keyword search, so `auth middleware` can match entries that contain both terms even when they are not adjacent. Natural multi-term searches prioritize exact phrase hits first, then broader all-terms matches. If you want an exact phrase match only, pass explicit FTS quotes inside the query, for example `spool search '"auth middleware"'`.

### `spool index`

Manually trigger re-indexing.

```bash
spool index
```

### `spool status`

Show indexing status and statistics.

```bash
spool status
```
