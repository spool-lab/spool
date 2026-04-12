# Stage D — SDK Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `@spool/connector-sdk` out of `@spool/core` and migrate `TwitterBookmarksConnector` + `TypelessConnector` into first-party plugins loaded through a dynamic loader, with first-run bundle extraction from the Electron resources directory.

**Architecture:** `@spool/connector-sdk` is a new workspace package exporting only the public plugin contract (types + `SyncError` + capability interfaces + `abortableSleep` utility). `@spool/core` re-exports SDK types for backwards compatibility but no longer contains any connector implementation code. Two first-party plugins live in `packages/connectors/*` as independent workspace packages that depend on the SDK via `peerDependencies`. A new loader in `@spool/core` scans `~/.spool/connectors/node_modules/`, auto-extracts bundled tarballs from `resources/bundled-connectors/` on first launch, and instantiates plugins with injected capabilities. Plugin boundary stays Promise-based; Effect types never cross the SDK.

**Tech Stack:** TypeScript, pnpm workspaces, Effect 3.21, Vitest, `tar` (new dep), `semver` (new dep), Electron, electron-builder, electron-vite.

**Design doc:** `~/Documents/dev-docs/spool/connector/stage-d-sdk-split-design.md` (2026-04-12)

---

## Phase 1 — SDK Foundation

### Task 1: Create `@spool/connector-sdk` package skeleton

**Files:**
- Create: `packages/connector-sdk/package.json`
- Create: `packages/connector-sdk/tsconfig.json`
- Create: `packages/connector-sdk/src/index.ts`
- Create: `packages/connector-sdk/README.md`

- [ ] **Step 1.1: Create package.json**

```json
{
  "name": "@spool/connector-sdk",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": [
    "dist",
    "README.md"
  ],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "@types/node": "^22.15.3",
    "typescript": "^5.7.3",
    "vitest": "^3.1.2"
  }
}
```

Note: **no runtime dependencies**. `@types/node` is a devDep (types only). The SDK's zero-deps guarantee is a hard constraint enforced at the end of Task 4.

- [ ] **Step 1.2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["es2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "src/**/*.test.ts"]
}
```

- [ ] **Step 1.3: Create empty barrel export**

`packages/connector-sdk/src/index.ts`:

```typescript
// @spool/connector-sdk — public plugin contract for Spool connectors.
// All exports are re-exported from focused modules below.
// This file is the only public entry point; import from '@spool/connector-sdk'.

// Exports are added by Task 2, Task 3, and Task 4.
export {}
```

- [ ] **Step 1.4: Create README placeholder**

`packages/connector-sdk/README.md`:

```markdown
# @spool/connector-sdk

Public plugin contract for Spool connectors. A Spool connector is an npm package whose `package.json` declares `spool.type: "connector"` and whose default export is a class implementing the `Connector` interface exported from this package.

See `docs/connector-sync-architecture.md` in the Spool repository for the full authoring guide.
```

- [ ] **Step 1.5: Install and verify**

Run:
```bash
cd /Users/chen/github/spool
pnpm install
pnpm --filter @spool/connector-sdk build
```

Expected: `packages/connector-sdk/dist/index.js` and `index.d.ts` exist. Empty package compiles without error.

- [ ] **Step 1.6: Commit**

```bash
git add packages/connector-sdk/ pnpm-lock.yaml
git commit -m "feat(connector-sdk): scaffold @spool/connector-sdk package

Empty package skeleton. Types, errors, capabilities, and utilities are
added in subsequent Stage D tasks. No runtime dependencies.

Part of Stage D (SDK split)."
```

---

### Task 2: Migrate core contract types from `@spool/core` to `@spool/connector-sdk`

**Files:**
- Create: `packages/connector-sdk/src/connector.ts`
- Create: `packages/connector-sdk/src/captured-item.ts`
- Create: `packages/connector-sdk/src/errors.ts`
- Create: `packages/connector-sdk/src/sync-state.ts`
- Modify: `packages/connector-sdk/src/index.ts`
- Modify: `packages/core/src/connectors/types.ts`
- Modify: `packages/core/package.json`

- [ ] **Step 2.1: Create `captured-item.ts`**

`packages/connector-sdk/src/captured-item.ts`:

```typescript
/**
 * Canonical data unit flowing through the connector system.
 * Every item a connector produces and every item stored in Spool's DB
 * starts as a CapturedItem.
 */
export interface CapturedItem {
  /** Original URL on the source platform. */
  url: string
  /** Display title (truncated for long content). */
  title: string
  /** Full text content of the item. */
  contentText: string
  /** Author handle or name. null if unknown. */
  author: string | null
  /** Platform identifier: 'twitter', 'github', 'reddit', etc. */
  platform: string
  /** Platform-specific unique ID used for dedup. null = no stable ID. */
  platformId: string | null
  /** Content type for rendering: 'tweet', 'repo', 'video', 'post', 'page'. */
  contentType: string
  /** Preview image URL. null if none. */
  thumbnailUrl: string | null
  /** Extensible bag for platform-specific structured data. */
  metadata: Record<string, unknown>
  /** When the item was created on the platform (ISO 8601). */
  capturedAt: string
  /** Raw API response for future re-parsing. null to skip storing raw. */
  rawJson: string | null
}
```

- [ ] **Step 2.2: Create `errors.ts`** — copy `SyncErrorCode` enum, `SYNC_ERROR_HINTS`, `SyncError` class from `packages/core/src/connectors/types.ts`:13–137 verbatim. The `Data.TaggedError` base class requires `effect` — but we do NOT want `effect` as a SDK dep. Replace `Data.TaggedError` with a plain class that preserves the public API.

`packages/connector-sdk/src/errors.ts`:

```typescript
/**
 * Enumerated sync error codes.
 *
 * Every error that can occur during sync maps to one of these codes so the UI
 * can display a specific, actionable message and track failure patterns.
 */
export enum SyncErrorCode {
  // ── Auth ────────────────────────────────────────────────────────────
  AUTH_CHROME_NOT_FOUND = 'AUTH_CHROME_NOT_FOUND',
  AUTH_NOT_LOGGED_IN = 'AUTH_NOT_LOGGED_IN',
  AUTH_COOKIE_DECRYPT_FAILED = 'AUTH_COOKIE_DECRYPT_FAILED',
  AUTH_KEYCHAIN_DENIED = 'AUTH_KEYCHAIN_DENIED',
  AUTH_SESSION_EXPIRED = 'AUTH_SESSION_EXPIRED',
  AUTH_UNKNOWN = 'AUTH_UNKNOWN',

  // ── Network / API ──────────────────────────────────────────────────
  API_RATE_LIMITED = 'API_RATE_LIMITED',
  API_SERVER_ERROR = 'API_SERVER_ERROR',
  NETWORK_OFFLINE = 'NETWORK_OFFLINE',
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  API_PARSE_ERROR = 'API_PARSE_ERROR',
  API_UNEXPECTED_STATUS = 'API_UNEXPECTED_STATUS',

  // ── Sync engine ────────────────────────────────────────────────────
  SYNC_MAX_PAGES = 'SYNC_MAX_PAGES',
  SYNC_TIMEOUT = 'SYNC_TIMEOUT',
  SYNC_CANCELLED = 'SYNC_CANCELLED',

  // ── Storage ────────────────────────────────────────────────────────
  DB_WRITE_ERROR = 'DB_WRITE_ERROR',

  // ── Connector ──────────────────────────────────────────────────────
  CONNECTOR_ERROR = 'CONNECTOR_ERROR',
}

/**
 * Human-readable hints for each error code.
 * Shown in the sync UI so the user knows what happened and how to fix it.
 */
export const SYNC_ERROR_HINTS: Record<SyncErrorCode, string> = {
  [SyncErrorCode.AUTH_CHROME_NOT_FOUND]:
    'Chrome is not installed, or the cookies database was not found. Install Google Chrome and open it at least once.',
  [SyncErrorCode.AUTH_NOT_LOGGED_IN]:
    'You are not logged into this platform in Chrome. Open Chrome, log in, then retry.',
  [SyncErrorCode.AUTH_COOKIE_DECRYPT_FAILED]:
    'Could not decrypt Chrome cookies. Try closing Chrome completely and retrying. If using a non-default profile, check your connector settings.',
  [SyncErrorCode.AUTH_KEYCHAIN_DENIED]:
    'Could not read the Chrome encryption key from macOS Keychain. You may need to grant access in System Settings > Privacy > Keychain.',
  [SyncErrorCode.AUTH_SESSION_EXPIRED]:
    'Your session expired during sync. Open Chrome, visit the platform to refresh your login, then retry.',
  [SyncErrorCode.AUTH_UNKNOWN]:
    'Authentication failed for an unknown reason. Check that you are logged in via Chrome and retry.',
  [SyncErrorCode.API_RATE_LIMITED]:
    'The platform rate-limited requests. Spool will retry automatically after a cooldown.',
  [SyncErrorCode.API_SERVER_ERROR]:
    'The platform returned a server error. This is usually temporary — Spool will retry later.',
  [SyncErrorCode.NETWORK_OFFLINE]:
    'No internet connection. Spool will sync when connectivity is restored.',
  [SyncErrorCode.NETWORK_TIMEOUT]:
    'The request timed out. Check your internet connection. Spool will retry later.',
  [SyncErrorCode.API_PARSE_ERROR]:
    'The platform returned an unexpected response format. This may indicate an API change — check for Spool updates.',
  [SyncErrorCode.API_UNEXPECTED_STATUS]:
    'The platform returned an unexpected HTTP status. This may be temporary — Spool will retry later.',
  [SyncErrorCode.SYNC_MAX_PAGES]:
    'Sync stopped after reaching the page limit. Remaining data will be fetched in the next cycle.',
  [SyncErrorCode.SYNC_TIMEOUT]:
    'Sync stopped after reaching the time limit. Remaining data will be fetched in the next cycle.',
  [SyncErrorCode.SYNC_CANCELLED]:
    'Sync was cancelled. It will resume in the next cycle.',
  [SyncErrorCode.DB_WRITE_ERROR]:
    'Failed to write to the local database. Check disk space and permissions for ~/.spool/',
  [SyncErrorCode.CONNECTOR_ERROR]:
    'The connector encountered an error. Check the error details below.',
}

const RETRYABLE_CODES = new Set<SyncErrorCode>([
  SyncErrorCode.API_RATE_LIMITED,
  SyncErrorCode.API_SERVER_ERROR,
  SyncErrorCode.NETWORK_OFFLINE,
  SyncErrorCode.NETWORK_TIMEOUT,
  SyncErrorCode.SYNC_MAX_PAGES,
  SyncErrorCode.SYNC_TIMEOUT,
  SyncErrorCode.SYNC_CANCELLED,
])

/**
 * Error thrown by connectors and the sync engine. Tagged with a machine-readable
 * SyncErrorCode so the framework and UI can classify and respond.
 *
 * This is a plain class, not `Data.TaggedError` — the SDK cannot depend on
 * `effect`. `@spool/core` wraps this in an `Effect.Cause` boundary internally.
 */
export class SyncError extends Error {
  readonly _tag = 'SyncError' as const
  readonly code: SyncErrorCode
  readonly cause?: unknown

  constructor(code: SyncErrorCode, message?: string, cause?: unknown) {
    super(message ?? SYNC_ERROR_HINTS[code])
    this.name = 'SyncError'
    this.code = code
    this.cause = cause
  }

  static from(e: unknown): SyncError {
    if (e instanceof SyncError) return e
    return new SyncError(
      SyncErrorCode.CONNECTOR_ERROR,
      e instanceof Error ? e.message : String(e),
      e,
    )
  }

  /** Whether this error indicates the connector needs re-authentication. */
  get needsReauth(): boolean {
    return this.code.startsWith('AUTH_')
  }

  /** Whether this error is transient and the sync can be retried. */
  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code)
  }
}
```

**Important:** This is a behavioral change — `SyncError` is no longer a `Data.TaggedError`. `@spool/core` must be updated to either wrap SDK errors into its own tagged variant or switch usage sites from pattern matching on `_tag` via Effect's `Match` to using `instanceof SyncError` + `.code`. Task 5 handles this.

- [ ] **Step 2.3: Create `connector.ts`**

`packages/connector-sdk/src/connector.ts`:

```typescript
import type { SyncErrorCode } from './errors.js'
import type { CapturedItem } from './captured-item.js'

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthStatus {
  ok: boolean
  error?: SyncErrorCode
  message?: string
  /** Actionable guidance for the user. */
  hint?: string
}

// ── Page result ──────────────────────────────────────────────────────────────

export interface PageResult {
  items: CapturedItem[]
  /** Cursor for the next page. null = no more data. */
  nextCursor: string | null
}

// ── Fetch context ────────────────────────────────────────────────────────────

export interface FetchContext {
  /** Pagination cursor. null = start from the newest page. */
  cursor: string | null
  /** Platform ID of the newest known item (head anchor). null = no anchor. */
  sinceItemId: string | null
  /** Which sync phase is requesting this page. */
  phase: 'forward' | 'backfill'
  /**
   * AbortSignal that fires when the sync engine wants to stop this sync.
   * Connectors should pass it through to their fetch calls and respect it
   * in retry/backoff loops (use `abortableSleep(ms, signal)`).
   *
   * Ignoring this signal is valid — the engine still interrupts at its own
   * layer — but cancellation response time will be slower.
   */
  signal: AbortSignal
}

// ── Connector interface ──────────────────────────────────────────────────────

export interface Connector {
  /** Unique identifier, e.g. 'twitter-bookmarks'. */
  readonly id: string
  /** Platform name for grouping, e.g. 'twitter'. */
  readonly platform: string
  /** Human-readable label, e.g. 'X Bookmarks'. */
  readonly label: string
  /** Short description for the connector picker. */
  readonly description: string
  /** UI color for badges/dots. */
  readonly color: string
  /** Ephemeral = cache (full-replace), persistent = user-owned (dual-frontier). */
  readonly ephemeral: boolean

  /** Check if authentication / prerequisites are available. */
  checkAuth(opts?: Record<string, string>): Promise<AuthStatus>

  /**
   * Fetch one page of data.
   *
   * The sync engine calls this repeatedly, following nextCursor.
   * The connector handles API-level retries (429, 5xx) internally.
   * If retries are exhausted, throw a SyncError.
   */
  fetchPage(ctx: FetchContext): Promise<PageResult>
}
```

- [ ] **Step 2.4: Create `sync-state.ts`** — copy the `SyncState` interface from `packages/core/src/connectors/types.ts`:195–218 verbatim (same text, different module):

`packages/connector-sdk/src/sync-state.ts`:

```typescript
import type { SyncErrorCode } from './errors.js'

/**
 * Per-connector sync state. Persisted in SQLite by the framework.
 * Plugins do not mutate this directly — the framework manages it.
 *
 * This type is exported from the SDK for reference (docs, type imports)
 * but plugins never construct or modify SyncState instances.
 */
export interface SyncState {
  connectorId: string
  // Head frontier (newest end)
  headCursor: string | null
  headItemId: string | null
  // Tail frontier (oldest end)
  tailCursor: string | null
  tailComplete: boolean
  // Metadata
  lastForwardSyncAt: string | null
  lastBackfillSyncAt: string | null
  totalSynced: number
  consecutiveErrors: number
  enabled: boolean
  /** Per-connector config overrides (e.g. Chrome profile). */
  configJson: Record<string, unknown>
  /** When the last error occurred (ISO 8601). Used as the backoff base time.
   *  Cleared on successful sync. */
  lastErrorAt: string | null
  /** Last error code, null if last sync succeeded. */
  lastErrorCode: SyncErrorCode | null
  /** Last error message for UI display. */
  lastErrorMessage: string | null
}
```

- [ ] **Step 2.5: Wire exports in `index.ts`**

`packages/connector-sdk/src/index.ts`:

```typescript
// Public plugin contract types
export type { Connector, AuthStatus, PageResult, FetchContext } from './connector.js'
export type { CapturedItem } from './captured-item.js'
export type { SyncState } from './sync-state.js'

// Error types
export { SyncError, SyncErrorCode, SYNC_ERROR_HINTS } from './errors.js'
```

- [ ] **Step 2.6: Add dependency in `@spool/core`**

Edit `packages/core/package.json` — add `"@spool/connector-sdk": "workspace:^"` to `dependencies`:

```json
  "dependencies": {
    "@spool/connector-sdk": "workspace:^",
    "better-sqlite3": "^11.10.0",
    "chokidar": "^4.0.3",
    "effect": "^3.21.0"
  },
```

- [ ] **Step 2.7: Refactor `packages/core/src/connectors/types.ts` to re-export from SDK**

Replace the contents of `packages/core/src/connectors/types.ts` with:

```typescript
import { Data } from 'effect'
import type { Deferred } from 'effect'
import type {
  SyncErrorCode,
  Connector,
  AuthStatus,
  PageResult,
  FetchContext,
  CapturedItem,
  SyncState,
} from '@spool/connector-sdk'
import { SyncError as SdkSyncError, SYNC_ERROR_HINTS } from '@spool/connector-sdk'

