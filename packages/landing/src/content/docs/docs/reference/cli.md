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
```

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
