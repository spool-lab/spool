# Connector Architecture

> Plugin-based data sync framework for Spool. Each connector is an installable npm package that fetches data from one platform.

---

## Core Concepts

### What is a Connector?

A connector is a self-contained module that knows how to authenticate with and fetch paginated data from one specific platform source. It does NOT know about scheduling, sync state, or storage — those are handled by the framework.

Examples: `spool-lab-connector-twitter-bookmarks`, `spool-lab-connector-github-stars`, `spool-lab-connector-reddit-saved`.

### Data Ownership Model

| Kind | Sync Strategy | Examples |
|------|---------------|----------|
| **User-owned** | Persistent dual-frontier sync (`ephemeral: false`) | Bookmarks, stars, saved posts, favorites, watch history |
| **Ephemeral** | Full-replace cache (`ephemeral: true`) | Hot topics, trending, rankings, explore feeds |

User-owned data uses incremental sync with two cursors (head + tail). Ephemeral data is deleted and re-fetched each cycle.

---

## Connector Interface

```typescript
interface Connector {
  /** Unique identifier, e.g. 'twitter-bookmarks' */
  readonly id: string

  /** Platform name for grouping, e.g. 'twitter' */
  readonly platform: string

  /** Human-readable label, e.g. 'X Bookmarks' */
  readonly label: string

  /** Short description for the connector picker */
  readonly description: string

  /** UI color for badges/dots */
  readonly color: string

  /** Whether this is ephemeral (cache) or user-owned (persistent) */
  readonly ephemeral: boolean

  /** Check if authentication is available */
  checkAuth(opts?: Record<string, string>): Promise<AuthStatus>

  /**
   * Fetch one page of data.
   * The sync engine calls this repeatedly with FetchContext to paginate.
   * The connector can use sinceItemId and phase to optimize fetching,
   * or ignore them and just use the cursor (cursor-walking).
   */
  fetchPage(ctx: FetchContext): Promise<PageResult>
}

interface FetchContext {
  cursor: string | null         // Pagination cursor. null = start from newest.
  sinceItemId: string | null    // Platform ID of newest known item (head anchor).
                                // Forward passes this so the connector can
                                // optimize (e.g. stop early). null during backfill
                                // or when no anchor exists yet.
  phase: 'forward' | 'backfill' // Which sync phase is requesting this page.
}
```

A connector only needs to implement two methods: `checkAuth()` and `fetchPage()`. Everything else — persistence, scheduling, retries, UI — is handled by the framework. The `sinceItemId` and `phase` fields in `FetchContext` are informational — a connector can safely ignore them and just use `cursor`. The engine has its own early-exit logic that works regardless of whether the connector acts on these hints.

### Key Supporting Types

```typescript
interface AuthStatus {
  ok: boolean
  error?: string
  code?: SyncErrorCode       // machine-readable error classification
  hint?: string              // user-facing guidance, e.g. "Log into X in Chrome"
}

interface PageResult {
  items: CapturedItem[]
  nextCursor: string | null  // null = no more data in this direction
}
```

### CapturedItem — the Universal Data Unit

Every piece of data flowing through the connector system is a `CapturedItem`. This is the canonical shape for all platform data stored in Spool.

```typescript
interface CapturedItem {
  /** Original URL on the platform */
  url: string

  /** Display title (truncated for tweets, repo name for GitHub, etc.) */
  title: string

  /** Full text content */
  contentText: string

  /** Author handle or name */
  author: string | null

  /** Platform identifier: 'twitter', 'github', 'reddit', etc. */
  platform: string

  /** Platform-specific unique ID for deduplication */
  platformId: string | null

  /** Content type: 'tweet', 'repo', 'video', 'post', 'page', etc. */
  contentType: string

  /** Preview image URL */
  thumbnailUrl: string | null

  /** Platform-specific structured data (JSON blob) */
  metadata: Record<string, unknown>

  /** When the item was created/saved on the platform (ISO 8601) */
  capturedAt: string

  /** Raw API response for future re-parsing */
  rawJson: string | null
}
```