// ── Re-exports from SDK ────────────────────────────────────────────────────
export {
  SyncErrorCode,
  SYNC_ERROR_HINTS,
} from '@spool/connector-sdk'
export type {
  Connector,
  AuthStatus,
  PageResult,
  FetchContext,
  CapturedItem,
  SyncState,
} from '@spool/connector-sdk'

// ── Internal Effect-tagged SyncError ──────────────────────────────────────
/**
 * Internal Effect-tagged version of SyncError used inside @spool/core for
 * Effect's typed error channel. External callers (connectors) use the plain
 * class exported from @spool/connector-sdk. Translation between the two
 * happens in SyncError.from() and SyncError.toCauseSafe().
 */
export class SyncError extends Data.TaggedError('SyncError')<{
  readonly code: SyncErrorCode
  readonly message: string
  readonly cause?: unknown
}> {
  constructor(code: SyncErrorCode, message?: string, cause?: unknown) {
    super({ code, message: message ?? SYNC_ERROR_HINTS[code], cause })
  }

  static from(e: unknown): SyncError {
    if (e instanceof SyncError) return e
    if (e instanceof SdkSyncError) {
      return new SyncError(e.code, e.message, e.cause)
    }
    return new SyncError(
      SyncErrorCode.CONNECTOR_ERROR,
      e instanceof Error ? e.message : String(e),
      e,
    )
  }

  /** Whether this error indicates the connector needs re-authentication. */
  get needsReauth(): boolean {
    return this.code.startsWith('AUTH_')
  }

  /** Whether this error is transient and the sync can be retried. */
  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code)
  }
}

const RETRYABLE_CODES = new Set<SyncErrorCode>([
  SyncErrorCode.API_RATE_LIMITED,
  SyncErrorCode.API_SERVER_ERROR,
  SyncErrorCode.NETWORK_OFFLINE,
  SyncErrorCode.NETWORK_TIMEOUT,
  SyncErrorCode.SYNC_MAX_PAGES,
  SyncErrorCode.SYNC_TIMEOUT,
  SyncErrorCode.SYNC_CANCELLED,
])

// ── SyncOptions / SyncProgress / ConnectorSyncResult ──────────────────────
// Remain in @spool/core (not exposed via SDK because they reference Deferred).

export interface SyncOptions {
  /** Which direction to sync. Default: 'both'. */
  direction?: 'forward' | 'backfill' | 'both'
  /** Delay between page requests in ms. Default: 600. */
  delayMs?: number
  /** Max runtime in minutes. 0 = unlimited. Default: 0 (no limit). */
  maxMinutes?: number
  /** Consecutive pages with 0 new items before stopping forward sync. Default: 3. */
  stalePageLimit?: number
  /** AbortSignal for cancellation. */
  signal?: AbortSignal
  /**
   * Caller-owned cancellation Deferred. When provided, syncEffect uses this
   * instead of creating its own — allowing callers like SyncScheduler to
   * cancel from outside. If `signal` is also set, it is bridged into this
   * Deferred.
   */
  cancel?: Deferred.Deferred<void>
  /** Progress callback. */
  onProgress?: (progress: SyncProgress) => void
}

export interface SyncProgress {
  connectorId: string
  phase: 'forward' | 'backfill'
  page: number
  fetched: number
  added: number
  running: boolean
}

export interface ConnectorSyncResult {
  connectorId: string
  added: number
  total: number
  pages: number
  direction: 'forward' | 'backfill' | 'both'
  stopReason: string
  error?: {
    code: SyncErrorCode
    message: string
  }
}

// ── Scheduler types (remain in core) ──────────────────────────────────────

export interface ScheduleConfig {
  forwardIntervalMs: number
  backfillIntervalMs: number
  concurrency: number
  pageDelayMs: number
  retryBackoffMs: number[]
  maxMinutesPerRun: number
}

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  forwardIntervalMs: 15 * 60_000,
  backfillIntervalMs: 60 * 60_000,
  concurrency: 1,
  pageDelayMs: 1200,
  retryBackoffMs: [60_000, 300_000, 1_800_000, 7_200_000],
  maxMinutesPerRun: 10,
}

export type SyncJobPriority = 100 | 80 | 60 | 40 | 20

export interface SyncJob {
  connectorId: string
  direction: 'forward' | 'backfill' | 'both'
  priority: SyncJobPriority
  queuedAt: number
}

export interface ConnectorStatus {
  id: string
  label: string
  description: string
  platform: string
  color: string
  enabled: boolean
  syncing: boolean
  state: SyncState
}

export interface SchedulerStatus {
  running: boolean
  connectors: ConnectorStatus[]
}
```

**Key change from the old file:** the old file had one `SyncError` that extended `Data.TaggedError`. The new file keeps a core-internal `SyncError` (still `Data.TaggedError`) but also imports the SDK's plain-class `SyncError` (aliased as `SdkSyncError`) and translates in `SyncError.from()`. This allows the engine's Effect-typed error channel to keep working unchanged, while connectors throw SDK-class errors that get translated at the boundary.

- [ ] **Step 2.8: Run build and tests**

Run:
```bash
pnpm install
pnpm --filter @spool/connector-sdk build
pnpm --filter @spool/core build
pnpm --filter @spool/core test
```

Expected: all green. The re-exports mean every file in `@spool/core` that previously imported `SyncErrorCode`/`Connector`/etc. from `./types.js` still works.

- [ ] **Step 2.9: Commit**

```bash
git add packages/connector-sdk/src/ packages/core/src/connectors/types.ts packages/core/package.json pnpm-lock.yaml
git commit -m "feat(connector-sdk): migrate core contract types to SDK

Move Connector, FetchContext, PageResult, AuthStatus, CapturedItem,
SyncState, SyncError, SyncErrorCode to @spool/connector-sdk. @spool/core
re-exports them for backwards compatibility and keeps a core-internal
Effect-tagged SyncError for use in Effect's typed error channel.

SDK has zero runtime dependencies.

Part of Stage D (SDK split)."
```

---

### Task 3: Define capability type contracts

**Files:**
- Create: `packages/connector-sdk/src/capabilities.ts`
- Modify: `packages/connector-sdk/src/index.ts`

- [ ] **Step 3.1: Write capability types**

`packages/connector-sdk/src/capabilities.ts`:

```typescript
// ── Fetch ───────────────────────────────────────────────────────────────────

/**
 * Proxy-aware HTTP fetch. Shape-compatible with the standard `fetch` global.
 * Connector authors can use it exactly like `fetch(url, init)`.
 *
 * Convention (not type-enforced): use only `status`, `ok`, `headers`,
 * `text()`, `json()`, `arrayBuffer()` on the Response. Streaming APIs
 * (`body` as ReadableStream, FormData bodies) are not guaranteed to work
 * across all injected implementations.
 */
export type FetchCapability = typeof globalThis.fetch

// ── Cookies ─────────────────────────────────────────────────────────────────

export interface CookiesCapability {
  /** Returns decrypted cookies matching the query. */
  get(query: CookieQuery): Promise<Cookie[]>
}

export interface CookieQuery {
  /** v1 only supports 'chrome'. Future versions may add 'safari' | 'firefox'. */
  browser: 'chrome'
  /** Chrome profile directory name; defaults to 'Default'. */
  profile?: string
  /** Filter cookies by URL (host + path matching). */
  url: string
}

export interface Cookie {
  name: string
  /** Already-decrypted plaintext value. */
  value: string
  domain: string
  path: string
  /** Unix timestamp (seconds); null = session cookie. */
  expires: number | null
  secure: boolean
  httpOnly: boolean
}

// ── Log ─────────────────────────────────────────────────────────────────────

export interface LogCapability {
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void

  /**
   * Run an async block inside a tracing span. The span is automatically
   * closed when the promise settles (including on exception). Span duration
   * and attributes are forwarded to the framework's OpenTelemetry exporter
   * when one is configured.
   */
  span<T>(
    name: string,
    fn: () => Promise<T>,
    opts?: { attributes?: LogFields }
  ): Promise<T>
}

export type LogFields = Record<string, string | number | boolean | null>

// ── Bundle ──────────────────────────────────────────────────────────────────

/**
 * The full set of capabilities passed to a connector's constructor.
 * v1.0: 3 capabilities. Future versions may add more via additive, non-breaking
 * extension — connectors only receive what they declared in spool.capabilities.
 */
export interface ConnectorCapabilities {
  fetch: FetchCapability
  cookies: CookiesCapability
  log: LogCapability
}

// ── Manifest allowed values ────────────────────────────────────────────────

/**
 * The complete set of capability strings allowed in a connector's
 * `spool.capabilities` manifest field as of SDK v1. Future versions add to
 * this set (additive, non-breaking).
 */
export const KNOWN_CAPABILITIES_V1 = [
  'fetch',
  'cookies:chrome',
  'log',
] as const

export type KnownCapabilityV1 = typeof KNOWN_CAPABILITIES_V1[number]
```

- [ ] **Step 3.2: Add exports to barrel**

`packages/connector-sdk/src/index.ts` (replace):

```typescript
// Public plugin contract types
export type { Connector, AuthStatus, PageResult, FetchContext } from './connector.js'
export type { CapturedItem } from './captured-item.js'
export type { SyncState } from './sync-state.js'

// Error types
export { SyncError, SyncErrorCode, SYNC_ERROR_HINTS } from './errors.js'

// Capabilities
export type {
  FetchCapability,
  CookiesCapability,
  Cookie,
  CookieQuery,
  LogCapability,
  LogFields,
  ConnectorCapabilities,
  KnownCapabilityV1,
} from './capabilities.js'
export { KNOWN_CAPABILITIES_V1 } from './capabilities.js'
```

- [ ] **Step 3.3: Verify build**

Run:
```bash
pnpm --filter @spool/connector-sdk build
```

Expected: success. `dist/capabilities.js` and `dist/capabilities.d.ts` exist.

- [ ] **Step 3.4: Commit**

```bash
git add packages/connector-sdk/src/capabilities.ts packages/connector-sdk/src/index.ts
git commit -m "feat(connector-sdk): add capability type contracts

FetchCapability, CookiesCapability, LogCapability, ConnectorCapabilities.
KNOWN_CAPABILITIES_V1 lists the 3 manifest-allowed values (fetch,
cookies:chrome, log). storage deliberately excluded from v1 per
Stage D design doc §3.1.

Part of Stage D (SDK split)."
```

---

### Task 4: Add `abortableSleep` utility + tests

**Files:**
- Create: `packages/connector-sdk/src/utils.ts`
- Create: `packages/connector-sdk/src/utils.test.ts`
- Modify: `packages/connector-sdk/src/index.ts`

- [ ] **Step 4.1: Write failing test**

`packages/connector-sdk/src/utils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { abortableSleep } from './utils.js'

describe('abortableSleep', () => {
  it('resolves after the specified duration when signal is not aborted', async () => {
    const start = Date.now()
    await abortableSleep(50)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(45)
    expect(elapsed).toBeLessThan(200)
  })

  it('rejects immediately if signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort(new Error('pre-aborted'))
    await expect(abortableSleep(5000, ac.signal)).rejects.toThrow('pre-aborted')
  })

  it('rejects when signal fires during sleep', async () => {
    const ac = new AbortController()
    const sleepPromise = abortableSleep(5000, ac.signal)
    setTimeout(() => ac.abort(new Error('cancelled')), 20)
    const start = Date.now()
    await expect(sleepPromise).rejects.toThrow('cancelled')
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(200)
  })

  it('does not leak timeout when signal fires', async () => {
    // Smoke test: run many abort cycles and check test completes promptly.
    for (let i = 0; i < 100; i++) {
      const ac = new AbortController()
      const p = abortableSleep(10_000, ac.signal).catch(() => {})
      ac.abort()
      await p
    }
  })

  it('does not leak listener when timeout completes', async () => {
    const ac = new AbortController()
    await abortableSleep(10, ac.signal)
    // If we leaked a listener, aborting now would try to call a closure
    // bound to the resolved promise. This test just verifies no crash.
    ac.abort()
  })
})
```

- [ ] **Step 4.2: Run test — expect FAIL**

Run:
```bash
pnpm --filter @spool/connector-sdk test
```

Expected: FAIL with "cannot find module './utils.js'" or similar.

- [ ] **Step 4.3: Implement**

`packages/connector-sdk/src/utils.ts`:

```typescript
/**
 * Sleep for `ms` milliseconds, cancellable via AbortSignal.
 * Rejects with the signal's reason if the signal fires before the timeout
 * completes. Cleans up both the timeout and the abort listener on every
 * exit path, so there's no leak even under repeated abort cycles.
 *
 * Use this inside connector retry/backoff loops so cancellation from the
 * sync engine propagates within one event-loop tick instead of waiting for
 * a naked setTimeout to complete.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(signal.reason)
    }
    let timeout: ReturnType<typeof setTimeout> | undefined
    const onAbort = () => {
      if (timeout) clearTimeout(timeout)
      reject(signal!.reason)
    }
    timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
```

- [ ] **Step 4.4: Run test — expect PASS**

Run:
```bash
pnpm --filter @spool/connector-sdk test
```

Expected: all 5 tests green.

- [ ] **Step 4.5: Add export**

Append to `packages/connector-sdk/src/index.ts`:

```typescript
// Utilities
export { abortableSleep } from './utils.js'
```

- [ ] **Step 4.6: Verify SDK has zero runtime deps**

Run:
```bash
pnpm --filter @spool/connector-sdk build
pnpm --filter @spool/connector-sdk pack --pack-destination /tmp
cd /tmp && tar -tzf spool-connector-sdk-*.tgz | grep -v node_modules && ls -la spool-connector-sdk-*.tgz
```

Expected: tarball size < 50 KB, contents only `package/package.json`, `package/README.md`, `package/dist/**`. Confirm `package.json` in the tarball has no `dependencies` field (only `devDependencies` are in the source).

Also verify:
```bash
cd /tmp && tar -xzf spool-connector-sdk-*.tgz && cat package/package.json | grep -A5 '"dependencies"' || echo "OK: no dependencies field"
```

Expected: `OK: no dependencies field` (or empty dependencies object).

- [ ] **Step 4.7: Commit**

```bash
git add packages/connector-sdk/src/utils.ts packages/connector-sdk/src/utils.test.ts packages/connector-sdk/src/index.ts
git commit -m "feat(connector-sdk): add abortableSleep utility

Cancellable sleep for connector retry/backoff loops. Rejects with the
signal's reason when the signal fires. Cleans up timeout + listener on
every exit path.

Part of Stage D (SDK split)."
```

---

### Task 5: Add `FetchContext.signal` + sync engine bridging

**Files:**
- Modify: `packages/core/src/connectors/sync-engine.ts`
- Modify: `packages/core/src/connectors/sync-engine.test.ts` (or appropriate existing test file)

- [ ] **Step 5.1: Read current sync-engine signal handling**

Read lines 25–45 of `packages/core/src/connectors/sync-engine.ts` for the existing `bridgeAbortSignal` helper (bridges `opts.signal` INTO a `cancel` Deferred). We need to add a NEW helper that goes the opposite direction (bridges the `cancel` Deferred OUT to an AbortSignal).

- [ ] **Step 5.2: Write failing test for engine cancel → signal bridging**

Add test case to `packages/core/src/connectors/sync-engine.effect.test.ts` (or create `sync-engine.signal.test.ts` if preferred):

```typescript
import { describe, it, expect, vi } from 'vitest'
import { Deferred, Effect } from 'effect'
import { SyncEngine } from './sync-engine.js'
import { makeTestDb, fakeConnector } from './test-helpers.js'
import type { Connector, FetchContext } from '@spool/connector-sdk'

describe('SyncEngine signal bridging', () => {
  it('passes an AbortSignal to fetchPage that fires when cancel Deferred resolves', async () => {
    const db = makeTestDb()
    const engine = new SyncEngine(db)
    let receivedSignal: AbortSignal | undefined

    const connector: Connector = {
      ...fakeConnector('test-signal'),
      async fetchPage(ctx: FetchContext) {
        receivedSignal = ctx.signal
        // Wait for signal to fire
        await new Promise<void>((resolve, reject) => {
          if (ctx.signal.aborted) return resolve()
          ctx.signal.addEventListener('abort', () => resolve(), { once: true })
        })
        return { items: [], nextCursor: null }
      },
    }

    const cancel = await Effect.runPromise(Deferred.make<void>())

    // Start sync; it should block on fetchPage waiting for abort
    const syncPromise = Effect.runPromise(
      engine.syncEffect(connector, { cancel }),
    )

    // Give the engine a tick to reach fetchPage
    await new Promise(r => setTimeout(r, 20))
    expect(receivedSignal).toBeDefined()
    expect(receivedSignal!.aborted).toBe(false)

    // Fire cancel Deferred
    await Effect.runPromise(Deferred.succeed(cancel, undefined))

    // Expect sync to complete (fetchPage unblocks via signal)
    const result = await syncPromise
    expect(result.stopReason).toContain('cancel')
    expect(receivedSignal!.aborted).toBe(true)
  }, 5000)
})
```

- [ ] **Step 5.3: Run test — expect FAIL**

Run:
```bash
pnpm --filter @spool/core test -- sync-engine.effect.test
```

Expected: FAIL. Either type error (`signal` not in `FetchContext`) or the connector's `fetchPage` never receives an aborting signal.

- [ ] **Step 5.4: Add reverse bridge helper in sync-engine.ts**

Add near the top of `packages/core/src/connectors/sync-engine.ts` (after the existing `bridgeAbortSignal` function):

```typescript
/**
 * Convert a cancel Deferred into an AbortSignal that fires when the Deferred
 * resolves. Used to hand a cancellation-aware signal to connectors' fetchPage
 * so they can pass it through to HTTP fetch calls and abortableSleep loops.
 *
 * The returned controller is scoped to the current Effect — aborting is
 * idempotent, and the caller does NOT need to clean up the listener (the
 * Deferred only fires once, and the controller is GC'd when the Effect scope
 * exits).
 */
