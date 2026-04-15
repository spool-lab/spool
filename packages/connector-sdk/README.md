# @spool-lab/connector-sdk

The plugin contract for [Spool](https://spool.pro) connectors. A Spool connector is a small npm package that knows how to pull items from one source — a remote API, a browser session, a local database, a CLI tool — and hand them to Spool's sync engine as `CapturedItem`s. The host app indexes them, makes them searchable, and feeds them to AI agents.

This package is zero-dependency types + a handful of helpers. You depend on it to write a connector; the Spool app provides the runtime implementations of every capability.

## Minimal connector

Three files and ~40 lines of code.

**`package.json`** — your connector is identified by `spool.type: "connector"`:

```json
{
  "name": "@you/connector-example",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "peerDependencies": {
    "@spool-lab/connector-sdk": "^0.1.0"
  },
  "spool": {
    "type": "connector",
    "connectors": [
      {
        "id": "example",
        "platform": "example",
        "label": "Example",
        "description": "One line about what this captures",
        "color": "#000000",
        "ephemeral": false,
        "capabilities": ["fetch", "log"]
      }
    ]
  }
}
```

**`src/index.ts`** — implement `Connector`:

```ts
import type {
  Connector,
  ConnectorCapabilities,
  AuthStatus,
  FetchContext,
  PageResult,
} from '@spool-lab/connector-sdk'
import { SyncError, SyncErrorCode } from '@spool-lab/connector-sdk'

export class ExampleConnector implements Connector {
  readonly id = 'example'
  readonly platform = 'example'
  readonly label = 'Example'
  readonly description = 'One line about what this captures'
  readonly color = '#000000'
  readonly ephemeral = false

  constructor(private readonly caps: ConnectorCapabilities) {}

  async checkAuth(): Promise<AuthStatus> {
    return { ok: true }
  }

  async fetchPage(ctx: FetchContext): Promise<PageResult> {
    const page = ctx.cursor ? parseInt(ctx.cursor, 10) : 1
    const res = await this.caps.fetch(
      `https://example.com/api/items?page=${page}`,
    )
    if (!res.ok) {
      throw new SyncError(SyncErrorCode.API_UNEXPECTED_STATUS, `status ${res.status}`)
    }
    const data = await res.json() as Array<{ id: string; title: string; url: string }>

    const items = data.map(d => ({
      url: d.url,
      title: d.title,
      contentText: d.title,
      author: null,
      platform: 'example',
      platformId: d.id,
      contentType: 'post',
      thumbnailUrl: null,
      metadata: {},
      capturedAt: new Date().toISOString(),
      rawJson: JSON.stringify(d),
    }))

    // Stop forward sync when we reach a known item
    if (ctx.phase === 'forward' && ctx.sinceItemId) {
      const idx = items.findIndex(i => i.platformId === ctx.sinceItemId)
      if (idx >= 0) return { items: items.slice(0, idx), nextCursor: null }
    }

    return { items, nextCursor: items.length === 0 ? null : String(page + 1) }
  }
}

export const connectors = [ExampleConnector]
```

**`tsconfig.json`** — emit ESM + d.ts:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "strict": true
  },
  "include": ["src"]
}
```

`pnpm build && pnpm publish --access public`. Users install it with:

```
spool://connector/install/@you/connector-example
```

The app downloads the tarball, extracts it into `~/.spool/connectors/node_modules/`, and — because you're not `@spool-lab/*` — prompts the user to trust the package first.

## Core contract

### `Connector`

The interface every connector implements. Fields (`id`, `platform`, `label`, `description`, `color`, `ephemeral`) are copied from the manifest and used by the UI. Two methods do real work:

- **`checkAuth()`** returns `{ ok: true }` when you can reach the source, or `{ ok: false, error, message, hint }` when you can't. Also returns a `setup: SetupStep[]` array if the connector uses the prerequisites system (see below).
- **`fetchPage(ctx)`** returns one page of items and a cursor for the next. The sync engine calls this in two phases: `forward` (pull new items newer than the last head anchor) and `backfill` (walk history). Honor `ctx.sinceItemId` in the forward phase to stop early.

