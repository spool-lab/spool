# Connector Architecture

> Plugin-based data sync framework for Spool. A connector is an installable npm package that knows how to read items from one source — a remote API, a local database, a set of files — and hand them to Spool's sync engine as `CapturedItem`s.

---

## Core Concepts

### What is a Connector?

A connector is a self-contained module that knows how to check whether its data source is available and fetch paginated items from it. It does NOT know about scheduling, sync state, or storage — those are handled by the framework.

Examples:
- Remote APIs: `@spool-lab/connector-twitter-bookmarks`, `@spool-lab/connector-github-stars`
- Local databases: a connector that reads a macOS app's SQLite store
- Local files: a connector that indexes a directory of notes

A connector only has to implement two methods (`checkAuth` and `fetchPage`). Whether the data comes from HTTP, SQLite, or the filesystem is entirely the connector's concern — the framework treats them uniformly.

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

Connectors are distributed as npm packages and installed to a local directory. The app discovers and loads them at startup. Packages can be authored by anyone — the Spool team ships first-party connectors under the `@spool-lab/*` npm scope, and community authors can publish under any name they choose.

### Package Convention

A connector package is identified by a `spool` manifest field in its `package.json`, **not** by its npm name. Any npm package can declare itself a connector by adding this field:

```json
{
  "name": "@spool-lab/connector-twitter-bookmarks",
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

- `spool.type` must be `"connector"` (reserved for future non-connector Spool plugin types)
- `id` / `platform` / `label` / `description` / `color` / `ephemeral` must match the corresponding fields on the `Connector` interface implementation exported from the package
- `@spool-lab/` is the scope reserved for first-party packages; any other scope (or unscoped name) is a community package

The manifest lets the app read connector metadata (for the directory page, install UI, etc.) without loading the module — and lets the app decide whether to trust the package before running any of its code.

### Trust model

Because connector code runs with file-system and network access, the app distinguishes two trust tiers:

| Tier | Rule | Default behavior |
|---|---|---|
| **First-party** | npm scope is `@spool-lab/*` and the package is also listed in Spool's bundled official-connector allow-list | Loaded automatically on startup |
| **Community** | Any other package that has `spool.type === 'connector'` | Requires explicit user approval at first load, then cached in `~/.spool/config.json` |

On first load of a community connector, Spool shows a consent dialog listing the capabilities the package has declared (see "Capability model" below) and the npm name + version. The user's answer is persisted — subsequent launches load it without re-prompting. The user can revoke trust at any time from Settings, which removes the consent record and disables the connector.

This model keeps `@spool-lab/*` fast-path while still allowing a real community ecosystem. It is **not** a sandbox — a connector the user has trusted can still read files and make network requests. The consent gate is a warning, not a prison.

> **Spec status:** the trust model is specified at the level of the consent flow and allow-list. Capability enforcement is specified below but not yet implemented. Worker-thread isolation is an optional hardening step reserved for a later phase.

### Capability model

> **Spec status: placeholder.** The detailed capability API is under design and will ship with the plugin loader. This section describes the intended shape so third-party authors can plan accordingly.

A connector does not `import 'node:fs'` or `import 'node:http'` directly. Instead, the SDK exposes a constrained set of capabilities that the framework injects into the connector at construction time:

- `fetch(url, init)` — HTTP fetch routed through Spool's network layer (proxy-aware, respects offline/online state). Equivalent to `globalThis.fetch` in shape
- `storage` — scoped key-value storage keyed by the connector's `id`, for things like cached API tokens or cursor checkpoints the connector wants to own (the framework already manages the per-sync `SyncState`)
- `cookies` — scoped Chrome/browser cookie reader for connectors that need cookie-based auth (subject to user consent for the specific browser profile)
- `log` — structured logger that attributes log lines to the connector

Any capability a connector uses must be declared in the `spool.capabilities` array in `package.json`:

```json
{
  "spool": {
    "type": "connector",
    "capabilities": ["fetch", "cookies:chrome"]
  }
}
```

The consent dialog shown to users on first load lists these capabilities in plain language ("This connector will make network requests and read your Chrome cookies"). A connector that tries to use an undeclared capability at runtime is terminated with a `CONNECTOR_ERROR` and surfaced to the user.

The exact capability set (names, signatures, consent strings) is frozen as part of the SDK v1 release. Until then this section is a design target, not a contract.

### Installation & Discovery

**Install location:** `~/.spool/connectors/`

```
~/.spool/connectors/
├── node_modules/
│   ├── @spool-lab/
│   │   └── connector-twitter-bookmarks/   # shipped with the app, first-run extracted
│   ├── some-community-scope/
│   │   └── my-custom-connector/
│   └── unscoped-connector-package/
└── package.json     # auto-managed, tracks installed connectors
```

**Install sources — all paths go through the same dynamic loader:**

| Source | How | Backend |
|---|---|---|
| **First-run bundle** | The app ships `@spool-lab/connector-*` npm tarballs inside its resource directory. On first launch, if `~/.spool/connectors/` is empty, the app extracts them into place. | File copy |
| **Deep link from spool.pro** | spool.pro's connector directory buttons open `spool://install/<package-name>`, which the app handles by running the install flow for that package | `npm install` |
| **Manual paste** | Settings → Install Connector → user pastes an npm package name | `npm install` |
| **Local development** | `spool connector install --from ./path/to/local/package` CLI flag for connector authors developing a new plugin | `npm install <path>` |

There is **no separate "built-in" code path**. Every connector the app loads — including first-party ones the Spool team maintains — goes through the same `~/.spool/connectors/` directory and the same dynamic loader. This is a deliberate choice: it means the first-party code is the first and most-tested consumer of the SDK, any capability a first-party connector needs is also available to community authors, and the plugin loading path is exercised from every launch of the app (not just once after the first community install).

**Install flow for user-initiated installs:**
1. User clicks "Install" on spool.pro directory, or pastes an npm package name into the app's Settings → Install Connector field
2. App resolves the source (deep link or direct input) and runs `npm install <package>` in `~/.spool/connectors/`
3. App scans every installed package for a `spool` manifest field
4. For community packages not yet trusted, the app prompts for consent (see "Trust model" above)
5. Each trusted package's default export is instantiated and registered with `ConnectorRegistry`

**Discovery at startup:**
```typescript
// Pseudocode — real loader lives in packages/core/src/connectors/loader.ts
async function loadConnectors(registry: ConnectorRegistry, trust: TrustStore) {
  const connectorsDir = path.join(homedir(), '.spool', 'connectors')

  // First-run bootstrap: extract bundled first-party connectors if the
  // user's connectors directory is empty.
  await extractBundledConnectorsIfNeeded(connectorsDir)

  if (!existsSync(path.join(connectorsDir, 'package.json'))) return

  // Walk every installed package — not just those with a known name prefix.
  for (const pkgDir of walkNodeModules(path.join(connectorsDir, 'node_modules'))) {
    const pkgJson = readPackageJson(pkgDir)
    if (pkgJson?.spool?.type !== 'connector') continue

    if (!trust.isAllowed(pkgJson.name)) {
      // Community package not yet approved — surface in UI, skip loading.
      trust.recordPending(pkgJson)
      continue
    }

    try {
      const mod = await import(pkgDir)
      const ConnectorClass = mod.default ?? mod
      const connector = new ConnectorClass(/* capabilities injected here */)
      registry.register(connector)
    } catch (err) {
      // Crash isolation: a broken connector must not take down the loader.
      log.error(`failed to load ${pkgJson.name}: ${err}`)
    }
  }
}
```

The loader treats every package as untrusted by default and only loads those in the trust store. First-party packages shipped with the app are added to the trust store automatically as part of the bundle-extraction step. Load failures are isolated so one bad connector cannot prevent the others from registering.

**Uninstall:** `npm uninstall <package>` in `~/.spool/connectors/`, then remove connector's sync state and captures from DB. The next launch will re-extract first-party bundles if the user has removed them, unless they explicitly set a "do not restore" flag.

### Deep-link install flow

spool.pro's connector directory page has an "Install in Spool" button next to each listed package. Clicking it opens a `spool://install/<package-name>` URL. The Spool app registers itself as the handler for the `spool://` protocol on install.