function cancelDeferredToSignal(
  cancel: Deferred.Deferred<void>,
): Effect.Effect<AbortSignal> {
  return Effect.sync(() => {
    const controller = new AbortController()
    // Poll-once: if already done, abort immediately.
    Effect.runFork(
      Effect.gen(function* () {
        yield* Deferred.await(cancel)
        controller.abort()
      }),
    )
    return controller.signal
  })
}
```

- [ ] **Step 5.5: Modify fetchCtx construction at both call sites**

Find `packages/core/src/connectors/sync-engine.ts` line near 387 and update:

```typescript
// Before:
const fetchCtx: FetchContext = { cursor, sinceItemId, phase: opts.phase }

// After:
const fetchCtx: FetchContext = { cursor, sinceItemId, phase: opts.phase, signal }
```

Where `signal` is computed once per `syncPersistentEffect` / `syncEphemeralEffect` call before the fetch loop begins. Add this near the top of those functions:

```typescript
const signal = yield* cancelDeferredToSignal(cancel)
```

Repeat for the ephemeral fetch call site (around line 677 in the current code):

```typescript
// Before:
try: () => connector.fetchPage({ cursor, sinceItemId: null, phase: 'forward' }),

// After:
try: () => connector.fetchPage({ cursor, sinceItemId: null, phase: 'forward', signal }),
```

- [ ] **Step 5.6: Run test — expect PASS**

Run:
```bash
pnpm --filter @spool/core test -- sync-engine.effect.test
```

Expected: the new signal bridging test passes.

- [ ] **Step 5.7: Run full core test suite**

Run:
```bash
pnpm --filter @spool/core test
```

Expected: all existing Phase B + cut #3 tests still green. No regression.

- [ ] **Step 5.8: Commit**

```bash
git add packages/core/src/connectors/sync-engine.ts packages/core/src/connectors/sync-engine.effect.test.ts
git commit -m "feat(sync-engine): bridge cancel Deferred to FetchContext.signal

Add cancelDeferredToSignal helper that turns the engine's internal cancel
Deferred into an AbortSignal passed through FetchContext to connector
fetchPage. Connectors can now pass this signal to HTTP fetch and
abortableSleep loops, making scheduler.stop() propagate within one
event-loop tick instead of waiting for naked setTimeout to complete.

This adds one field to FetchContext — a strict superset, non-breaking
for any plugin that ignores it. Classified as a one-time Stage D
exception to the 'no interface changes' rule per design doc §3.2.

Part of Stage D (SDK split)."
```

---

## Phase 2 — Workspace Container

### Task 6: Add `packages/connectors/*` to pnpm workspace

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `packages/connectors/.gitkeep`

- [ ] **Step 6.1: Edit workspace config**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "packages/connectors/*"
```

- [ ] **Step 6.2: Create placeholder**

```bash
mkdir -p packages/connectors
touch packages/connectors/.gitkeep
```

- [ ] **Step 6.3: Verify pnpm install still succeeds**

Run:
```bash
pnpm install
```

Expected: no error. `pnpm-lock.yaml` may or may not change (empty container has no effect yet).

- [ ] **Step 6.4: Commit**

```bash
git add pnpm-workspace.yaml packages/connectors/.gitkeep
git commit -m "chore(workspace): add packages/connectors/* to pnpm workspace

Empty container for first-party plugin workspace packages. Plugins
(Twitter, Typeless) are added in subsequent Stage D tasks.

Part of Stage D (SDK split)."
```

---

## Phase 3 — Capability Implementations

### Task 7: Move `chrome-cookies.ts` to core capabilities and wrap as `CookiesCapability`

**Files:**
- Create: `packages/core/src/connectors/capabilities/cookies-chrome.ts`
- Delete: `packages/core/src/connectors/twitter-bookmarks/chrome-cookies.ts` (moved)
- Create: `packages/core/src/connectors/capabilities/cookies-chrome.test.ts`

- [ ] **Step 7.1: Move file and wrap**

Create `packages/core/src/connectors/capabilities/cookies-chrome.ts` with the full contents of the current `twitter-bookmarks/chrome-cookies.ts`, **plus** a new exported `makeChromeCookiesCapability` function at the bottom:

```typescript
// ... (copy all existing functions from chrome-cookies.ts verbatim)
// extractChromeXCookies, decryptCookieValue, detectChromeUserDataDir, etc.

import type { CookiesCapability, Cookie, CookieQuery } from '@spool/connector-sdk'
import { SyncError, SyncErrorCode } from '@spool/connector-sdk'

/**
 * Build a CookiesCapability that reads from the local Chrome installation.
 * Handles keychain access, AES-CBC decryption, Chrome DB version differences,
 * and filters cookies by URL host/path.
 *
 * Each connector gets its own capability instance via the loader; the
 * capability is stateless so sharing is also safe.
 */
export function makeChromeCookiesCapability(): CookiesCapability {
  return {
    async get(query: CookieQuery): Promise<Cookie[]> {
      if (query.browser !== 'chrome') {
        throw new SyncError(
          SyncErrorCode.CONNECTOR_ERROR,
          `Unsupported browser: ${query.browser}. v1 supports 'chrome' only.`,
        )
      }

      const profile = query.profile ?? 'Default'
      const dataDir = detectChromeUserDataDir()
      const url = new URL(query.url)
      const domain = url.hostname

      // Reuse existing queryCookies helper but without the name filter —
      // we return all cookies matching the host and let the caller filter.
      const allCookies = queryAllCookiesForHost(dataDir, profile, domain)
      const decrypted = decryptCookieList(allCookies, dataDir, profile)

      // Filter by URL path
      return decrypted.filter(c => urlPathMatches(c.path, url.pathname))
    },
  }
}

/**
 * Internal helper: query all cookies for a given host (no name filter).
 * Returns raw decrypted-value Cookie objects ready for SDK shape.
 */
function queryAllCookiesForHost(
  dataDir: string,
  profile: string,
  domain: string,
): RawCookieFull[] {
  // Adapt the existing queryCookies function to return all fields
  // the SDK Cookie shape needs: name, value, domain, path, expires, secure, httpOnly.
  // Original queryCookies only selected (name, host_key, encrypted_value_hex, value).
  // This helper selects the full row including path, expires_utc, is_secure, is_httponly.
  const dbPath = require('path').join(dataDir, profile, 'Cookies')
  if (!require('fs').existsSync(dbPath)) {
    throw new SyncError(
      SyncErrorCode.AUTH_CHROME_NOT_FOUND,
      `Chrome Cookies database not found at: ${dbPath}`,
    )
  }

  const sql = `SELECT name, host_key as domain, path,
    expires_utc as expires, is_secure as secure, is_httponly as httpOnly,
    hex(encrypted_value) as encrypted_value_hex, value
    FROM cookies WHERE host_key LIKE '%${domain.replace(/'/g, "''")}';`

  // Use same execFileSync + tmp copy fallback as existing queryCookies
  const output = runSqlite3(dbPath, sql)
  return output ? JSON.parse(output) : []
}

interface RawCookieFull {
  name: string
  domain: string
  path: string
  expires: number
  secure: number
  httpOnly: number
  encrypted_value_hex: string
  value: string
}

function decryptCookieList(
  rows: RawCookieFull[],
  dataDir: string,
  profile: string,
): Cookie[] {
  const key = getMacOSChromeKey()
  const dbPath = require('path').join(dataDir, profile, 'Cookies')
  const dbVersion = queryDbVersion(dbPath)
  return rows.map(row => ({
    name: row.name,
    value: row.encrypted_value_hex
      ? decryptCookieValue(Buffer.from(row.encrypted_value_hex, 'hex'), key, dbVersion)
      : row.value,
    domain: row.domain,
    path: row.path,
    expires: row.expires > 0 ? Math.floor(row.expires / 1_000_000 - 11644473600) : null,
    secure: Boolean(row.secure),
    httpOnly: Boolean(row.httpOnly),
  }))
}

function urlPathMatches(cookiePath: string, requestPath: string): boolean {
  if (!cookiePath || cookiePath === '/') return true
  return requestPath.startsWith(cookiePath)
}
```

**Note on Chromium expires_utc**: Chromium stores `expires_utc` as microseconds since 1601-01-01. Convert to Unix seconds via `expires/1_000_000 - 11644473600`. `0` means session cookie.

**Refactor reminder**: the existing `chrome-cookies.ts` has functions `getMacOSChromeKey`, `decryptCookieValue`, `queryDbVersion`, `detectChromeUserDataDir`, `sanitizeCookieValue`. Keep those as non-exported helpers in the new file. `runSqlite3` is a new helper extracted from the duplicated `execFileSync` + tmp-copy fallback code.

- [ ] **Step 7.2: Delete old `chrome-cookies.ts`**

```bash
git rm packages/core/src/connectors/twitter-bookmarks/chrome-cookies.ts
```

Do NOT delete `twitter-bookmarks/index.ts` or `graphql-fetch.ts` yet — those move to the plugin package in Task 10.

- [ ] **Step 7.3: Update `twitter-bookmarks/index.ts` import (temporary)**

Temporarily update `packages/core/src/connectors/twitter-bookmarks/index.ts` lines 3, 5:

```typescript
// Before:
import { extractChromeXCookies, detectChromeUserDataDir } from './chrome-cookies.js'
import type { ChromeCookieResult } from './chrome-cookies.js'

// After (temporary, until Task 10):
import { extractChromeXCookies, detectChromeUserDataDir } from '../capabilities/cookies-chrome.js'
import type { ChromeCookieResult } from '../capabilities/cookies-chrome.js'
```

Also export `extractChromeXCookies`, `detectChromeUserDataDir`, and `ChromeCookieResult` from the new `cookies-chrome.ts` (for this transitional step) — they will disappear when Twitter is fully migrated in Task 10.

- [ ] **Step 7.4: Write failing test for `makeChromeCookiesCapability`**

`packages/core/src/connectors/capabilities/cookies-chrome.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { makeChromeCookiesCapability } from './cookies-chrome.js'
import { SyncError, SyncErrorCode } from '@spool/connector-sdk'

describe('makeChromeCookiesCapability', () => {
  it('returns a capability with a get method', () => {
    const cap = makeChromeCookiesCapability()
    expect(typeof cap.get).toBe('function')
  })

  it('rejects non-chrome browser', async () => {
    const cap = makeChromeCookiesCapability()
    // @ts-expect-error — testing runtime guard against invalid union value
    await expect(cap.get({ browser: 'safari', url: 'https://x.com' }))
      .rejects.toThrow(SyncError)
  })

  // Integration-style test: only runs if Chrome is available
  it.skipIf(!process.env.CI_HAS_CHROME)(
    'returns cookies from Chrome for x.com',
    async () => {
      const cap = makeChromeCookiesCapability()
      const cookies = await cap.get({ browser: 'chrome', url: 'https://x.com' })
      // Just verify shape — actual values depend on user's login state
      expect(Array.isArray(cookies)).toBe(true)
      for (const c of cookies) {
        expect(typeof c.name).toBe('string')
        expect(typeof c.value).toBe('string')
        expect(typeof c.secure).toBe('boolean')
      }
    },
  )
})
```

- [ ] **Step 7.5: Run test — expect PASS for non-integration cases**

Run:
```bash
pnpm --filter @spool/core test -- cookies-chrome
```

Expected: both non-integration tests green. The Chrome integration test is skipped unless `CI_HAS_CHROME=1`.

- [ ] **Step 7.6: Run full core tests**

Run:
```bash
pnpm --filter @spool/core test
```

Expected: all green. Twitter still works via the transitional import path from Step 7.3.

- [ ] **Step 7.7: Commit**

```bash
git add packages/core/src/connectors/capabilities/ packages/core/src/connectors/twitter-bookmarks/index.ts
git rm packages/core/src/connectors/twitter-bookmarks/chrome-cookies.ts
git commit -m "refactor(connectors): move chrome-cookies to core/capabilities/

Move chrome-cookies.ts from twitter-bookmarks/ to core/connectors/capabilities/
and add makeChromeCookiesCapability wrapper matching the SDK CookiesCapability
shape. Twitter connector still uses the old extraction helpers via a
transitional import path — it migrates to the capability in Task 10.

Part of Stage D (SDK split)."
```

---

### Task 8: Create `FetchCapability` and `LogCapability` implementations in core

**Files:**
- Create: `packages/core/src/connectors/capabilities/fetch-impl.ts`
- Create: `packages/core/src/connectors/capabilities/log-impl.ts`
- Create: `packages/core/src/connectors/capabilities/index.ts`

- [ ] **Step 8.1: Create `fetch-impl.ts`**

`packages/core/src/connectors/capabilities/fetch-impl.ts`:

```typescript
import type { FetchCapability } from '@spool/connector-sdk'

/**
 * Build a FetchCapability from an externally-supplied fetch function.
 * The caller (Electron main in production, test setup in tests) is
 * responsible for passing a proxy-aware fetch.
 *
 * In production, the app constructs this with `net.fetch` wrapped to
 * respect Electron's system proxy settings.
 * In tests, a plain `globalThis.fetch` or a mocked variant is used.
 */
export function makeFetchCapability(
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): FetchCapability {
  return fetchFn
}
```

**Note**: This is a one-line wrapper today because `FetchCapability = typeof globalThis.fetch`. The function exists to give the loader a consistent construction API (`makeXxxCapability`) and to provide a place to add future features (per-connector fetch tagging, per-request timeouts, etc.) without changing call sites.

- [ ] **Step 8.2: Create `log-impl.ts`**

`packages/core/src/connectors/capabilities/log-impl.ts`:

```typescript
import { Effect } from 'effect'
import type { LogCapability, LogFields } from '@spool/connector-sdk'

/**
 * Build a LogCapability tagged to a specific connector ID.
 *
 * Internally bridges to Effect.logDebug/logInfo/logWarning/logError and
 * Effect.withSpan, tagging all emissions with the connector ID. The plugin
 * boundary remains Promise/callback-shaped — Effect types never cross into
 * the plugin.
 *
 * Each log call is independent: it constructs a one-shot Effect and runs
 * it via Effect.runFork. This is fire-and-forget; plugin log calls never
 * block or return a Promise the plugin has to await.
 */
export function makeLogCapabilityFor(connectorId: string): LogCapability {
  const baseAttrs: LogFields = { 'connector.id': connectorId }

  const emit = (
    level: 'Debug' | 'Info' | 'Warning' | 'Error',
    msg: string,
    fields?: LogFields,
  ) => {
    const attrs = { ...baseAttrs, ...fields }
    const effect =
      level === 'Debug' ? Effect.logDebug(msg) :
      level === 'Info' ? Effect.logInfo(msg) :
      level === 'Warning' ? Effect.logWarning(msg) :
      Effect.logError(msg)
    Effect.runFork(effect.pipe(Effect.annotateLogs(attrs)))
  }

  return {
    debug(msg, fields) { emit('Debug', msg, fields) },
    info(msg, fields) { emit('Info', msg, fields) },
    warn(msg, fields) { emit('Warning', msg, fields) },
    error(msg, fields) { emit('Error', msg, fields) },

    async span<T>(
      name: string,
      fn: () => Promise<T>,
      opts?: { attributes?: LogFields },
    ): Promise<T> {
      const attrs = { ...baseAttrs, ...opts?.attributes }
      return Effect.runPromise(
        Effect.tryPromise({
          try: fn,
          catch: e => e,
        }).pipe(
          Effect.withSpan(`connector.${name}`, { attributes: attrs }),
        ),
      )
    },
  }
}
```

- [ ] **Step 8.3: Create barrel `capabilities/index.ts`**

`packages/core/src/connectors/capabilities/index.ts`:

```typescript
export { makeFetchCapability } from './fetch-impl.js'
export { makeChromeCookiesCapability } from './cookies-chrome.js'
export { makeLogCapabilityFor } from './log-impl.js'
```

- [ ] **Step 8.4: Build and verify**

Run:
```bash
pnpm --filter @spool/core build
```

Expected: success.

- [ ] **Step 8.5: Commit**

```bash
git add packages/core/src/connectors/capabilities/
git commit -m "feat(connectors): add fetch and log capability implementations