**Key fields explained:**

| Field | Purpose | Example |
|-------|---------|---------|
| `platform` + `platformId` | **Deduplication key**. The sync engine upserts by this pair. | `twitter` + `1234567890` |
| `contentType` | Determines rendering in search results. | `tweet`, `repo`, `video` |
| `metadata` | Extensible bag for platform-specific data not covered by the base schema. Connectors store engagement counts, media objects, author snapshots, etc. | `{ likeCount: 42, media: [...] }` |
| `metadata.connectorId` | **Framework-set** (not connector-set). The sync engine tags every item with the connector ID that produced it, enabling per-connector filtering and cleanup. | `twitter-bookmarks` |
| `capturedAt` | Used for timeline ordering. Should be the platform's timestamp (when the tweet was posted, when the repo was starred), not the sync time. | `2025-03-15T10:30:00Z` |
| `rawJson` | Preserved so that schema changes don't require re-fetching. The parser can be re-run on stored raw data. | Full GraphQL response |

### Error Classification

Connectors throw `SyncError` with a typed `code` for the framework to make retry/backoff decisions:

```typescript
enum SyncErrorCode {
  // Auth errors — connector should surface these clearly
  AUTH_CHROME_NOT_FOUND      // Chrome/cookies DB not found
  AUTH_NOT_LOGGED_IN         // Required cookies missing
  AUTH_COOKIE_DECRYPT_FAILED // OS keychain decryption failed
  AUTH_KEYCHAIN_DENIED       // User denied keychain access prompt
  AUTH_SESSION_EXPIRED       // 401/403 from platform API

  // Network errors — framework handles retry
  RATE_LIMITED               // 429
  SERVER_ERROR               // 5xx
  NETWORK_OFFLINE            // fetch failed, no connectivity
  NETWORK_TIMEOUT            // request timed out
  PARSE_ERROR                // response wasn't valid JSON/expected shape
  UNEXPECTED_STATUS          // unexpected HTTP status

  // Engine errors — framework internal
  MAX_PAGES_REACHED          // hit page budget
  SYNC_TIMEOUT               // hit time budget
  SYNC_CANCELLED             // AbortSignal fired

  // Storage errors
  DB_WRITE_ERROR             // SQLite write failed

  // Catch-all
  CONNECTOR_ERROR            // connector-specific unclassified error
}
```

Errors with `needsReauth: true` (all `AUTH_*` codes) cause the scheduler to stop retrying until the user re-authenticates. Errors with `retryable: true` (network/server errors) trigger exponential backoff.

---

## Sync Engine: Dual-Frontier Model

The sync engine is platform-agnostic. It takes any `Connector` and manages the full sync lifecycle.

### Concept

```
[history end] ◄── tail frontier ──── stored data ──── head frontier ──► [newest]
                   (backfill ←)                        (→ forward)
```

Two independent frontiers:

- **Head (forward):** Fetches new items added since last sync. Runs frequently (every 15 min). Stops when it encounters already-known items or runs out of pages.
- **Tail (backfill):** Fills in historical data. Runs less frequently (every 60 min). Stops when it reaches the end of available history or exhausts its page budget.

### Sync State (per connector, stored in DB)

```typescript
interface SyncState {
  connectorId: string

  // Head frontier
  headCursor: string | null      // Forward resume cursor. Non-null only when
                                 // forward was interrupted (timeout/cancel/error).
                                 // Cleared on normal completion.
  headItemId: string | null      // Platform ID of newest known item (since anchor).
                                 // Set from page 0 of a fresh forward (not a resumed one).
                                 // Used as FetchContext.sinceItemId and as the engine's
                                 // early-exit target. Cleared automatically if forward
                                 // completes without hitting it (anchor invalidation).

  // Tail frontier
  tailCursor: string | null      // cursor to resume backfill
  tailComplete: boolean          // true = reached end of history

  // Metadata
  lastForwardSyncAt: string | null
  lastBackfillSyncAt: string | null
  totalSynced: number
  consecutiveErrors: number
  enabled: boolean
  configJson: string             // per-connector config (e.g. chrome profile)
  lastErrorCode: string | null
  lastErrorMessage: string | null
}
```