```
https://spool.pro/connectors
      │
      │ user clicks "Install" on @spool-lab/connector-github-stars
      ▼
spool://install/@spool-lab/connector-github-stars
      │
      │ OS hands off to Spool (custom protocol handler)
      ▼
App receives the deep link, shows a confirmation dialog:
  "Install @spool-lab/connector-github-stars from npm?"
      │
      │ user confirms
      ▼
App runs `npm install @spool-lab/connector-github-stars` in ~/.spool/connectors/
      │
      ▼
Loader picks it up, consent prompt if community, registers with ConnectorRegistry
```

Deep-link handling uses Electron's `app.setAsDefaultProtocolClient('spool')` in main, the `open-url` event on macOS, and command-line argument parsing on Windows/Linux. The `spool://` scheme is reserved for Spool's own use — any query parameters or additional paths are treated as opaque and validated server-side against the expected shape (`install/<package>`, `open/<resource>`, etc.).

**Security note:** deep-link triggers do **not** auto-install. Every install, regardless of source, shows the user a confirmation dialog with the package name and (for community packages) the declared capabilities. A malicious link cannot silently push code onto a user's machine.

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
│      (curated listing of first-party + community)        │
└───────────────────────┬──────────────────────────────────┘
                        │ npm install <any package>
                        ▼