makeFetchCapability wraps an externally-supplied fetch (production uses
Electron's proxy-aware net.fetch). makeLogCapabilityFor bridges the plugin
log API to Effect.log* and Effect.withSpan with connector.id tagged as a
log attribute. Plugin boundary stays Promise-based.

Part of Stage D (SDK split)."
```

---

## Phase 4 — Twitter Plugin Migration

### Task 9: Create `packages/connectors/twitter-bookmarks/` package skeleton

**Files:**
- Create: `packages/connectors/twitter-bookmarks/package.json`
- Create: `packages/connectors/twitter-bookmarks/tsconfig.json`
- Create: `packages/connectors/twitter-bookmarks/src/index.ts` (stub)
- Create: `packages/connectors/twitter-bookmarks/.npmignore`

- [ ] **Step 9.1: Create `package.json`**

`packages/connectors/twitter-bookmarks/package.json`:

```json
{
  "name": "@spool-lab/connector-twitter-bookmarks",
  "version": "0.1.0",
  "description": "Your saved tweets on X (Twitter Bookmarks) for Spool",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist"
  ],
  "keywords": [
    "spool-connector"
  ],
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "prepack": "pnpm run build"
  },
  "peerDependencies": {
    "@spool/connector-sdk": "workspace:^"
  },
  "devDependencies": {
    "@spool/connector-sdk": "workspace:^",
    "@types/node": "^22.15.3",
    "typescript": "^5.7.3"
  },
  "spool": {
    "type": "connector",
    "id": "twitter-bookmarks",
    "platform": "twitter",
    "label": "X Bookmarks",
    "description": "Your saved tweets on X",
    "color": "#1DA1F2",
    "ephemeral": false,
    "capabilities": ["fetch", "cookies:chrome", "log"]
  }
}
```

Note: `@spool/connector-sdk` appears in both `peerDependencies` (what third-party authors use in published form) and `devDependencies` (so TypeScript resolution works in the monorepo). On publish, `workspace:^` gets rewritten to the real SDK version.

- [ ] **Step 9.2: Create `tsconfig.json`**

`packages/connectors/twitter-bookmarks/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["es2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 9.3: Create stub `src/index.ts`**

`packages/connectors/twitter-bookmarks/src/index.ts`:

```typescript
// Placeholder stub. Real implementation moves in Task 10.
import type { Connector, ConnectorCapabilities, AuthStatus, PageResult, FetchContext } from '@spool/connector-sdk'

export default class TwitterBookmarksConnector implements Connector {
  readonly id = 'twitter-bookmarks'
  readonly platform = 'twitter'
  readonly label = 'X Bookmarks'
  readonly description = 'Your saved tweets on X'
  readonly color = '#1DA1F2'
  readonly ephemeral = false

  constructor(_caps: ConnectorCapabilities) {
    // stub — Task 10 fills in
  }

  async checkAuth(): Promise<AuthStatus> {
    return { ok: false, message: 'not implemented' }
  }

  async fetchPage(_ctx: FetchContext): Promise<PageResult> {
    return { items: [], nextCursor: null }
  }
}
```

- [ ] **Step 9.4: Create `.npmignore`**

`packages/connectors/twitter-bookmarks/.npmignore`:

```
src/
tsconfig.json
*.log
node_modules/
```

- [ ] **Step 9.5: Install workspace dependency**

Run:
```bash
pnpm install
```

Expected: pnpm picks up the new workspace package, symlinks `@spool/connector-sdk` into `packages/connectors/twitter-bookmarks/node_modules/`.

- [ ] **Step 9.6: Build the stub**

Run:
```bash
pnpm --filter @spool-lab/connector-twitter-bookmarks build
```

Expected: `packages/connectors/twitter-bookmarks/dist/index.js` + `index.d.ts` exist.

- [ ] **Step 9.7: Commit**

```bash
git add packages/connectors/twitter-bookmarks/ pnpm-lock.yaml
git commit -m "feat(twitter-bookmarks): scaffold plugin workspace package

Empty stub. Real implementation migrates from packages/core/ in Task 10.
Manifest declares spool.type=connector, capabilities=[fetch, cookies:chrome, log].

Part of Stage D (SDK split)."
```

---

### Task 10: Migrate `TwitterBookmarksConnector` to capability injection

**Files:**
- Modify: `packages/connectors/twitter-bookmarks/src/index.ts`
- Create: `packages/connectors/twitter-bookmarks/src/graphql-fetch.ts` (moved + rewritten)
- Delete: `packages/core/src/connectors/twitter-bookmarks/` entire directory

- [ ] **Step 10.1: Move `graphql-fetch.ts` and rewrite for signal + capabilities**

Create `packages/connectors/twitter-bookmarks/src/graphql-fetch.ts`. Copy the bulk of the existing `packages/core/src/connectors/twitter-bookmarks/graphql-fetch.ts` (the X bearer token, query ID, features object, `buildUrl`, `buildHeaders`, `parseBookmarksResponse`, `convertTweetToItem` — all the Twitter-specific logic). The signature of `fetchBookmarkPage` changes to accept a `fetchFn` and `signal`:

```typescript
import type { FetchCapability, CapturedItem } from '@spool/connector-sdk'
import { SyncError, SyncErrorCode, abortableSleep } from '@spool/connector-sdk'

// ── Constants ───────────────────────────────────────────────────────────────

const X_PUBLIC_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

const BOOKMARKS_QUERY_ID = 'Z9GWmP0kP2dajyckAaDUBw'
const BOOKMARKS_OPERATION = 'Bookmarks'

const GRAPHQL_FEATURES = {
  // ... (copy verbatim from existing file)
}

// ── URL & Headers ───────────────────────────────────────────────────────────

function buildUrl(cursor?: string): string {
  // ... (copy verbatim)
}

function buildHeaders(csrfToken: string, cookieHeader?: string): Record<string, string> {
  // ... (copy verbatim)
}

// ── Response Parsing ────────────────────────────────────────────────────────

interface BookmarkPageResult {
  items: CapturedItem[]
  nextCursor: string | null
}

function convertTweetToItem(tweetResult: any, now: string): CapturedItem | null {
  // ... (copy verbatim)
}

export function parseBookmarksResponse(json: any, now?: string): BookmarkPageResult {
  // ... (copy verbatim)
}

// ── Fetch with Retry ────────────────────────────────────────────────────────

export async function fetchBookmarkPage(
  csrfToken: string,
  cursor: string | null,
  opts: {
    cookieHeader: string
    fetch: FetchCapability
    signal: AbortSignal
  },
): Promise<BookmarkPageResult> {
  const { cookieHeader, fetch: fetchFn, signal } = opts
  let lastError: Error | undefined

  for (let attempt = 0; attempt < 4; attempt++) {
    if (signal.aborted) {
      throw new SyncError(SyncErrorCode.SYNC_CANCELLED, 'Sync cancelled')
    }

    let response: Response
    try {
      response = await fetchFn(
        buildUrl(cursor ?? undefined),
        { headers: buildHeaders(csrfToken, cookieHeader), signal },
      )
    } catch (err) {
      if (signal.aborted) {
        throw new SyncError(SyncErrorCode.SYNC_CANCELLED, 'Sync cancelled')
      }
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('ENOTFOUND') || message.includes('ENETUNREACH')) {
        throw new SyncError(SyncErrorCode.NETWORK_OFFLINE, message, err)
      }
      if (message.includes('ETIMEDOUT') || message.includes('timeout')) {
        throw new SyncError(SyncErrorCode.NETWORK_TIMEOUT, message, err)
      }
      throw new SyncError(SyncErrorCode.CONNECTOR_ERROR, message, err)
    }

    if (response.status === 429) {
      const waitSec = Math.min(15 * Math.pow(2, attempt), 120)
      lastError = new Error(`Rate limited (429) on attempt ${attempt + 1}`)
      await abortableSleep(waitSec * 1000, signal)
      continue
    }

    if (response.status >= 500) {
      lastError = new Error(`Server error (${response.status}) on attempt ${attempt + 1}`)
      await abortableSleep(5000 * (attempt + 1), signal)
      continue
    }

    if (response.status === 401 || response.status === 403) {
      throw new SyncError(
        SyncErrorCode.AUTH_SESSION_EXPIRED,
        `X API returned ${response.status}. Your session may have expired.`,
      )
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new SyncError(
        SyncErrorCode.API_UNEXPECTED_STATUS,
        `X GraphQL API returned ${response.status}: ${text.slice(0, 300)}`,
      )
    }

    let json: unknown
    try {
      json = await response.json()
    } catch (err) {
      throw new SyncError(
        SyncErrorCode.API_PARSE_ERROR,
        'Failed to parse X GraphQL response as JSON',
        err,
      )
    }

    try {
      return parseBookmarksResponse(json)
    } catch (err) {
      throw new SyncError(
        SyncErrorCode.API_PARSE_ERROR,
        `Failed to parse bookmarks from GraphQL response: ${err instanceof Error ? err.message : String(err)}`,
        err,
      )
    }
  }

  if (lastError?.message.includes('429')) {
    throw new SyncError(SyncErrorCode.API_RATE_LIMITED, 'Rate limited after 4 retry attempts.')
  }
  throw new SyncError(SyncErrorCode.API_SERVER_ERROR, 'Server errors after 4 retry attempts.')
}
```

**Key differences from the old file**:
- `opts` now has `fetch: FetchCapability` + `signal: AbortSignal` (mandatory, not optional)
- `new Promise(r => setTimeout(r, ...))` → `abortableSleep(ms, signal)` at both retry sites
- Early `signal.aborted` check at top of loop and after fetch errors
- `fetchFn` is passed `{ signal }` in init so native fetch cancellation also fires
- Imports `SyncError`, `SyncErrorCode`, `abortableSleep` from `@spool/connector-sdk` (not relative `../types.js`)

- [ ] **Step 10.2: Rewrite plugin `src/index.ts`**

`packages/connectors/twitter-bookmarks/src/index.ts`:

```typescript
import type {
  Connector,
  ConnectorCapabilities,
  AuthStatus,
  PageResult,
  FetchContext,
  Cookie,
} from '@spool/connector-sdk'
import { SyncError, SyncErrorCode } from '@spool/connector-sdk'
import { fetchBookmarkPage } from './graphql-fetch.js'

interface TwitterAuth {
  csrfToken: string
  cookieHeader: string
}

export default class TwitterBookmarksConnector implements Connector {
  readonly id = 'twitter-bookmarks'
  readonly platform = 'twitter'
  readonly label = 'X Bookmarks'
  readonly description = 'Your saved tweets on X'
  readonly color = '#1DA1F2'
  readonly ephemeral = false

  private cachedAuth: TwitterAuth | null = null

  constructor(private readonly caps: ConnectorCapabilities) {}

  async checkAuth(): Promise<AuthStatus> {
    try {
      await this.readAuth()
      return { ok: true }
    } catch (err) {
      if (err instanceof SyncError) {
        return {
          ok: false,
          error: err.code,
          message: err.message,
          hint: err.message,
        }
      }
      return {
        ok: false,
        error: SyncErrorCode.AUTH_UNKNOWN,
        message: err instanceof Error ? err.message : String(err),
        hint: 'Check that Chrome is installed and you are logged into X.',
      }
    }
  }

  async fetchPage(ctx: FetchContext): Promise<PageResult> {
    // Re-read auth each sync cycle (cookies may have expired). Cache within
    // a single sync cycle to avoid hitting the cookie store on every page.
    if (!this.cachedAuth) {
      this.cachedAuth = await this.readAuth()
    }

    const result = await this.caps.log.span(
      'fetchPage',
      () => fetchBookmarkPage(this.cachedAuth!.csrfToken, ctx.cursor, {
        cookieHeader: this.cachedAuth!.cookieHeader,
        fetch: this.caps.fetch,
        signal: ctx.signal,
      }),
      { attributes: { 'twitter.phase': ctx.phase, 'twitter.cursor': ctx.cursor ?? 'initial' } },
    )

    return { items: result.items, nextCursor: result.nextCursor }
  }

  /** Read ct0 and auth_token cookies from Chrome for x.com. */
  private async readAuth(): Promise<TwitterAuth> {
    const cookies = await this.caps.cookies.get({
      browser: 'chrome',
      url: 'https://x.com',
    })

    const ct0 = cookies.find(c => c.name === 'ct0')
    const authToken = cookies.find(c => c.name === 'auth_token')

    if (!ct0) {
      // Fallback: try twitter.com domain
      const twitterCookies = await this.caps.cookies.get({
        browser: 'chrome',
        url: 'https://twitter.com',
      })
      const ct0Fallback = twitterCookies.find(c => c.name === 'ct0')
      const authTokenFallback = twitterCookies.find(c => c.name === 'auth_token')
      if (!ct0Fallback) {
        throw new SyncError(
          SyncErrorCode.AUTH_NOT_LOGGED_IN,
          'No ct0 CSRF cookie found for x.com or twitter.com in Chrome. Log into X in Chrome and retry.',
        )
      }
      const parts = [`ct0=${ct0Fallback.value}`]
      if (authTokenFallback) parts.push(`auth_token=${authTokenFallback.value}`)
      return { csrfToken: ct0Fallback.value, cookieHeader: parts.join('; ') }
    }

    const parts = [`ct0=${ct0.value}`]
    if (authToken) parts.push(`auth_token=${authToken.value}`)
    return { csrfToken: ct0.value, cookieHeader: parts.join('; ') }
  }
}
```

**Key changes from the old connector**:
- Constructor takes `ConnectorCapabilities` instead of `{ fetchFn, chromeUserDataDir, chromeProfileDirectory }`
- `readAuth()` calls `caps.cookies.get(...)` and filters for `ct0` + `auth_token`, building the cookie header in-plugin (Chrome implementation details stay in the capability implementation)
- `fetchPage` wraps the fetch in `caps.log.span('fetchPage', ...)` for tracing
- No more `clearCookieCache()` public method — the cache clearing happens via engine's per-cycle lifecycle (not currently enforced but acceptable for v1 since Twitter's cookies are re-read on each `fetchPage` call anyway if `cachedAuth` is reset externally)

- [ ] **Step 10.3: Delete the old twitter-bookmarks code from `@spool/core`**

```bash
git rm -r packages/core/src/connectors/twitter-bookmarks/
```

The entire directory goes — `index.ts`, `graphql-fetch.ts`. (`chrome-cookies.ts` was already moved in Task 7.)

- [ ] **Step 10.4: Clean up `cookies-chrome.ts` transitional exports**

Remove the transitional exports added in Step 7.3 from `packages/core/src/connectors/capabilities/cookies-chrome.ts`:

- Remove the `export` on `extractChromeXCookies`, `detectChromeUserDataDir`, `ChromeCookieResult`
- They become private helpers used only internally by `makeChromeCookiesCapability`

- [ ] **Step 10.5: Build both plugin and core**

Run:
```bash
pnpm --filter @spool-lab/connector-twitter-bookmarks build
pnpm --filter @spool/core build
```

Expected: both succeed. `@spool/core` has zero references to `TwitterBookmarksConnector` now.

Verify with:
```bash
grep -r "TwitterBookmarksConnector" packages/core/src/ && echo "FAIL: references remain" || echo "OK: no references"
```

Expected: `OK: no references`.

- [ ] **Step 10.6: Check main/index.ts is currently broken**

Run:
```bash
pnpm --filter @spool/app typecheck 2>&1 | head -20
```

Expected: TypeScript errors in `packages/app/src/main/index.ts` about `TwitterBookmarksConnector` not being exported. This is expected — Task 12 fixes it. Do NOT try to fix it yet; we want the broken state to be observed so we know the old code path is gone.

- [ ] **Step 10.7: Run core tests**

Run:
```bash
pnpm --filter @spool/core test
```

Expected: all green. No test in `@spool/core` directly imports `TwitterBookmarksConnector`; the engine tests use `test-helpers.ts`'s `fakeConnector`.

If a test does fail due to Twitter removal, investigate whether that test actually needed Twitter or if it's a missing abstraction.

- [ ] **Step 10.8: Commit**

```bash
git add packages/connectors/twitter-bookmarks/src/ packages/core/src/connectors/capabilities/cookies-chrome.ts
git rm -r packages/core/src/connectors/twitter-bookmarks/
git commit -m "refactor(twitter-bookmarks): migrate to capability injection plugin

Move TwitterBookmarksConnector from packages/core/src/connectors/twitter-bookmarks/
to packages/connectors/twitter-bookmarks/ as an independent workspace package
consuming @spool/connector-sdk via peerDependencies.

Constructor now takes ConnectorCapabilities (fetch + cookies + log) instead
of raw injection options. graphql-fetch.ts retry backoff uses abortableSleep
with ctx.signal for cancellation propagation. Cookie extraction uses
caps.cookies.get() — plugin no longer touches Chrome keychain/SQLite internals.

@spool/core has zero Twitter references after this commit. packages/app main
wiring temporarily broken — fixed in Task 12.

Part of Stage D (SDK split)."
```