### Stop Conditions

Forward sync stops when ANY of:
1. **Reached since-anchor**: A page contains the item matching `sinceItemId` (caught up precisely)
2. **Stale pages**: 3 consecutive pages with 0 new items (fallback when no anchor exists)
3. **No cursor**: API returned `nextCursor: null` (end of data)
4. **Timeout**: Exceeded `maxMinutes` (forward interrupted, `headCursor` preserved for resume)
5. **Cancelled**: `AbortSignal` fired (`headCursor` preserved)

Conditions 1–3 are "normal completion" — `headCursor` is cleared. Conditions 4–5 are "interruption" — `headCursor` retains the current position so the next forward resumes where it stopped instead of re-fetching from the newest end.

### Ephemeral vs. Persistent

```typescript
class SyncEngine {
  async sync(connector: Connector, opts?: SyncOptions): Promise<SyncResult> {
    if (connector.ephemeral) {
      // Delete all existing items for this connector, fetch fresh
      return this.syncEphemeral(connector, opts)
    }
    // Dual-frontier: forward then backfill
    return this.syncPersistent(connector, opts)
  }
}
```

### Checkpoint & Crash Safety

The engine checkpoints state to DB every 25 pages. If the app crashes mid-sync:
- Forward sync: resumes from last saved `headCursor`. Pages between the crash and the last checkpoint may be re-fetched, but dedup by `(platform, platformId)` prevents duplicates.
- Backfill: resumes from last saved `tailCursor`.
- No data loss, at most some redundant API calls.

---

## Sync Scheduler

The scheduler is the orchestration layer that decides WHEN to run syncs. It runs in the Electron main process.

### Design Principles

1. **Connectors don't know about scheduling.** A connector is a pure data fetcher.
2. **Sync engine doesn't know about timing.** It runs one sync cycle when asked.
3. **Scheduler owns the clock.** It decides what to sync, when, and in what order.

### Schedule Configuration

```typescript
interface ScheduleConfig {
  forwardIntervalMs: number     // Default: 15 min
  backfillIntervalMs: number    // Default: 60 min
  concurrency: number           // Default: 1
  pageDelayMs: number           // Default: 1200ms
  retryBackoffMs: number[]      // Default: [60s, 300s, 1800s, 7200s]
  maxMinutesPerRun: number      // Default: 10 (scheduler); 0 = unlimited (CLI)
}
```

### Priority Queue

| Priority | Trigger | Description |
|----------|---------|-------------|
| 100 | Manual | User clicked "Sync now" |
| 80 | Launch | First sync after app launch |
| 60 | Wake | Sync after system wake from sleep |
| 40 | Interval | Scheduled forward sync |
| 20 | Backfill | Background history backfill |

### Error Handling & Backoff

```
consecutiveErrors = 0  →  next sync at normal interval
consecutiveErrors = 1  →  wait 60s
consecutiveErrors = 2  →  wait 5 min
consecutiveErrors = 3  →  wait 30 min
consecutiveErrors ≥ 4  →  wait 2 hr (cap)
```

Auth errors (`needsReauth`) stop scheduling entirely until the user re-authenticates.

### Lifecycle Events

| Event | Action |
|-------|--------|
| App launch | Queue forward sync for all enabled connectors (priority 80) |
| System wake | Queue forward sync for all enabled connectors (priority 60) |
| Interval tick | Check which connectors are due, queue at priority 40/20 |
| Manual trigger | Queue specific connector at priority 100 |
| Auth error | Mark `needsReauth`, stop scheduling this connector |
| App quit | Abort running syncs, save state |