### `CapturedItem`

The canonical data unit:

```ts
interface CapturedItem {
  url: string
  title: string
  contentText: string
  author: string | null
  platform: string
  platformId: string | null   // dedup key, stable per-platform
  contentType: string         // 'post' | 'video' | 'repo' | ...
  thumbnailUrl: string | null
  metadata: Record<string, unknown>
  capturedAt: string          // ISO 8601
  rawJson: string | null      // source response for future re-parsing
}
```

### Capabilities

You don't call `fetch`, read cookies, run subprocesses, or touch the filesystem directly. Instead you declare what you need in the manifest and Spool injects implementations via `ConnectorCapabilities`:

| Capability | Use for |
|---|---|
| `fetch` | Proxy-aware HTTP. Respects the user's system proxy, Electron's net module. |
| `cookies:chrome` | RFC 6265 cookie lookup from Chrome's profile — enables "use my logged-in session" connectors. |
| `exec` | Run an external CLI (`yt-dlp`, `gh`, `opencli`). Returns `{ exitCode, stdout, stderr }`. |
| `sqlite` | Read-only access to a local SQLite database — for connectors that wrap a native app's store. |
| `log` | Structured logging with per-connector prefix. |
| `prerequisites` | Enable the Setup card (see below). |

Declaring `capabilities: ["fetch", "log"]` in the manifest gates what's available at runtime; requesting a capability you didn't declare terminates the connector. This is the security boundary.

### Prerequisites (optional)

If your connector needs a CLI, a browser extension, or a logged-in session before it can work, declare it in the manifest:

```json
"prerequisites": [
  {
    "id": "yt-dlp",
    "name": "yt-dlp",
    "kind": "cli",
    "detect": {
      "type": "exec",
      "command": "yt-dlp",
      "args": ["--version"],
      "versionRegex": "(\\d{4}\\.\\d{2}\\.\\d{2})"
    },
    "minVersion": "2024.01.01",
    "install": {
      "kind": "cli",
      "command": {
        "darwin": "brew install yt-dlp",
        "linux": "pip install -U yt-dlp",
        "win32": "pip install -U yt-dlp"
      }
    },
    "docsUrl": "https://github.com/yt-dlp/yt-dlp"
  }
]
```

Spool's Setup card renders each step with a status pill + one-click install button. Your `checkAuth()` can delegate:

```ts
import { checkAuthViaPrerequisites } from '@spool-lab/connector-sdk'

async checkAuth() {
  return checkAuthViaPrerequisites(this.caps)
}
```

## Helpers

- `SyncError(code, message)` — throw from `fetchPage` with one of the `SyncErrorCode` values to get proper retry/backoff behavior.
- `parseCliJsonOutput(stdout, platform, contentType)` — converts `yt-dlp`-style one-JSON-per-line output into `CapturedItem[]`.
- `abortableSleep(ms, signal)` — honor `ctx.signal` in retry/backoff loops so cancellation responds quickly.

## Multi-connector packages

One package can ship several connectors that share prerequisites (e.g. GitHub Stars + Notifications share `gh auth`). Declare `spool.connectors` as an array with multiple entries and export `connectors: [A, B]` from your entry.

## Reference

- Architecture + authoring guide: [`docs/connector-sync-architecture.md`](https://github.com/spool-lab/spool/blob/main/docs/connector-sync-architecture.md)
- First-party examples: [`packages/connectors/*`](https://github.com/spool-lab/spool/tree/main/packages/connectors) — Reddit, GitHub, Hacker News, Twitter Bookmarks, Typeless, Xiaohongshu
- Community example: [`@graydawnc/connector-youtube`](https://www.npmjs.com/package/@graydawnc/connector-youtube)

## Versioning

`0.x` while the contract is stabilizing — minor bumps may include breaking changes, patch bumps are safe.

## License

MIT