---

### Task 11: Phantom independence check CI script

**Files:**
- Create: `scripts/phantom-independence-check.sh`
- Modify: `package.json` (root) — add a script entry

- [ ] **Step 11.1: Write the script**

`scripts/phantom-independence-check.sh`:

```bash
#!/usr/bin/env bash
#
# Verify that a first-party connector plugin tarball can be `require`-d
# in isolation from the monorepo — no workspace-relative paths, no hidden
# imports. This is the split-readiness gate.
#
# Usage:
#   ./scripts/phantom-independence-check.sh <plugin-name>
# e.g.
#   ./scripts/phantom-independence-check.sh twitter-bookmarks
#
set -euo pipefail

PLUGIN="${1:-}"
if [[ -z "$PLUGIN" ]]; then
  echo "usage: $0 <plugin-name>" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/packages/connectors/$PLUGIN"
FULL_NAME="@spool-lab/connector-$PLUGIN"

if [[ ! -d "$PLUGIN_DIR" ]]; then
  echo "plugin dir not found: $PLUGIN_DIR" >&2
  exit 2
fi

# Build fresh
echo "==> Building $FULL_NAME"
(cd "$REPO_ROOT" && pnpm --filter "$FULL_NAME" build)

# Pack
TMPDIR="$(mktemp -d -t spool-phantom-check-XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT

echo "==> Packing $FULL_NAME to $TMPDIR"
(cd "$PLUGIN_DIR" && pnpm pack --pack-destination "$TMPDIR")

TARBALL="$(ls "$TMPDIR"/spool-lab-connector-"$PLUGIN"-*.tgz)"
if [[ -z "$TARBALL" ]]; then
  echo "tarball not found after pack" >&2
  exit 1
fi

# Also pack the SDK so the plugin can install it via file: reference
SDK_TARBALL="$TMPDIR/sdk.tgz"
(cd "$REPO_ROOT/packages/connector-sdk" && pnpm pack --pack-destination "$TMPDIR" \
  && mv "$TMPDIR"/spool-connector-sdk-*.tgz "$SDK_TARBALL")

# Create isolated install dir
INSTALL_DIR="$TMPDIR/install-test"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Minimal package.json that depends on both the plugin and SDK
cat > package.json <<EOF
{
  "name": "phantom-test",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "$FULL_NAME": "file:$TARBALL",
    "@spool/connector-sdk": "file:$SDK_TARBALL"
  }
}
EOF

echo "==> Installing plugin tarball in isolated environment"
npm install --silent --no-audit --no-fund

echo "==> Requiring plugin entry point"
node --input-type=module -e "
import mod from '$FULL_NAME'
if (!mod) { console.error('ERROR: default export is falsy'); process.exit(1) }
if (typeof mod !== 'function' && typeof mod.default !== 'function') {
  console.error('ERROR: default export is not a class/constructor')
  process.exit(1)
}
console.log('OK: default export loaded and is constructor-shaped')
"

echo "==> Phantom independence check PASSED for $FULL_NAME"
```

- [ ] **Step 11.2: Make executable**

```bash
chmod +x scripts/phantom-independence-check.sh
```

- [ ] **Step 11.3: Add root package.json script**

Add to the top-level `package.json`'s `"scripts"` section (if the file has one; if not, create minimal scripts block):

```json
{
  "scripts": {
    "check:phantom-independence": "scripts/phantom-independence-check.sh"
  }
}
```

- [ ] **Step 11.4: Run the check against Twitter plugin**

Run:
```bash
./scripts/phantom-independence-check.sh twitter-bookmarks
```

Expected: script completes with `Phantom independence check PASSED for @spool-lab/connector-twitter-bookmarks`. If it fails, the error typically indicates a missing export, hidden workspace import, or an issue with the SDK tarball shape.

Common failure + fix: if `npm install` rejects `file:` installs from different dirs, update the script to copy tarballs into `INSTALL_DIR` first and reference them by basename.

- [ ] **Step 11.5: Commit**

```bash
git add scripts/phantom-independence-check.sh package.json
git commit -m "chore(ci): add phantom independence check script

Builds a plugin, packs it, installs the tarball in an isolated /tmp dir
outside the workspace, and tries to require the default export. This
catches any hidden workspace-relative paths or missing exports that
would break after the future split to spool-lab/connectors repository.

Part of Stage D (SDK split, future split readiness)."
```

---

## Phase 5 — Loader and Bundle Extraction

### Task 12: Install `tar` and `semver` dependencies

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 12.1: Add runtime deps**

Run:
```bash
pnpm --filter @spool/core add tar semver
pnpm --filter @spool/core add -D @types/semver
```

**Note on `tar` types**: `tar` ships its own types; `@types/tar` is not needed and may conflict.

- [ ] **Step 12.2: Verify package.json**

`packages/core/package.json` should now have:

```json
  "dependencies": {
    "@spool/connector-sdk": "workspace:^",
    "better-sqlite3": "^11.10.0",
    "chokidar": "^4.0.3",
    "effect": "^3.21.0",
    "semver": "^7.6.0",
    "tar": "^7.4.0"
  },
```

Versions may differ; use what pnpm resolves.

- [ ] **Step 12.3: Build to verify**

Run:
```bash
pnpm --filter @spool/core build
```

Expected: success.

- [ ] **Step 12.4: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml
git commit -m "chore(core): add tar and semver dependencies

Required by bundle-extract.ts and loader.ts for first-run bundle
mechanism (Stage D Task 13, 14).

Part of Stage D (SDK split)."
```

---

### Task 13: Implement `bundle-extract.ts`

**Files:**
- Create: `packages/core/src/connectors/bundle-extract.ts`
- Create: `packages/core/src/connectors/bundle-extract.test.ts`

- [ ] **Step 13.1: Write failing test**

`packages/core/src/connectors/bundle-extract.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'
import { extractBundledConnectorsIfNeeded } from './bundle-extract.js'

function makeTarballFixture(destDir: string, pkgName: string, version: string, extraFiles: Record<string, string> = {}): string {
  const stagingDir = mkdtempSync(join(tmpdir(), 'bundle-fixture-'))
  const packageDir = join(stagingDir, 'package')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name: pkgName,
      version,
      main: './dist/index.js',
      spool: { type: 'connector', id: pkgName.split('/').pop() },
    }),
  )
  const distDir = join(packageDir, 'dist')
  mkdirSync(distDir, { recursive: true })
  writeFileSync(join(distDir, 'index.js'), 'export default class {}')
  for (const [name, content] of Object.entries(extraFiles)) {
    writeFileSync(join(packageDir, name), content)
  }
  const tarballName = `${pkgName.replace('@', '').replace('/', '-')}-${version}.tgz`
  const tarballPath = join(destDir, tarballName)
  tar.create(
    { file: tarballPath, cwd: stagingDir, gzip: true, sync: true },
    ['package'],
  )
  rmSync(stagingDir, { recursive: true, force: true })
  return tarballPath
}

describe('extractBundledConnectorsIfNeeded', () => {
  let bundledDir: string
  let connectorsDir: string

  beforeEach(() => {
    bundledDir = mkdtempSync(join(tmpdir(), 'bundled-'))
    connectorsDir = mkdtempSync(join(tmpdir(), 'connectors-'))
  })

  it('extracts a bundled tarball when the target dir is empty', async () => {
    makeTarballFixture(bundledDir, '@spool-lab/connector-test', '1.0.0')
    const log = { info: () => {}, warn: () => {}, error: () => {} }

    await extractBundledConnectorsIfNeeded({ bundledDir, connectorsDir, log })

    const installedPath = join(
      connectorsDir, 'node_modules', '@spool-lab', 'connector-test', 'package.json',
    )
    expect(existsSync(installedPath)).toBe(true)
    const pkg = JSON.parse(readFileSync(installedPath, 'utf8'))
    expect(pkg.name).toBe('@spool-lab/connector-test')
    expect(pkg.version).toBe('1.0.0')
  })

  it('does not re-extract when installed version is equal', async () => {
    // First extraction
    makeTarballFixture(bundledDir, '@spool-lab/connector-test', '1.0.0')
    const log = { info: () => {}, warn: () => {}, error: () => {} }
    await extractBundledConnectorsIfNeeded({ bundledDir, connectorsDir, log })

    // Modify installed file to verify it's not overwritten
    const installedEntry = join(
      connectorsDir, 'node_modules', '@spool-lab', 'connector-test', 'dist', 'index.js',
    )
    writeFileSync(installedEntry, 'USER_MODIFIED')

    // Second run with same version
    await extractBundledConnectorsIfNeeded({ bundledDir, connectorsDir, log })

    expect(readFileSync(installedEntry, 'utf8')).toBe('USER_MODIFIED')
  })

  it('overwrites when bundled version is newer', async () => {
    makeTarballFixture(bundledDir, '@spool-lab/connector-test', '1.0.0')
    const log = { info: () => {}, warn: () => {}, error: () => {} }
    await extractBundledConnectorsIfNeeded({ bundledDir, connectorsDir, log })

    // Replace with newer version
    rmSync(join(bundledDir), { recursive: true, force: true })
    mkdirSync(bundledDir, { recursive: true })
    makeTarballFixture(bundledDir, '@spool-lab/connector-test', '2.0.0')

    await extractBundledConnectorsIfNeeded({ bundledDir, connectorsDir, log })

    const installedPath = join(
      connectorsDir, 'node_modules', '@spool-lab', 'connector-test', 'package.json',
    )
    const pkg = JSON.parse(readFileSync(installedPath, 'utf8'))
    expect(pkg.version).toBe('2.0.0')
  })

  it('does not overwrite when installed version is newer than bundle', async () => {
    // Install 2.0.0
    makeTarballFixture(bundledDir, '@spool-lab/connector-test', '2.0.0')
    const log = { info: () => {}, warn: () => {}, error: () => {} }
    await extractBundledConnectorsIfNeeded({ bundledDir, connectorsDir, log })

    // Replace bundle with older 1.0.0
    rmSync(bundledDir, { recursive: true, force: true })
    mkdirSync(bundledDir, { recursive: true })
    makeTarballFixture(bundledDir, '@spool-lab/connector-test', '1.0.0')

    await extractBundledConnectorsIfNeeded({ bundledDir, connectorsDir, log })

    const installedPath = join(
      connectorsDir, 'node_modules', '@spool-lab', 'connector-test', 'package.json',
    )
    const pkg = JSON.parse(readFileSync(installedPath, 'utf8'))
    expect(pkg.version).toBe('2.0.0') // not downgraded
  })

  it('respects .do-not-restore list', async () => {
    makeTarballFixture(bundledDir, '@spool-lab/connector-test', '1.0.0')
    // Write the skip list
    writeFileSync(
      join(connectorsDir, '.do-not-restore'),
      '@spool-lab/connector-test\n',
    )
    const log = { info: () => {}, warn: () => {}, error: () => {} }

    await extractBundledConnectorsIfNeeded({ bundledDir, connectorsDir, log })

    const installedPath = join(
      connectorsDir, 'node_modules', '@spool-lab', 'connector-test', 'package.json',
    )
    expect(existsSync(installedPath)).toBe(false)
  })

  it('handles missing bundledDir gracefully', async () => {
    const log = { info: () => {}, warn: () => {}, error: () => {} }
    await extractBundledConnectorsIfNeeded({
      bundledDir: join(bundledDir, 'nonexistent'),
      connectorsDir,
      log,
    })
    // No error, no files
    expect(existsSync(join(connectorsDir, 'node_modules'))).toBe(false)
  })
})
```

- [ ] **Step 13.2: Run test — expect FAIL**

Run:
```bash
pnpm --filter @spool/core test -- bundle-extract
```

Expected: FAIL with "cannot find module" — `bundle-extract.ts` doesn't exist yet.

- [ ] **Step 13.3: Implement `bundle-extract.ts`**

`packages/core/src/connectors/bundle-extract.ts`:

```typescript
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as tar from 'tar'
import semver from 'semver'

export interface BundleLogger {
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
}

export interface BundleExtractOpts {
  /** Directory containing .tgz files to extract (e.g. process.resourcesPath/bundled-connectors). */
  bundledDir: string
  /** User's connector install directory (e.g. ~/.spool/connectors). */
  connectorsDir: string
  /** Logger for diagnostics. */
  log: BundleLogger
}

export interface BundleReport {
  extracted: string[]
  skipped: string[]
  errors: Array<{ tarball: string; error: string }>
}

/**
 * Extract any bundled connector tarballs into ~/.spool/connectors/node_modules/
 * on first launch (or when a newer version is shipped with the app). Respects
 * the .do-not-restore opt-out list and skips downgrades.
 *
 * Uses the `tar` library for zero-dependency, network-free extraction.
 */
export async function extractBundledConnectorsIfNeeded(
  opts: BundleExtractOpts,
): Promise<BundleReport> {
  const { bundledDir, connectorsDir, log } = opts
  const report: BundleReport = { extracted: [], skipped: [], errors: [] }

  if (!existsSync(bundledDir)) {
    log.info('no bundled connectors directory, skipping extraction', { bundledDir })
    return report
  }

  const skip = readDoNotRestore(connectorsDir)

  const tarballs = readdirSync(bundledDir).filter(f => f.endsWith('.tgz'))
  if (tarballs.length === 0) {
    log.info('no bundled tarballs found', { bundledDir })
    return report
  }

  for (const tgzFilename of tarballs) {
    const tgzPath = join(bundledDir, tgzFilename)
    try {
      const manifest = await peekTarballManifest(tgzPath)
      const { name, version: bundledVersion } = manifest

      if (skip.has(name)) {
        log.info('skip bundle (in .do-not-restore)', { name })
        report.skipped.push(name)
        continue
      }

      const installedPkgJsonPath = join(
        connectorsDir, 'node_modules', ...nameToPath(name), 'package.json',
      )
      const installedVersion = readVersionIfExists(installedPkgJsonPath)

      if (installedVersion && semver.gte(installedVersion, bundledVersion)) {
        log.info('bundle up-to-date, skip', { name, installed: installedVersion, bundled: bundledVersion })
        report.skipped.push(name)
        continue
      }

      const destDir = join(connectorsDir, 'node_modules', ...nameToPath(name))
      mkdirSync(destDir, { recursive: true })
      await tar.x({
        file: tgzPath,
        cwd: destDir,
        strip: 1, // strip top-level "package/" directory
      })
      log.info('extracted bundled connector', { name, version: bundledVersion })
      report.extracted.push(name)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('failed to extract bundled tarball', { tarball: tgzFilename, error: message })
      report.errors.push({ tarball: tgzFilename, error: message })
    }
  }

  return report
}

/**
 * Convert an npm package name ("@scope/name" or "name") into path segments
 * for node_modules layout (["@scope", "name"] or ["name"]).
 */
function nameToPath(name: string): string[] {
  return name.startsWith('@') ? name.split('/') : [name]
}

/**
 * Read package.json from inside a tarball without full extraction.
 * Uses tar.list() with an onentry callback to read just one file.
 */
async function peekTarballManifest(
  tarballPath: string,
): Promise<{ name: string; version: string }> {
  let pkgJsonContent = ''
  await tar.list({
    file: tarballPath,
    onentry: (entry: any) => {
      // npm tarballs wrap contents in "package/"
      if (entry.path === 'package/package.json') {
        const chunks: Buffer[] = []
        entry.on('data', (c: Buffer) => chunks.push(c))
        entry.on('end', () => {
          pkgJsonContent = Buffer.concat(chunks).toString('utf8')
        })
      } else {
        entry.resume()
      }
    },
  })

  if (!pkgJsonContent) {
    throw new Error(`no package.json found inside tarball: ${tarballPath}`)
  }
  const json = JSON.parse(pkgJsonContent)
  if (typeof json.name !== 'string' || typeof json.version !== 'string') {
    throw new Error(`invalid package.json in tarball: ${tarballPath}`)
  }
  return { name: json.name, version: json.version }
}

function readVersionIfExists(pkgJsonPath: string): string | null {
  if (!existsSync(pkgJsonPath)) return null
  try {
    const json = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
    return typeof json.version === 'string' ? json.version : null
  } catch {
    return null
  }
}

function readDoNotRestore(connectorsDir: string): Set<string> {
  const filePath = join(connectorsDir, '.do-not-restore')
  if (!existsSync(filePath)) return new Set()
  try {
    const lines = readFileSync(filePath, 'utf8').split('\n')
    return new Set(lines.map(l => l.trim()).filter(l => l && !l.startsWith('#')))
  } catch {
    return new Set()
  }
}
```

- [ ] **Step 13.4: Run test — expect PASS**

Run:
```bash
pnpm --filter @spool/core test -- bundle-extract
```

Expected: all 6 test cases green. If `peekTarballManifest` has issues reading the tar stream correctly (the `entry.on('data')` pattern can be finicky with tar v7), an alternative implementation using `tar.list` with sync=false and an internal Promise adapter may be needed — validate by running the test.

- [ ] **Step 13.5: Commit**

```bash
git add packages/core/src/connectors/bundle-extract.ts packages/core/src/connectors/bundle-extract.test.ts
git commit -m "feat(connectors): add first-run bundle extraction