### Event System

The scheduler emits events for UI updates:

```typescript
type SchedulerEvent =
  | { type: 'sync-start'; connectorId: string }
  | { type: 'sync-progress'; progress: SyncProgress }
  | { type: 'sync-complete'; result: ConnectorSyncResult }
  | { type: 'sync-error'; connectorId: string; code: SyncErrorCode; message: string }
```

---

## Connector Plugin System

Connectors are distributed as npm packages and installed to a local directory. The app discovers and loads them at startup.

### Package Convention

Each connector is an npm package named `spool-lab-connector-<name>`:

```
spool-lab-connector-twitter-bookmarks/
├── package.json
├── index.js          # default export: Connector class or factory
└── ...
```

The `package.json` declares connector metadata via a `spool` field:

```json
{
  "name": "spool-lab-connector-twitter-bookmarks",
  "version": "1.0.0",
  "main": "dist/index.js",
  "spool": {
    "type": "connector",
    "id": "twitter-bookmarks",
    "platform": "twitter",
    "label": "X Bookmarks",
    "description": "Your saved tweets on X",
    "color": "#1DA1F2",
    "ephemeral": false
  }
}
```

The `spool` manifest enables the app to read connector metadata (for the connector directory page, install UI, etc.) without loading the module. The actual `Connector` interface implementation is loaded only after installation.

### Installation & Discovery

**Install location:** `~/.spool/connectors/`

```
~/.spool/connectors/
├── node_modules/
│   ├── spool-lab-connector-twitter-bookmarks/
│   ├── spool-lab-connector-github-stars/
│   └── ...
└── package.json     # auto-managed, tracks installed connectors
```

**Install flow:**
1. User browses connector directory on spool.pro (or triggers install from app UI)
2. App runs `npm install spool-lab-connector-xxx` in `~/.spool/connectors/`
3. App scans `node_modules/spool-lab-connector-*` and loads each package
4. Each package's default export is instantiated and registered with `ConnectorRegistry`

**Discovery at startup:**
```typescript
// Pseudocode for connector loading
async function loadConnectors(registry: ConnectorRegistry) {
  const connectorsDir = path.join(homedir(), '.spool', 'connectors')
  const pkgJsonPath = path.join(connectorsDir, 'package.json')

  if (!existsSync(pkgJsonPath)) return

  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
  const deps = Object.keys(pkgJson.dependencies ?? {})

  for (const dep of deps) {
    if (!dep.startsWith('spool-lab-connector-')) continue
    const mod = require(path.join(connectorsDir, 'node_modules', dep))
    const ConnectorClass = mod.default ?? mod
    const connector = new ConnectorClass()
    registry.register(connector)
  }
}
```

**Uninstall:** `npm uninstall spool-lab-connector-xxx` in `~/.spool/connectors/`, then remove connector's sync state and captures from DB.

### Built-in vs. External Connectors

During the transition period, high-priority connectors (e.g. Twitter Bookmarks) may ship bundled in `@spool/core`. These are registered directly in the app startup code alongside dynamically loaded external connectors. Over time, even bundled connectors should migrate to the plugin package format.

```typescript
// App startup
const registry = new ConnectorRegistry()

// Built-in (temporary, will migrate to plugin)
registry.register(new TwitterBookmarksConnector())

// External plugins
await loadConnectors(registry)

const scheduler = new SyncScheduler(db, registry)
scheduler.start()
```

---

## DB Schema

### `connector_sync_state` — per-connector sync progress

```sql
CREATE TABLE IF NOT EXISTS connector_sync_state (
  connector_id          TEXT PRIMARY KEY,
  head_cursor           TEXT,
  head_item_id          TEXT,
  tail_cursor           TEXT,
  tail_complete         INTEGER NOT NULL DEFAULT 0,
  last_forward_sync_at  TEXT,
  last_backfill_sync_at TEXT,
  total_synced          INTEGER NOT NULL DEFAULT 0,
  consecutive_errors    INTEGER NOT NULL DEFAULT 0,
  enabled               INTEGER NOT NULL DEFAULT 1,
  config_json           TEXT NOT NULL DEFAULT '{}',
  last_error_code       TEXT,
  last_error_message    TEXT
);
```