┌──────────────────────────────────────────────────────────┐
│              ~/.spool/connectors/                         │
│    node_modules/**/package.json with `spool.type`         │
└───────────────────────┬──────────────────────────────────┘
                        │ trust check → dynamic import()
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
packages/core/src/connectors/    # Framework — NOT any individual connector
├── types.ts                     # Connector, AuthStatus, PageResult, SyncState, errors
├── registry.ts                  # ConnectorRegistry
├── sync-engine.ts               # SyncEngine (dual-frontier logic)
├── sync-scheduler.ts            # SyncScheduler (timing, orchestration)
└── loader.ts                    # Plugin discovery & dynamic loading

packages/connector-twitter-bookmarks/   # First-party connector, workspace package
├── package.json                # with `spool.type: 'connector'` manifest
├── src/
│   ├── index.ts                # TwitterBookmarksConnector (default export)
│   ├── chrome-cookies.ts       # uses injected cookies capability
│   └── graphql-fetch.ts        # uses injected fetch capability
└── dist/                       # built output, packaged as npm tarball and
                                # shipped inside the app's resource directory
                                # for first-run extraction

~/.spool/connectors/            # User-visible connector install directory
├── package.json
└── node_modules/
    ├── @spool-lab/connector-*/ # First-party (bundled with app, auto-trusted)
    └── <any-other-name>/       # Community (trusted after user consent)