Extracts bundled connector tarballs from app resources into
~/.spool/connectors/node_modules/ on first launch. Uses semver to skip
downgrades, respects .do-not-restore opt-out list, handles missing
directories gracefully. Pure tar library + fs, no network or npm CLI.

Part of Stage D (SDK split)."
```

---

### Task 14: Implement `loader.ts`

**Files:**
- Create: `packages/core/src/connectors/loader.ts`
- Create: `packages/core/src/connectors/loader.test.ts`

- [ ] **Step 14.1: Write failing tests**

`packages/core/src/connectors/loader.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConnectors, STAGE_D_FIRST_PARTY_ALLOWLIST } from './loader.js'
import { ConnectorRegistry } from './registry.js'
import type { Connector } from '@spool/connector-sdk'

function writePkg(nodeModulesDir: string, name: string, manifest: object, entrySource: string) {
  const segments = name.startsWith('@') ? name.split('/') : [name]
  const pkgDir = join(nodeModulesDir, ...segments)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      type: 'module',
      main: './index.js',
      ...manifest,
    }),
  )
  writeFileSync(join(pkgDir, 'index.js'), entrySource)
}

function fakeCapabilityImpls() {
  return {
    fetch: globalThis.fetch,
    cookies: { get: async () => [] },
    logFor: () => ({
      debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
      span: async (_name: string, fn: () => Promise<any>) => fn(),
    }),
  }
}

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: function() { return this },
  }
}

describe('loadConnectors', () => {
  let connectorsDir: string
  let bundledDir: string

  beforeEach(() => {
    connectorsDir = mkdtempSync(join(tmpdir(), 'loader-connectors-'))
    bundledDir = mkdtempSync(join(tmpdir(), 'loader-bundled-'))
    // Force the allowlist for these tests to include our fixture
    STAGE_D_FIRST_PARTY_ALLOWLIST.clear()
    STAGE_D_FIRST_PARTY_ALLOWLIST.add('@spool-lab/connector-twitter-bookmarks')
    STAGE_D_FIRST_PARTY_ALLOWLIST.add('@spool-lab/connector-typeless')
    STAGE_D_FIRST_PARTY_ALLOWLIST.add('@spool-lab/connector-test')
  })

  it('loads a connector that declares spool.type === "connector"', async () => {
    const registry = new ConnectorRegistry()
    writePkg(
      join(connectorsDir, 'node_modules'),
      '@spool-lab/connector-test',
      {
        spool: {
          type: 'connector',
          id: 'test',
          platform: 'test',
          label: 'Test',
          description: 'Test',
          color: '#000',
          ephemeral: false,
          capabilities: ['log'],
        },
      },
      `export default class TestConn {
        id = 'test'; platform = 'test'; label = 'Test';
        description = 'Test'; color = '#000'; ephemeral = false;
        constructor(caps) { this.caps = caps }
        async checkAuth() { return { ok: true } }
        async fetchPage() { return { items: [], nextCursor: null } }
      }`,
    )

    const report = await loadConnectors({
      bundledConnectorsDir: bundledDir,
      connectorsDir,
      capabilityImpls: fakeCapabilityImpls(),
      registry,
      log: silentLogger(),
    })

    expect(report.loadResults.find(r => r.name === '@spool-lab/connector-test')?.status)
      .toBe('loaded')
    expect(registry.list().length).toBe(1)
  })

  it('skips packages without spool.type === "connector"', async () => {
    const registry = new ConnectorRegistry()
    writePkg(
      join(connectorsDir, 'node_modules'),
      'some-random-pkg',
      { description: 'not a connector' },
      `export default {}`,
    )

    const report = await loadConnectors({
      bundledConnectorsDir: bundledDir,
      connectorsDir,
      capabilityImpls: fakeCapabilityImpls(),
      registry,
      log: silentLogger(),
    })

    expect(report.loadResults.length).toBe(0)
    expect(registry.list().length).toBe(0)
  })

  it('rejects connectors with unknown capabilities', async () => {
    const registry = new ConnectorRegistry()
    writePkg(
      join(connectorsDir, 'node_modules'),
      '@spool-lab/connector-test',
      {
        spool: {
          type: 'connector', id: 'test', platform: 'test', label: 'Test',
          description: 'Test', color: '#000', ephemeral: false,
          capabilities: ['fetch', 'filesystem:read'], // unknown
        },
      },
      `export default class {}`,
    )

    const log = silentLogger()
    await loadConnectors({
      bundledConnectorsDir: bundledDir,
      connectorsDir,
      capabilityImpls: fakeCapabilityImpls(),
      registry,
      log,
    })

    // Should have logged an error about unknown capability
    const errorCalls = (log.error as any).mock.calls
    expect(errorCalls.some((c: any[]) =>
      String(c[1]?.error ?? '').includes('filesystem:read')
    )).toBe(true)
  })

  it('skips packages not in the first-party allowlist', async () => {
    const registry = new ConnectorRegistry()
    STAGE_D_FIRST_PARTY_ALLOWLIST.clear() // empty it for this test
    writePkg(
      join(connectorsDir, 'node_modules'),
      '@spool-lab/connector-test',
      {
        spool: {
          type: 'connector', id: 'test', platform: 'test', label: 'Test',
          description: 'Test', color: '#000', ephemeral: false,
          capabilities: ['log'],
        },
      },
      `export default class {}`,
    )

    const report = await loadConnectors({
      bundledConnectorsDir: bundledDir,
      connectorsDir,
      capabilityImpls: fakeCapabilityImpls(),
      registry,
      log: silentLogger(),
    })

    expect(report.loadResults.find(r => r.name === '@spool-lab/connector-test')?.status)
      .toBe('skipped')
    expect(registry.list().length).toBe(0)
  })

  it('isolates crashes: one broken connector does not block others', async () => {
    const registry = new ConnectorRegistry()
    // Good one
    writePkg(
      join(connectorsDir, 'node_modules'),
      '@spool-lab/connector-typeless',
      {
        spool: {
          type: 'connector', id: 'typeless', platform: 'typeless',
          label: 'Typeless', description: '...', color: '#000', ephemeral: false,
          capabilities: ['log'],
        },
      },
      `export default class {
        id = 'typeless'; platform = 'typeless'; label = 'Typeless';
        description = '...'; color = '#000'; ephemeral = false;
        constructor() {}
        async checkAuth() { return { ok: true } }
        async fetchPage() { return { items: [], nextCursor: null } }
      }`,
    )
    // Bad one: throws in constructor
    writePkg(
      join(connectorsDir, 'node_modules'),
      '@spool-lab/connector-twitter-bookmarks',
      {
        spool: {
          type: 'connector', id: 'twitter-bookmarks', platform: 'twitter',
          label: 'Twitter', description: '...', color: '#000', ephemeral: false,
          capabilities: ['log'],
        },
      },
      `export default class {
        constructor() { throw new Error('boom') }
      }`,
    )

    const report = await loadConnectors({
      bundledConnectorsDir: bundledDir,
      connectorsDir,
      capabilityImpls: fakeCapabilityImpls(),
      registry,
      log: silentLogger(),
    })

    const statuses = Object.fromEntries(
      report.loadResults.map(r => [r.name, r.status]),
    )
    expect(statuses['@spool-lab/connector-typeless']).toBe('loaded')
    expect(statuses['@spool-lab/connector-twitter-bookmarks']).toBe('failed')
    expect(registry.list().length).toBe(1)
  })

  it('throws CONNECTOR_ERROR when plugin uses an undeclared capability', async () => {
    const registry = new ConnectorRegistry()
    writePkg(
      join(connectorsDir, 'node_modules'),
      '@spool-lab/connector-test',
      {
        spool: {
          type: 'connector', id: 'test', platform: 'test', label: 'Test',
          description: 'Test', color: '#000', ephemeral: false,
          capabilities: ['log'], // NOT declaring fetch
        },
      },
      `export default class {
        id = 'test'; platform = 'test'; label = 'Test';
        description = 'Test'; color = '#000'; ephemeral = false;
        constructor(caps) { this.caps = caps }
        async checkAuth() { return { ok: true } }
        async fetchPage() {
          // Try to use fetch even though we didn't declare it
          await this.caps.fetch('https://example.com')
          return { items: [], nextCursor: null }
        }
      }`,
    )

    const report = await loadConnectors({
      bundledConnectorsDir: bundledDir,
      connectorsDir,
      capabilityImpls: fakeCapabilityImpls(),
      registry,
      log: silentLogger(),
    })

    expect(report.loadResults.find(r => r.name === '@spool-lab/connector-test')?.status)
      .toBe('loaded')
    const connector = registry.list()[0]
    await expect(connector.fetchPage({ cursor: null, sinceItemId: null, phase: 'forward', signal: new AbortController().signal }))
      .rejects.toThrow(/not declared/)
  })
})
```

- [ ] **Step 14.2: Run test — expect FAIL**

Run:
```bash
pnpm --filter @spool/core test -- loader
```

Expected: FAIL with "cannot find module" — `loader.ts` doesn't exist.

- [ ] **Step 14.3: Implement `loader.ts`**

`packages/core/src/connectors/loader.ts`:

```typescript
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  Connector,
  ConnectorCapabilities,
  CookiesCapability,
  FetchCapability,
  LogCapability,
} from '@spool/connector-sdk'
import { SyncError, SyncErrorCode, KNOWN_CAPABILITIES_V1 } from '@spool/connector-sdk'
import type { ConnectorRegistry } from './registry.js'
import { extractBundledConnectorsIfNeeded, type BundleLogger, type BundleReport } from './bundle-extract.js'

// ── Hardcoded first-party allowlist (Stage D only) ─────────────────────────

/**
 * Mutable set of first-party package names that the Stage D loader will
 * actually instantiate. Stage E replaces this with a TrustStore lookup.
 *
 * Exported for tests that need to temporarily modify the allowlist.
 * Production code should not mutate this at runtime.
 */
export const STAGE_D_FIRST_PARTY_ALLOWLIST = new Set<string>([
  '@spool-lab/connector-twitter-bookmarks',
  '@spool-lab/connector-typeless',
])

// ── Types ──────────────────────────────────────────────────────────────────

export interface CapabilityImpls {
  fetch: FetchCapability
  cookies: CookiesCapability
  logFor(connectorId: string): LogCapability
}

export interface LoaderLogger extends BundleLogger {
  child?(attrs: Record<string, unknown>): LoaderLogger
}

export interface LoadDeps {
  /** Absolute path to bundled tarballs (process.resourcesPath/bundled-connectors). */
  bundledConnectorsDir: string
  /** Absolute path to user's connector install dir (~/.spool/connectors). */
  connectorsDir: string
  /** Capability implementations for injection. */
  capabilityImpls: CapabilityImpls
  /** Registry to register loaded connectors into. */
  registry: ConnectorRegistry
  /** Logger for diagnostics. */
  log: LoaderLogger
}

export type LoadResult =
  | { status: 'loaded'; name: string; version: string }
  | { status: 'failed'; name: string; error: unknown }
  | { status: 'skipped'; name: string; reason: 'not-in-allowlist' | 'bad-manifest' }

export interface LoadReport {
  bundleReport: BundleReport
  loadResults: LoadResult[]
}

interface PkgInfo {
  dir: string
  name: string
  version: string
  manifest: {
    id: string
    platform: string
    label: string
    description: string
    color: string
    ephemeral: boolean
    capabilities: string[]
  }
  main: string
}

const KNOWN_CAPS_SET = new Set<string>(KNOWN_CAPABILITIES_V1)

// ── Entry point ────────────────────────────────────────────────────────────

export async function loadConnectors(deps: LoadDeps): Promise<LoadReport> {
  const { bundledConnectorsDir, connectorsDir, log } = deps

  // Step 1: extract bundled tarballs if missing or outdated
  const bundleReport = await extractBundledConnectorsIfNeeded({
    bundledDir: bundledConnectorsDir,
    connectorsDir,
    log,
  })

  // Step 2: discover connector packages
  const discovered = discoverConnectorPackages(connectorsDir, log)

  // Step 3: load each connector
  const loadResults: LoadResult[] = []
  for (const pkg of discovered) {
    const result = await loadOneConnector(pkg, deps)
    loadResults.push(result)
  }

  return { bundleReport, loadResults }
}

// ── Discovery ──────────────────────────────────────────────────────────────

function discoverConnectorPackages(
  connectorsDir: string,
  log: LoaderLogger,
): PkgInfo[] {
  const nodeModules = join(connectorsDir, 'node_modules')
  if (!existsSync(nodeModules)) return []

  const results: PkgInfo[] = []
  let topEntries: string[]
  try {
    topEntries = readdirSync(nodeModules)
  } catch (err) {
    log.error('failed to read node_modules', { error: String(err) })
    return results
  }

  for (const entry of topEntries) {
    if (entry.startsWith('.')) continue
    const entryPath = join(nodeModules, entry)

    if (entry.startsWith('@')) {
      // Scoped: descend one level
      let scopedEntries: string[]
      try {
        scopedEntries = readdirSync(entryPath)
      } catch {
        continue
      }
      for (const sub of scopedEntries) {
        if (sub.startsWith('.')) continue
        const pkg = tryReadConnectorManifest(join(entryPath, sub), log)
        if (pkg) results.push(pkg)
      }
    } else {
      const pkg = tryReadConnectorManifest(entryPath, log)
      if (pkg) results.push(pkg)
    }
  }

  return results
}

function tryReadConnectorManifest(
  pkgDir: string,
  log: LoaderLogger,
): PkgInfo | null {
  const pkgJsonPath = join(pkgDir, 'package.json')
  if (!existsSync(pkgJsonPath)) return null

  let json: any
  try {
    json = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  } catch (err) {
    log.warn('invalid package.json', { path: pkgJsonPath, error: String(err) })
    return null
  }

  if (json?.spool?.type !== 'connector') return null

  const declared: string[] = Array.isArray(json.spool.capabilities)
    ? json.spool.capabilities
    : []

  // Validate declared capabilities against known v1 set
  const unknown = declared.filter(c => !KNOWN_CAPS_SET.has(c))
  if (unknown.length > 0) {
    log.error('unknown capability in spool.capabilities', {
      package: json.name,
      unknown,
      error: `Unknown capability "${unknown[0]}" — known v1 values: ${[...KNOWN_CAPS_SET].join(', ')}`,
    })
    return null
  }

  return {
    dir: pkgDir,
    name: String(json.name),
    version: String(json.version ?? '0.0.0'),
    manifest: {
      id: String(json.spool.id ?? ''),
      platform: String(json.spool.platform ?? ''),
      label: String(json.spool.label ?? ''),
      description: String(json.spool.description ?? ''),
      color: String(json.spool.color ?? '#888'),
      ephemeral: Boolean(json.spool.ephemeral),
      capabilities: declared,
    },
    main: String(json.main ?? 'dist/index.js'),
  }
}

// ── Load one connector ─────────────────────────────────────────────────────