### `captures` — all connector items

```sql
CREATE TABLE IF NOT EXISTS captures (
  id              INTEGER PRIMARY KEY,
  source_id       INTEGER NOT NULL REFERENCES sources(id),
  capture_uuid    TEXT NOT NULL UNIQUE,
  url             TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  content_text    TEXT NOT NULL DEFAULT '',
  author          TEXT,
  platform        TEXT NOT NULL,
  platform_id     TEXT,
  content_type    TEXT NOT NULL DEFAULT 'page',
  thumbnail_url   TEXT,
  metadata        TEXT NOT NULL DEFAULT '{}',
  captured_at     TEXT NOT NULL,
  indexed_at      TEXT NOT NULL DEFAULT (datetime('now')),
  raw_json        TEXT
);

-- Deduplication: platform + platform_id
-- FTS: captures_fts virtual table on (title, content_text)
```

Note: The legacy `opencli_sources` and `opencli_setup` tables are removed. All connector state lives in `connector_sync_state`. The `captures.opencli_src_id` column is dropped — connector association is via `json_extract(metadata, '$.connectorId')`.

---

## Integration Points

### How a Connector Fits into the Framework

```
┌──────────────────────────────────────────────────────────┐
│                    spool.pro                              │
│              Connector Directory Page                     │
│         (lists all available connectors)                  │
└───────────────────────┬──────────────────────────────────┘
                        │ npm install
                        ▼
┌──────────────────────────────────────────────────────────┐
│              ~/.spool/connectors/                         │
│    node_modules/spool-lab-connector-*/                    │
└───────────────────────┬──────────────────────────────────┘
                        │ require() at startup
                        ▼
┌──────────────────────────────────────────────────────────┐
│              ConnectorRegistry                            │
│    register() / list() / get() / has()                    │
└───────────────────────┬──────────────────────────────────┘
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
┌─────────────────────┐ ┌──────────────────────┐
│     SyncEngine      │ │    SyncScheduler      │
│  (runs sync cycles) │ │  (decides WHEN)       │
│  dual-frontier      │ │  priority queue       │
│  upsert to DB       │ │  error backoff        │
└─────────┬───────────┘ └──────────┬───────────┘
          │                        │
          ▼                        ▼
┌──────────────────────────────────────────────────────────┐
│                   SQLite Database                         │
│    captures + captures_fts + connector_sync_state         │
└──────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────┐
│              Electron IPC / CLI                           │
│    connector:list / connector:sync-now / etc.             │
└───────────────────────┬──────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────┐
│                   Renderer UI                             │
│    SourcesPanel / SettingsPanel / StatusBar                │
└──────────────────────────────────────────────────────────┘
```

### Electron IPC

| Channel | Input | Output |
|---------|-------|--------|
| `connector:list` | — | `ConnectorStatus[]` |
| `connector:check-auth` | `{ id }` | `AuthStatus` |
| `connector:sync-now` | `{ id }` | `{ ok: boolean }` |
| `connector:get-status` | — | `SchedulerStatus` |
| `connector:set-enabled` | `{ id, enabled }` | `{ ok: boolean }` |
| `connector:get-capture-count` | `{ connectorId }` | `number` |
| `connector:install` | `{ packageName }` | `{ ok: boolean }` |
| `connector:uninstall` | `{ packageName }` | `{ ok: boolean }` |

Event channel: `connector:event` broadcasts `SchedulerEvent` to renderer.

### Preload API