```

The framework code lives in `packages/core/src/connectors/`. **No connector implementation lives there** — even the first-party Twitter Bookmarks connector has its own workspace package (`packages/connector-twitter-bookmarks/`), is built into an npm tarball, and is loaded through the same dynamic-import path as community connectors. This keeps the SDK honest: if the framework ever needs a feature to support Twitter, that feature has to be exposed on the SDK surface, not hidden in the core package.

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

Package it as `@your-scope/connector-my-platform-bookmarks` (or any npm name) with the `spool` manifest in `package.json`, publish to npm, and users can install it from the app's Settings → Install Connector field or from the spool.pro directory.

### Local source connectors

Not every connector fetches data over the network. A connector that reads a local SQLite database, a directory of markdown files, or another app's export file implements exactly the same `Connector` interface — the framework does not distinguish "remote" from "local" sources.

The technique for making a local source look like a paginated stream is to **synthesize a cursor from a natural ordering** in the data. For a table with a `created_at` column:

```typescript
async fetchPage({ cursor }: FetchContext): Promise<PageResult> {
  // cursor is the created_at of the last row on the previous page, or null
  // for the first page. Query for 25 rows strictly older than it.
  const db = openMyLocalDb()
  try {
    const rows = queryRows(db, { before: cursor, limit: 25 })
    const items = rows.map(rowToCapturedItem)
    const nextCursor = rows.length === 25
      ? rows[rows.length - 1].created_at
      : null
    return { items, nextCursor }
  } finally {
    db.close()
  }
}
```

`checkAuth()` for a local source is typically "is the file readable?":

```typescript
async checkAuth(): Promise<AuthStatus> {
  try {
    const db = openMyLocalDb()
    db.close()
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: SyncErrorCode.CONNECTOR_ERROR,
      message: err instanceof Error ? err.message : String(err),
      hint: 'MyApp not found. Install MyApp, create at least one entry, then retry.',
    }
  }
}
```

Notes for local connectors:

- The dual-frontier model (forward + backfill) still applies: forward finds items added since the last sync, backfill walks history. With a stable local ordering, "forward" converges after the first cycle and subsequent syncs just pick up deltas.
- Page delay (`pageDelayMs`) defaults are tuned for remote API rate limits. A local connector can pass `pageDelayMs: 0` via its constructor config if the default 1200ms is wasteful.
- Error codes like `API_RATE_LIMITED` or `NETWORK_OFFLINE` don't apply. Use `CONNECTOR_ERROR` with a descriptive `hint` for local-specific failures (file missing, database locked, parse failure).
- `checkAuth()`'s name is legacy — semantically it means "is the source usable right now?" The framework treats any non-`ok` answer the same way.

### Future consideration: source-type taxonomy

The current `Connector` interface is shaped around "paginated pull-based reads from a temporally-ordered source." That model covers:

- Remote cursor-walking APIs (Twitter, GraphQL)
- Remote `since`-parameterized APIs (GitHub, REST)
- Local databases with a natural `ORDER BY created_at DESC` ordering
- Local file directories where mtime serves as the ordering

It does **not** naturally fit:

- Push-based ingestion (filesystem watchers, IPC events from another process)
- Non-temporal data (configs, static reference material)
- Sources where the entire state must be re-read each time because no cursor exists (small local files, key-value stores)

Spool currently handles push-based local-file ingestion (Claude Code sessions, Codex history) in a separate subsystem (`packages/core/src/sync/` — the `SpoolWatcher` + `Syncer`), not through the `Connector` framework. This split is intentional: forcing every integration into the paginated model would have produced awkward adapters for sources that don't have a natural pagination story.

If in the future enough local or push-based connectors exist to warrant a unified abstraction, the framework may introduce a **source-type taxonomy** — something like `connector.kind: 'paginated' | 'snapshot' | 'watcher'` — with distinct interface shapes for each kind. This is deliberately **not** done yet because:

1. The current interface has only two local samples (Typeless is a candidate community connector; Claude Code / Codex live outside the framework in `sync/`). Two samples are not enough to generalize a taxonomy correctly.
2. A premature kind-based split would likely need to be revised once more local samples exist, which would be a breaking public-API change at exactly the wrong time (after community authors have started shipping against v1).
3. The current interface **already works** for local sources via cursor synthesis — the awkwardness is in naming (`checkAuth` for a file-existence check) and default values (`pageDelayMs` for zero-latency reads), neither of which is a blocker.

The shape of the eventual taxonomy will be decided when there is enough evidence to design it, not before. Until then, local-source authors should use the patterns shown above and accept the HTTP-shaped vocabulary of the current interface.

---

## Removed Systems

The following legacy systems have been fully removed in favor of the connector framework:

- **OpenCLI integration** (`packages/core/src/opencli/`): Manager, parser, strategies, onboarding flow. OpenCLI was an external CLI tool that wrapped browser automation for 50+ platforms. Each platform that needs support is now implemented as a standalone connector.
- **Capture URL** (`CaptureUrlModal.tsx`, Cmd+K): One-off URL fetching via `opencli web read`. Not part of the connector model.
- **`opencli_sources` table**: Replaced by `connector_sync_state`.
- **`opencli_setup` table**: No longer needed (no global CLI installation step).
- **`opencli:*` IPC channels**: Replaced by `connector:*`.
- **OnboardingFlow**: Each connector handles its own auth; no shared setup wizard.