async function loadOneConnector(
  pkg: PkgInfo,
  deps: LoadDeps,
): Promise<LoadResult> {
  if (!STAGE_D_FIRST_PARTY_ALLOWLIST.has(pkg.name)) {
    deps.log.info('skip non-allowlisted connector (Stage D)', { name: pkg.name })
    return { status: 'skipped', name: pkg.name, reason: 'not-in-allowlist' }
  }

  try {
    const entryPath = join(pkg.dir, pkg.main)
    if (!existsSync(entryPath)) {
      throw new Error(`entry file not found: ${entryPath}`)
    }
    const modUrl = pathToFileURL(entryPath).href
    const mod = await import(modUrl)
    const ConnectorClass =
      mod.default ??
      mod[pkg.manifest.id] ??
      (typeof mod === 'function' ? mod : null)

    if (typeof ConnectorClass !== 'function') {
      throw new Error('module does not export a connector class')
    }

    const caps = buildCapabilities(pkg.manifest.capabilities, pkg.name, deps.capabilityImpls)
    const instance: Connector = new ConnectorClass(caps)
    validateMetadataConsistency(pkg, instance)

    deps.registry.register(instance)
    deps.log.info('loaded connector', { name: pkg.name, version: pkg.version })
    return { status: 'loaded', name: pkg.name, version: pkg.version }
  } catch (err) {
    deps.log.error('failed to load connector', {
      name: pkg.name,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    return { status: 'failed', name: pkg.name, error: err }
  }
}

// ── Capability bundle construction ────────────────────────────────────────

function buildCapabilities(
  declared: string[],
  connectorId: string,
  impls: CapabilityImpls,
): ConnectorCapabilities {
  return {
    fetch: declared.includes('fetch')
      ? impls.fetch
      : (undefinedCapability('fetch') as FetchCapability),
    cookies: declared.includes('cookies:chrome')
      ? impls.cookies
      : (undefinedCapability('cookies:chrome') as CookiesCapability),
    log: declared.includes('log')
      ? impls.logFor(connectorId)
      : (undefinedCapability('log') as LogCapability),
  }
}

/**
 * Return a Proxy that throws on any method access. Used to fill in capability
 * slots that the connector did NOT declare in its manifest — runtime defense
 * against plugins (especially JS-authored ones) using undeclared capabilities.
 */
function undefinedCapability(name: string): unknown {
  return new Proxy(
    // Make the proxy also callable so fetch (a plain function) throws too
    function undef() {
      throw makeUndeclaredError(name, 'call')
    },
    {
      get(_target, prop) {
        return () => {
          throw makeUndeclaredError(name, String(prop))
        }
      },
      apply() {
        throw makeUndeclaredError(name, 'call')
      },
    },
  )
}

function makeUndeclaredError(name: string, accessor: string): SyncError {
  return new SyncError(
    SyncErrorCode.CONNECTOR_ERROR,
    `Capability "${name}" used (via .${accessor}) but not declared in spool.capabilities`,
  )
}

// ── Metadata consistency ──────────────────────────────────────────────────

function validateMetadataConsistency(pkg: PkgInfo, instance: Connector): void {
  const fields: Array<keyof typeof pkg.manifest & keyof Connector> = [
    'id', 'platform', 'label', 'description', 'color', 'ephemeral',
  ]
  for (const field of fields) {
    if (instance[field] !== pkg.manifest[field]) {
      throw new Error(
        `metadata mismatch for ${pkg.name}: ` +
        `instance.${field}=${JSON.stringify(instance[field])} ` +
        `but manifest.${field}=${JSON.stringify(pkg.manifest[field])}`,
      )
    }
  }
}
```

- [ ] **Step 14.4: Run tests — expect PASS**

Run:
```bash
pnpm --filter @spool/core test -- loader
```

Expected: all 6 test cases green.

- [ ] **Step 14.5: Run full core test suite**

Run:
```bash
pnpm --filter @spool/core test
```

Expected: all existing + new tests green.

- [ ] **Step 14.6: Commit**

```bash
git add packages/core/src/connectors/loader.ts packages/core/src/connectors/loader.test.ts
git commit -m "feat(connectors): add plugin loader with crash isolation

Loader discovers connector packages in ~/.spool/connectors/node_modules/
by scanning for spool.type === 'connector' in package.json. Builds a
ConnectorCapabilities bundle per connector based on declared capabilities;
undeclared slots are filled with a throwing Proxy for runtime defense.

Stage D uses a hardcoded first-party allowlist (Twitter + Typeless) — the
trust store replaces this in Stage E. Crashes in one connector do not
block others (try/catch per-connector). Unknown capabilities in manifest
are rejected before loading.

Part of Stage D (SDK split)."
```

---

## Phase 6 — Electron Main Wiring

### Task 15: Wire loader into `packages/app/src/main/index.ts`

**Files:**
- Modify: `packages/app/src/main/index.ts`

- [ ] **Step 15.1: Read current Twitter registration block**

Read `packages/app/src/main/index.ts` lines 184–220. Note the exact structure of `proxyFetch` and the `connectorRegistry.register(new TwitterBookmarksConnector(...))` call at line 216.

- [ ] **Step 15.2: Update imports**

Find the line:
```typescript
import {
  ConnectorRegistry, SyncScheduler, TwitterBookmarksConnector,
  // ... other imports
} from '@spool/core'
```

Remove `TwitterBookmarksConnector` from the import. Add loader-related imports:

```typescript
import {
  ConnectorRegistry, SyncScheduler,
  loadConnectors,
  makeFetchCapability,
  makeChromeCookiesCapability,
  makeLogCapabilityFor,
  // ... other imports
} from '@spool/core'
import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
```

Also, `@spool/core/index.ts` needs to export `loadConnectors` and the capability factories. Add to `packages/core/src/index.ts` (wherever the main barrel is):

```typescript
export { loadConnectors, STAGE_D_FIRST_PARTY_ALLOWLIST } from './connectors/loader.js'
export type { LoadDeps, LoadReport, LoadResult, CapabilityImpls } from './connectors/loader.js'
export {
  makeFetchCapability,
  makeChromeCookiesCapability,
  makeLogCapabilityFor,
} from './connectors/capabilities/index.js'
```

- [ ] **Step 15.3: Replace registration block**

Find the block around line 216 (`packages/app/src/main/index.ts`):

```typescript
// Before:
connectorRegistry.register(new TwitterBookmarksConnector({
  fetchFn: proxyFetch,
}))
syncScheduler = new SyncScheduler(db, connectorRegistry)
```

Replace with:

```typescript
// After:
await loadConnectors({
  bundledConnectorsDir: join(process.resourcesPath, 'bundled-connectors'),
  connectorsDir: join(homedir(), '.spool', 'connectors'),
  capabilityImpls: {
    fetch: makeFetchCapability(proxyFetch),
    cookies: makeChromeCookiesCapability(),
    logFor: (connectorId: string) => makeLogCapabilityFor(connectorId),
  },
  registry: connectorRegistry,
  log: {
    info: (msg, fields) => console.log(`[loader] ${msg}`, fields ?? ''),
    warn: (msg, fields) => console.warn(`[loader] ${msg}`, fields ?? ''),
    error: (msg, fields) => console.error(`[loader] ${msg}`, fields ?? ''),
  },
})
syncScheduler = new SyncScheduler(db, connectorRegistry)
```

**Dev-mode `bundledConnectorsDir` fallback**: In `electron-vite dev`, `process.resourcesPath` points to the Electron binary's own resources (where `bundled-connectors/` does NOT exist). For a smooth dev experience, conditionally override the path:

```typescript
const isDev = !app.isPackaged
const bundledConnectorsDir = isDev
  ? join(process.cwd(), 'dist/bundled-connectors')
  : join(process.resourcesPath, 'bundled-connectors')
```

Use this variable in the `loadConnectors` call. Dev builds can populate `dist/bundled-connectors/` by running `scripts/build-bundled-connectors.sh` manually before `pnpm dev`.

- [ ] **Step 15.4: Run typecheck**

Run:
```bash
pnpm --filter @spool/app typecheck
```

Expected: zero errors. If any remain, they'll be about the loader exports — fix `packages/core/src/index.ts` barrel.

- [ ] **Step 15.5: Build core + app**

Run:
```bash
pnpm --filter @spool/core build
pnpm --filter @spool/app build:electron
```

Expected: both succeed.

- [ ] **Step 15.6: Commit**

```bash
git add packages/app/src/main/index.ts packages/core/src/index.ts
git commit -m "feat(app): wire plugin loader into Electron main

Replace static TwitterBookmarksConnector registration with loadConnectors()
call. Connectors are now discovered dynamically from ~/.spool/connectors/
and instantiated with injected fetch, cookies, and log capabilities.

In dev mode, bundle dir defaults to dist/bundled-connectors/ (populated
by scripts/build-bundled-connectors.sh). In production, bundle dir is
process.resourcesPath/bundled-connectors.

Part of Stage D (SDK split)."
```

---

## Phase 7 — Typeless Plugin Takeover

### Task 16: Coordinate Typeless PR #49 takeover

**Files:**
- None initially — this task is the social/coordination part

- [ ] **Step 16.1: Post coordination comment on PR #49**

Manual action: on GitHub PR #49, post a comment using this template:

```markdown
Hey @<original-contributor>,

Thank you for this contribution — your work is what prompted us to formally
support local SQLite connectors in the framework. Since you submitted this
PR, we've locked Stage D of the connector system (see design doc linked
below), which changes how first-party plugins are structured:

- Plugins now live in `packages/connectors/<name>/` as independent workspace
  packages with peer dependency on `@spool/connector-sdk`
- Constructors take `ConnectorCapabilities` (fetch/cookies/log) instead of
  raw options
- `FetchContext` now includes an `AbortSignal` for cancellation

Rather than ask you to rebase this PR against the new shape, the spool-lab
team is going to take ownership of Typeless as a first-party plugin and
handle the migration. Your commits will be preserved via git history and
attribution comments at the top of the migrated files.

Going forward, you're welcome to:
1. **Continue contributing** — once Stage D ships, you'll be able to open
   PRs against `packages/connectors/typeless/` with the new contract
2. **Publish your own version** — Stage E adds open community plugin
   support via npm. You can publish `<your-scope>/connector-typeless` to
   npm and it'll appear in the spool.pro directory alongside the first-
   party version, giving users a choice

I'll reference this PR in the commit that lands the migrated code so the
link is preserved. Closing this PR as "superseded by Stage D migration"
once that lands.

Thanks again!
```

Wait for acknowledgement before proceeding. If the contributor objects or prefers a different path, adapt.

- [ ] **Step 16.2: Fork the branch locally**

```bash
git fetch origin pull/49/head:stage-d/typeless-takeover
git checkout stage-d/typeless-takeover
# Stay on this branch only for reference reading — do NOT merge or continue
# development here. Task 17 creates the migrated code in a NEW commit on
# the Stage D working branch.
git checkout -
```

- [ ] **Step 16.3: Document commit attribution format**

For files migrated from PR #49, prepend the file with a comment block:

```typescript
/*
 * Original implementation contributed by @<original-github-handle>
 * via pull request #49 (2026-03-<day>). Migrated to Stage D plugin
 * architecture by the spool-lab team.
 */
```

This step has no file changes yet — it's documented here so Task 17 follows the convention.

- [ ] **Step 16.4: Commit (no-op marker commit, optional)**

Skip if you prefer; this task's output is coordination + the branch fetch. No code commit is made in Task 16.

---

### Task 17: Create `packages/connectors/typeless/` from PR #49 reference

**Files:**
- Create: `packages/connectors/typeless/package.json`
- Create: `packages/connectors/typeless/tsconfig.json`
- Create: `packages/connectors/typeless/src/index.ts`
- Create: `packages/connectors/typeless/src/db-reader.ts`
- Create: `packages/connectors/typeless/.npmignore`

- [ ] **Step 17.1: Read PR #49's Typeless code**

```bash
git show stage-d/typeless-takeover --stat
git show stage-d/typeless-takeover:packages/core/src/connectors/typeless/index.ts  # or wherever PR #49 placed it
```

Identify:
- The SQLite schema Typeless reads (table name, column names for cursor synthesis)
- The `fetchPage` logic (which rows, in what order, how many per page)
- The `checkAuth` logic (file existence check?)
- The creation timestamps (for cursor synthesis)

Note these as design inputs for Steps 17.3–17.4.

- [ ] **Step 17.2: Create `package.json`**

`packages/connectors/typeless/package.json`:

```json
{
  "name": "@spool-lab/connector-typeless",
  "version": "0.1.0",
  "description": "Typeless voice transcripts for Spool",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist"
  ],
  "keywords": [
    "spool-connector"
  ],
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "prepack": "pnpm run build"
  },
  "peerDependencies": {
    "@spool/connector-sdk": "workspace:^"
  },
  "dependencies": {
    "better-sqlite3": "^11.10.0"
  },
  "devDependencies": {
    "@spool/connector-sdk": "workspace:^",
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.15.3",
    "typescript": "^5.7.3"
  },
  "spool": {
    "type": "connector",
    "id": "typeless",
    "platform": "typeless",
    "label": "Typeless",
    "description": "Your Typeless voice transcripts",
    "color": "#7C3AED",
    "ephemeral": false,
    "capabilities": ["log"]
  }
}
```

**Note**: `better-sqlite3` is a direct dependency of the plugin (not a framework capability — local file reads use Node's built-in file APIs plus the better-sqlite3 driver). This introduces a native-deps build step when the plugin is loaded; Stage D's bundled tarball includes the compiled `better-sqlite3` binary for macOS (arm64). **Known limitation**: cross-platform bundles would need per-platform tarballs — out of scope for Stage D.

- [ ] **Step 17.3: Create `tsconfig.json`**

Same as `twitter-bookmarks/tsconfig.json` (Step 9.2), just change the file path. Copy verbatim.

- [ ] **Step 17.4: Create `src/db-reader.ts`**

`packages/connectors/typeless/src/db-reader.ts`:

```typescript
/*
 * Original SQLite schema exploration and row-to-CapturedItem mapping
 * contributed by @<original-github-handle> via PR #49. Migrated to the
 * Stage D plugin architecture (capability injection, FetchContext object,
 * @spool/connector-sdk peerDep) by the spool-lab team.
 */
import Database from 'better-sqlite3'
import type { CapturedItem } from '@spool/connector-sdk'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

// NOTE: the schema below must match PR #49's findings. Validate against the
// actual Typeless SQLite file before implementing.
const TYPELESS_DB_PATH = join(
  homedir(),
  'Library',
  'Containers',
  'com.typeless.app',
  'Data',
  'Library',
  'Application Support',
  'typeless.db',
)
const PAGE_SIZE = 25

export function typelessDbExists(): boolean {
  return existsSync(TYPELESS_DB_PATH)
}

export interface TypelessRow {
  id: string
  created_at: number // unix ms
  text: string
  title: string | null
  duration_ms: number | null
}

/**
 * Read one page of transcripts strictly older than `beforeCursor`.
 * `beforeCursor` is a stringified unix millisecond timestamp; null = start
 * from the newest row.
 *
 * Returns up to PAGE_SIZE rows, newest first (DESC order).
 */
export function readPage(beforeCursor: string | null): {
  rows: TypelessRow[]
  nextCursor: string | null
} {
  const db = new Database(TYPELESS_DB_PATH, { readonly: true, fileMustExist: true })
  try {
    const sql = beforeCursor
      ? `SELECT id, created_at, text, title, duration_ms FROM transcripts
         WHERE created_at < ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT id, created_at, text, title, duration_ms FROM transcripts
         ORDER BY created_at DESC LIMIT ?`
    const params = beforeCursor
      ? [Number(beforeCursor), PAGE_SIZE]
      : [PAGE_SIZE]
    const rows = db.prepare(sql).all(...params) as TypelessRow[]
    const nextCursor = rows.length === PAGE_SIZE
      ? String(rows[rows.length - 1].created_at)
      : null
    return { rows, nextCursor }
  } finally {
    db.close()
  }
}

export function rowToCapturedItem(row: TypelessRow): CapturedItem {
  const capturedAt = new Date(row.created_at).toISOString()
  const text = row.text ?? ''
  const title = row.title ?? (text.length > 120 ? text.slice(0, 117) + '...' : text)
  return {
    url: `typeless://transcript/${row.id}`,
    title,
    contentText: text,
    author: null,
    platform: 'typeless',
    platformId: row.id,
    contentType: 'voice-transcript',
    thumbnailUrl: null,
    metadata: {
      durationMs: row.duration_ms,
      source: 'typeless-local',
    },
    capturedAt,
    rawJson: null,
  }
}
```

**Important**: The actual Typeless DB path and schema must be confirmed against PR #49 or the real Typeless app. The paths, table name, column names, and `com.typeless.app` bundle ID above are placeholders pending that confirmation. Update before building.

- [ ] **Step 17.5: Create `src/index.ts`**

`packages/connectors/typeless/src/index.ts`:

```typescript
/*
 * Original Typeless connector contributed by @<original-github-handle>
 * via PR #49. Migrated to Stage D plugin architecture by the spool-lab team.
 */
import type {
  Connector,
  ConnectorCapabilities,
  AuthStatus,
  PageResult,
  FetchContext,
} from '@spool/connector-sdk'
import { SyncError, SyncErrorCode } from '@spool/connector-sdk'
import { typelessDbExists, readPage, rowToCapturedItem } from './db-reader.js'

export default class TypelessConnector implements Connector {
  readonly id = 'typeless'
  readonly platform = 'typeless'
  readonly label = 'Typeless'
  readonly description = 'Your Typeless voice transcripts'
  readonly color = '#7C3AED'
  readonly ephemeral = false

  constructor(private readonly caps: ConnectorCapabilities) {}

  async checkAuth(): Promise<AuthStatus> {
    if (!typelessDbExists()) {
      return {
        ok: false,
        error: SyncErrorCode.CONNECTOR_ERROR,
        message: 'Typeless database not found',
        hint: 'Install Typeless and create at least one transcript, then retry.',
      }
    }
    return { ok: true }
  }