```typescript
window.spool.connectors = {
  list(): Promise<ConnectorStatus[]>
  checkAuth(id: string): Promise<AuthStatus>
  syncNow(id: string): Promise<{ ok: boolean }>
  setEnabled(id: string, enabled: boolean): Promise<{ ok: boolean }>
  getStatus(): Promise<SchedulerStatus>
  getCaptureCount(connectorId: string): Promise<number>
  install(packageName: string): Promise<{ ok: boolean }>
  uninstall(packageName: string): Promise<{ ok: boolean }>
  onEvent(callback: (event: SchedulerEvent) => void): () => void
}
```

### CLI

```bash
spool connector list                              # list installed connectors + status
spool connector sync [connector-id]               # sync one or all connectors
spool connector sync --reset [connector-id]       # wipe state and re-sync from scratch
spool connector install <package-name>            # install a connector from npm
spool connector uninstall <package-name>          # remove a connector
```

---

## File Structure

```
packages/core/src/connectors/
├── types.ts                     # Connector, AuthStatus, PageResult, SyncState, errors
├── registry.ts                  # ConnectorRegistry
├── sync-engine.ts               # SyncEngine (dual-frontier logic)
├── sync-scheduler.ts            # SyncScheduler (timing, orchestration)
├── loader.ts                    # Plugin discovery & dynamic loading
└── twitter-bookmarks/           # Built-in reference connector (will migrate to plugin)
    ├── index.ts                 # TwitterBookmarksConnector
    ├── chrome-cookies.ts        # Chrome cookie extraction
    └── graphql-fetch.ts         # X GraphQL API client

~/.spool/connectors/             # User-installed connector plugins
├── package.json
└── node_modules/
    └── spool-lab-connector-*/
```

---

## Writing a Connector

A minimal connector implementation:

```typescript
import type { Connector, AuthStatus, PageResult, FetchContext } from '@spool/core'

export default class MyConnector implements Connector {
  readonly id = 'my-platform-bookmarks'
  readonly platform = 'my-platform'
  readonly label = 'My Platform Bookmarks'
  readonly description = 'Your saved items on My Platform'
  readonly color = '#FF6600'
  readonly ephemeral = false

  async checkAuth(): Promise<AuthStatus> {
    // Check if credentials/cookies are available
    return { ok: true }
  }

  async fetchPage({ cursor }: FetchContext): Promise<PageResult> {
    // Fetch one page of data from the platform API.
    // sinceItemId and phase are available in FetchContext if your platform
    // supports server-side "since" filtering — most connectors can ignore them
    // and just use cursor. The engine handles early-exit on its own.
    const response = await fetchFromAPI(cursor)
    return {
      items: response.items.map(item => ({
        url: item.url,
        title: item.title,
        contentText: item.body,
        author: item.author,
        platform: this.platform,
        platformId: item.id,
        contentType: 'post',
        thumbnailUrl: null,
        metadata: { /* platform-specific data */ },
        capturedAt: item.createdAt,
        rawJson: JSON.stringify(item),
      })),
      nextCursor: response.nextPage ?? null,
    }
  }
}
```

Package it as `spool-lab-connector-my-platform-bookmarks` with the `spool` manifest in `package.json`, publish to npm, and users can install it.

---

## Removed Systems

The following legacy systems have been fully removed in favor of the connector framework:

- **OpenCLI integration** (`packages/core/src/opencli/`): Manager, parser, strategies, onboarding flow. OpenCLI was an external CLI tool that wrapped browser automation for 50+ platforms. Each platform that needs support is now implemented as a standalone connector.
- **Capture URL** (`CaptureUrlModal.tsx`, Cmd+K): One-off URL fetching via `opencli web read`. Not part of the connector model.
- **`opencli_sources` table**: Replaced by `connector_sync_state`.
- **`opencli_setup` table**: No longer needed (no global CLI installation step).
- **`opencli:*` IPC channels**: Replaced by `connector:*`.
- **OnboardingFlow**: Each connector handles its own auth; no shared setup wizard.