  async fetchPage(ctx: FetchContext): Promise<PageResult> {
    if (ctx.signal.aborted) {
      throw new SyncError(SyncErrorCode.SYNC_CANCELLED, 'Sync cancelled')
    }
    try {
      const { rows, nextCursor } = await this.caps.log.span(
        'readPage',
        async () => readPage(ctx.cursor),
        { attributes: { 'typeless.phase': ctx.phase } },
      )
      return {
        items: rows.map(rowToCapturedItem),
        nextCursor,
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('SQLITE_BUSY')) {
        throw new SyncError(
          SyncErrorCode.CONNECTOR_ERROR,
          'Typeless database is locked. Close Typeless and retry.',
          err,
        )
      }
      throw SyncError.from(err)
    }
  }
}
```

- [ ] **Step 17.6: Create `.npmignore`**

Same as `twitter-bookmarks/.npmignore` (Step 9.4).

- [ ] **Step 17.7: Install and build**

Run:
```bash
pnpm install
pnpm --filter @spool-lab/connector-typeless build
```

Expected: build succeeds. If the schema is wrong or Typeless DB fields have changed, build still passes (types are fine) — actual correctness is validated in smoke testing.

- [ ] **Step 17.8: Phantom independence check**

Run:
```bash
./scripts/phantom-independence-check.sh typeless
```

Expected: PASS. If it fails due to `better-sqlite3` native bindings, the test harness may need a `--ignore-scripts` adjustment or the script needs to rebuild native deps in the temp dir.

- [ ] **Step 17.9: Commit**

```bash
git add packages/connectors/typeless/ pnpm-lock.yaml
git commit -m "feat(typeless): create first-party Typeless plugin

Local SQLite connector for Typeless voice transcripts. Migrated from
the community PR #49 (attribution preserved in file headers) to the
Stage D plugin architecture.

Declares capabilities: [log]. Uses better-sqlite3 directly as a plugin
dependency (not a framework capability) since local file/DB reads do
not benefit from framework-level injection.

Two capability sets across Twitter ([fetch, cookies:chrome, log]) and
Typeless ([log]) now stress-test the SDK boundary as designed.

Closes #49 (superseded by this migration).

Part of Stage D (SDK split)."
```

---

## Phase 8 — Bundle Build and Ship

### Task 18: Create `build-bundled-connectors.sh` script

**Files:**
- Create: `scripts/build-bundled-connectors.sh`

- [ ] **Step 18.1: Write the script**

`scripts/build-bundled-connectors.sh`:

```bash
#!/usr/bin/env bash
#
# Build first-party connector tarballs into dist/bundled-connectors/
# for inclusion in Electron's resources directory via electron-builder's
# extraResources configuration.
#
# Called from packages/app/package.json's prebuild hook. Also runnable
# manually for dev mode:
#
#   scripts/build-bundled-connectors.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/packages/app/dist/bundled-connectors"

FIRST_PARTY_PLUGINS=(
  "@spool-lab/connector-twitter-bookmarks"
  "@spool-lab/connector-typeless"
)

echo "==> Preparing $OUT_DIR"
mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*.tgz

for plugin in "${FIRST_PARTY_PLUGINS[@]}"; do
  echo "==> Building $plugin"
  pnpm --filter "$plugin" build

  echo "==> Packing $plugin"
  pnpm --filter "$plugin" pack --pack-destination "$OUT_DIR"
done

echo "==> Bundled connectors ready:"
ls -lh "$OUT_DIR"/*.tgz
```

- [ ] **Step 18.2: Make executable**

```bash
chmod +x scripts/build-bundled-connectors.sh
```

- [ ] **Step 18.3: Run it**

Run:
```bash
./scripts/build-bundled-connectors.sh
```

Expected: two tarballs in `packages/app/dist/bundled-connectors/`:
- `spool-lab-connector-twitter-bookmarks-0.1.0.tgz`
- `spool-lab-connector-typeless-0.1.0.tgz`

- [ ] **Step 18.4: Verify tarball contents**

Run:
```bash
tar -tzf packages/app/dist/bundled-connectors/spool-lab-connector-twitter-bookmarks-*.tgz | head -20
```

Expected: paths like `package/package.json`, `package/dist/index.js`, `package/dist/graphql-fetch.js`.

- [ ] **Step 18.5: Commit**

```bash
git add scripts/build-bundled-connectors.sh
git commit -m "chore(bundle): add script to pack first-party plugins for bundling

Builds and packs @spool-lab/connector-twitter-bookmarks and
@spool-lab/connector-typeless into packages/app/dist/bundled-connectors/
as npm tarballs. Called from packages/app prebuild hook; can be run
manually for dev mode.

Part of Stage D (SDK split)."
```

---

### Task 19: Wire electron-builder `extraResources` and prebuild hook

**Files:**
- Modify: `packages/app/package.json`

- [ ] **Step 19.1: Add prebuild script**

Edit `packages/app/package.json` `scripts` section. Find the `"build"` script:

```json
"build": "pnpm run build:core && electron-vite build && electron-builder --publish never",
```

Add a new `"prebuild"` script before it (or inline via `&&`):

```json
"prebuild": "bash ../../scripts/build-bundled-connectors.sh",
"build": "pnpm run build:core && pnpm run prebuild && electron-vite build && electron-builder --publish never",
"build:mac": "pnpm run build:core && pnpm run prebuild && electron-vite build && electron-builder --mac --arm64",
"build:linux": "pnpm run build:core && pnpm run prebuild && electron-vite build && electron-builder --linux",
```

- [ ] **Step 19.2: Add extraResources to electron-builder config**

In the same `packages/app/package.json` `"build"` key (electron-builder config), add `extraResources` at the top level (alongside `asarUnpack`, `mac`, etc.):

```json
"build": {
  "appId": "com.linkclaw.spool",
  "productName": "Spool",
  "publish": [ ... ],
  "extraResources": [
    {
      "from": "dist/bundled-connectors",
      "to": "bundled-connectors",
      "filter": ["*.tgz"]
    }
  ],
  "asarUnpack": [ ... ],
  ...
}
```

- [ ] **Step 19.3: Test a full build**

Run:
```bash
pnpm --filter @spool/app build:mac
```

Expected: eventually produces a `.dmg` or `.app` in `packages/app/dist-electron/`. Inside the app bundle:

```bash
ls "packages/app/dist-electron/mac-arm64/Spool.app/Contents/Resources/bundled-connectors/"
```

Expected: both tarballs present.

**Note**: If you're not on macOS arm64, skip this step or adapt to your build target. The critical validation is that `extraResources` correctly copies tarballs into the final app resources.

- [ ] **Step 19.4: Commit**

```bash
git add packages/app/package.json
git commit -m "chore(app): wire bundled connectors into electron-builder

Add prebuild hook that runs scripts/build-bundled-connectors.sh to pack
first-party plugins. Add extraResources entry to copy the tarballs into
the app's Resources/bundled-connectors/ directory. The loader picks up
these tarballs on first launch and extracts them to
~/.spool/connectors/node_modules/.

Part of Stage D (SDK split)."
```

---

## Phase 9 — Smoke Testing and Documentation

### Task 20: Cold-launch smoke test runbook

**Files:**
- Create: `docs/superpowers/runbooks/stage-d-smoke-test.md`

- [ ] **Step 20.1: Write the runbook**

`docs/superpowers/runbooks/stage-d-smoke-test.md`:

```markdown
# Stage D Cold-Launch Smoke Test

Run this manual smoke test after Task 19 to verify that first-party
connectors load correctly from the first-run bundle path, even on a
clean user machine without network access.

## Preconditions

- macOS arm64 (adapt for other platforms)
- Chrome installed with a logged-in X account (for Twitter sync validation)
- Typeless installed with at least one transcript (optional for Typeless validation)

## Test: Cold launch from clean state

1. **Build a fresh app**:
   ```bash
   pnpm --filter @spool/app clean
   pnpm --filter @spool/app build:mac
   ```

2. **Delete any previous connector install**:
   ```bash
   rm -rf ~/.spool/connectors
   ```

3. **Disable network**: turn off Wi-Fi / Ethernet.

4. **Launch the freshly built app**:
   ```bash
   open packages/app/dist-electron/mac-arm64/Spool.app
   ```

5. **Verify bundle extraction**: while the app is running, check:
   ```bash
   ls ~/.spool/connectors/node_modules/@spool-lab/
   ```
   Expected: `connector-twitter-bookmarks/` and `connector-typeless/` directories present.

6. **Verify registration**: in the app UI, navigate to the Connectors panel.
   Expected: both Twitter Bookmarks and Typeless appear as registered
   connectors. Neither should show a "load failed" error.

7. **Try a manual sync**:
   - Click "Sync Now" on Twitter Bookmarks
   - Expected: error with `NETWORK_OFFLINE` or `NETWORK_TIMEOUT` code
     (not a loader crash, not a capability error)
   - This confirms the connector reached the fetch layer before failing

8. **Re-enable network and sync again**:
   - Click "Sync Now" on Twitter Bookmarks
   - Expected: at least one page of bookmarks fetched and written to DB
   - Verify in the app UI that tweets appear in search

## Test: `.do-not-restore` opt-out

1. Create the opt-out file:
   ```bash
   echo "@spool-lab/connector-typeless" > ~/.spool/connectors/.do-not-restore
   rm -rf ~/.spool/connectors/node_modules/@spool-lab/connector-typeless
   ```

2. Restart the app.

3. Expected: Typeless does NOT re-extract. Directory remains absent.
   Twitter still loads normally.

4. Cleanup: delete the opt-out file and restart to restore Typeless.

## Test: Cancel propagation during backoff

Requires ability to trigger a sync and cancel it mid-flight. Typically
done with the E2E test suite — see `packages/app/e2e/stage-d-cancel.spec.ts`
(if created).

1. Start a Twitter sync with Chrome offline so the fetch stalls
2. Click "Stop" / trigger `scheduler.stop()` from the status bar
3. Expected: sync terminates within 200ms — log shows `stopReason: 'cancelled'`,
   no 120-second hang from the 429 backoff loop

## Failure diagnostics

If any step fails, check `~/Library/Logs/Spool/main.log` for loader and
capability diagnostic output. Common failure modes:

- **"entry file not found"**: the tarball's `dist/index.js` is missing.
  Check the plugin's `"files"` field in package.json includes `"dist"`.
- **"capability used but not declared"**: the plugin is using a capability
  it didn't list in `spool.capabilities`. Update the manifest.
- **"metadata mismatch"**: the connector instance fields don't match the
  manifest's `spool.*` fields. Synchronize them.
```

- [ ] **Step 20.2: Run the smoke test**

Manually execute every numbered step in the runbook. Document any failures as additional task items in Phase 10 below, or fix them inline.

**Do not commit the runbook until at least the cold-launch test (steps 1–7) passes end-to-end.**

- [ ] **Step 20.3: Commit**

```bash
git add docs/superpowers/runbooks/stage-d-smoke-test.md
git commit -m "docs(runbook): Stage D cold-launch smoke test

Manual test procedure for verifying first-run bundle extraction,
connector registration, offline/online sync, .do-not-restore opt-out,
and cancel propagation during retry backoff.

Part of Stage D (SDK split)."
```

---

### Task 21: Update architecture docs and memory

**Files:**
- Modify: `docs/connector-sync-architecture.md`
- External (memory): `~/.claude/projects/-Users-chen-github-spool/memory/project_connector_plugin_system_next.md`

- [ ] **Step 21.1: Update architecture doc capability section**

In `docs/connector-sync-architecture.md` §Capability model:

- Remove any mention of `storage` as a v1 capability
- Confirm the v1 list is `"fetch" | "cookies:chrome" | "log"`
- Update the example `spool.capabilities` array to `["fetch", "cookies:chrome"]` (without `storage`)
- Add a line: "`storage` is reserved for a future SDK v1.1 extension; v1 connectors manage their own state via the engine's `SyncState` or through inline file/DB access with the relevant capability."

- [ ] **Step 21.2: Update `FetchContext` description**

In `docs/connector-sync-architecture.md` `FetchContext` interface block, add the `signal` field:

```typescript
interface FetchContext {
  cursor: string | null
  sinceItemId: string | null
  phase: 'forward' | 'backfill'
  signal: AbortSignal  // fires when the sync engine wants to stop
}
```

Add explanatory text: "Connectors should pass `signal` through to `caps.fetch(url, { signal })` and to `abortableSleep(ms, signal)` in retry backoff loops to ensure cancel propagates promptly."

- [ ] **Step 21.3: Add a note about `abortableSleep`**

In the connector authoring guide section, add under "Useful SDK exports":

> **`abortableSleep(ms, signal)`** — use this inside any retry/backoff loop in `fetchPage`. Unlike plain `setTimeout`, it rejects with the signal's reason when the engine cancels, so `scheduler.stop()` takes effect within one event-loop tick.

- [ ] **Step 21.4: Update memory file**

Edit `~/.claude/projects/-Users-chen-github-spool/memory/project_connector_plugin_system_next.md`:

Change the "Capability set" section from:
```
- `storage` — scoped KV for connector-owned state
```
to:
```
- `storage` — **REMOVED from v1 per Stage D design (2026-04-12)**. No Stage D plugin consumes it. Deferred to v1.1 as non-breaking addition when an actual consumer arrives.
```

Add a new status entry at the top:
```
## Status as of <Stage D completion date>

Stage D **in progress** / **complete** (update on merge):
- `@spool/connector-sdk` package exists with v1 capability types
- Twitter + Typeless migrated to packages/connectors/* as first-party plugins
- Loader + first-run bundle extraction working on cold launch
- Stage D commits: <list>
```

- [ ] **Step 21.5: Commit docs**

```bash
git add docs/connector-sync-architecture.md
git commit -m "docs(connector): update architecture doc for Stage D

- Remove storage from v1 capability set (deferred to v1.1)
- Add FetchContext.signal field
- Document abortableSleep utility in authoring guide

Aligns docs with Stage D design decisions (design doc §3.1, §5.5).

Part of Stage D (SDK split)."
```

Memory updates are not committed (memory is not in the repo).

---

## Phase 10 — Verification

### Task 22: Full Stage D acceptance check

**Files:** None — this task runs verification commands.

- [ ] **Step 22.1: Full test suite**

```bash
pnpm --filter @spool/core test
pnpm --filter @spool/connector-sdk test
```

Expected: all tests green.

- [ ] **Step 22.2: All builds green**

```bash
pnpm -r build
```

Expected: all workspace packages build without error.

- [ ] **Step 22.3: Typecheck apps**

```bash
pnpm --filter @spool/app typecheck
pnpm --filter @spool/cli typecheck || true  # CLI may not have typecheck script
```

Expected: zero errors.

- [ ] **Step 22.4: SDK tarball size check**

```bash
pnpm --filter @spool/connector-sdk pack --pack-destination /tmp
ls -lh /tmp/spool-connector-sdk-*.tgz
```

Expected: size < 50 KB.

- [ ] **Step 22.5: Phantom independence on all first-party plugins**

```bash
./scripts/phantom-independence-check.sh twitter-bookmarks
./scripts/phantom-independence-check.sh typeless
```

Expected: both PASS.

- [ ] **Step 22.6: Core has no Twitter references**

```bash
grep -rn "TwitterBookmarksConnector\|connectors/twitter-bookmarks" packages/core/src/ && echo "FAIL" || echo "OK: no references"
```

Expected: `OK: no references`.

- [ ] **Step 22.7: Plugins have no @spool/core imports**

```bash
grep -rn "from '@spool/core'\|from \"@spool/core\"" packages/connectors/ && echo "FAIL" || echo "OK: no @spool/core imports"
```

Expected: `OK: no @spool/core imports`.

- [ ] **Step 22.8: Manual cold-launch test**

Execute `docs/superpowers/runbooks/stage-d-smoke-test.md` Test 1 (Cold launch from clean state) end to end.

Expected: all 8 numbered steps pass.

- [ ] **Step 22.9: Final commit and branch push**

```bash
git status  # confirm clean tree
git log --oneline origin/main..HEAD  # review Stage D commit list
```

If everything looks good:

```bash
git push -u origin <stage-d-branch-name>
```

Then open a pull request against `main` titled:

```
feat(connectors): Stage D — SDK split and plugin loader
```

With a body linking to the design doc, listing the 9-step migration sequence, and calling out the verification artifacts (phantom independence check, smoke test runbook).

---

## Summary

This plan decomposes Stage D into 22 tasks across 10 phases:

| Phase | Tasks | Focus |
|---|---|---|
| 1 | Tasks 1–5 | SDK foundation + FetchContext.signal |
| 2 | Task 6 | Workspace container |
| 3 | Tasks 7–8 | Capability implementations in core |
| 4 | Tasks 9–11 | Twitter plugin migration + phantom check |
| 5 | Tasks 12–14 | Loader + bundle extraction |
| 6 | Task 15 | Electron main wiring |
| 7 | Tasks 16–17 | Typeless plugin takeover |
| 8 | Tasks 18–19 | Build bundle script + electron-builder |
| 9 | Tasks 20–21 | Smoke test runbook + doc updates |
| 10 | Task 22 | Full acceptance verification |

Each task is scoped to produce a meaningful, reviewable commit. Tasks 1–6 lay the foundation without breaking existing code. Tasks 7–8 are in-place refactors. Task 10 is the first destructive change (deletes Twitter from core, temporarily breaks app wiring); Task 15 restores it via the loader. Tasks 16–17 handle Typeless in parallel. Tasks 18–19 ship the bundle mechanism. Tasks 20–22 verify end to end.

Typical execution time: an experienced engineer familiar with the codebase, following subagent-driven-development, completes Stage D in roughly 4–6 working sessions. Pure coding time is smaller — most effort goes into PR review, test-run iteration, and the manual smoke test.
