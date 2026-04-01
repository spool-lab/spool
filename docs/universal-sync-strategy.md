# Universal Sync Strategy for Third-Party Data Sources

> Design document for Spool's bidirectional cursor-based sync engine.
> This covers the CS theory, architecture, edge cases, and implementation plan.

---

## 1. Problem Statement

Spool syncs user content from 50+ third-party platforms via OpenCLI. Every platform
shares the same fundamental sync pattern:

1. **Backfill** — When a user first connects a source (e.g., Twitter Bookmarks),
   fetch from the most recent item backward toward the oldest, page by page.
2. **Incremental** — Periodically check for newly added items since the last sync.
3. Both directions run concurrently and must be resumable after interruption.

The current implementation (`OpenCLIManager.syncSource`) is a single-shot fetch:
one invocation, one page of results, no pagination, no cursor tracking, no backfill
progress. This document designs the universal replacement.

---

## 2. CS Background: Known Patterns

### 2.1 Cursor-Based Pagination (Keyset Pagination)

The standard for traversing large, mutable collections via APIs. Instead of
`OFFSET/LIMIT` (which breaks when items are inserted or deleted), cursors use
an opaque token representing a position in the ordered set.

**Properties:**
- Stable under insertions/deletions (unlike offset-based)
- O(1) seek per page (vs O(n) for offset)
- Works naturally with append-only and reverse-chronological feeds

**In our context:** Each platform API (or OpenCLI command) returns items in
reverse-chronological order. A cursor is typically the `platform_id` or
timestamp of the last item seen. We maintain two cursors per source:
- `forward_cursor` — points to the newest item we've seen (for incremental sync)
- `backward_cursor` — points to the oldest item we've reached (for backfill)

### 2.2 Bidirectional Sync (Two-Frontier Pattern)

This is a well-known pattern in data ingestion systems (e.g., Slack's message
history import, email IMAP sync, social media archivers). The canonical approach:

```
Timeline: ──────────────────────────────────────────────►
          oldest                                    newest

          ◄── Backfill frontier    Forward frontier ──►
              (moves left)          (moves right)

          [========= already synced =========]
```

- **Forward sync** runs on a schedule (e.g., every 15 min), fetching items
  newer than `forward_cursor`.
- **Backfill sync** runs in the background, fetching items older than
  `backward_cursor`, page by page, until it hits the end.
- When backfill completes, `backfill_complete = true`, and only forward sync
  continues.

### 2.3 Idempotent Upsert

Every sync operation must be idempotent: processing the same item twice produces
the same result. This is achieved via `platform_id`-based deduplication (which
Spool already does in `insertCapture`).

### 2.4 Eventual Consistency

Perfect real-time consistency with third-party platforms is impossible. We accept
**eventual consistency** with explicit bounds:
- Forward sync guarantees: items appear within `poll_interval` of creation
- Backfill guarantees: complete history is indexed within hours/days
- Deletions: explicitly handled via periodic reconciliation (see §5)

### 2.5 High-Water Mark / Low-Water Mark

From stream processing (Kafka, Flink):
- **High-water mark** = newest item timestamp/ID we've committed → our `forward_cursor`
- **Low-water mark** = oldest item timestamp/ID we've reached → our `backward_cursor`

The gap between them is the "synced window." Once backfill completes, the low-water
mark is pinned at "beginning of time."

---

## 3. Architecture Design

### 3.1 Core Concepts

```typescript
/**
 * SyncCursor tracks bidirectional sync progress for a single source.
 * Persisted in the database, survives app restarts.
 */
interface SyncCursor {
  opencliSrcId: number       // FK to opencli_sources
  forwardCursor: string | null   // platform_id or ISO timestamp of newest synced item
  backwardCursor: string | null  // platform_id or ISO timestamp of oldest synced item
  backfillComplete: boolean      // true once we've reached the end of history
  lastForwardSync: string | null // ISO timestamp of last forward sync attempt
  lastBackfillSync: string | null // ISO timestamp of last backfill attempt
  consecutiveErrors: number      // for exponential backoff on failures
}
```

```typescript
/**
 * SyncStrategy extended with pagination support.
 */
interface SyncStrategyV2 extends SyncStrategy {
  pagination: {
    /** How to determine cursor value from an item */
    cursorField: string          // e.g., 'platform_id', 'capturedAt'
    /** Sort order of API results: 'newest_first' (typical) or 'oldest_first' */
    order: 'newest_first' | 'oldest_first'
    /** Max items per page */
    pageSize: number
    /** CLI arg for cursor (e.g., '--cursor', '--max-id', '--before') */
    cursorArg?: string
    /** CLI arg for page size (e.g., '--limit', '--count') */
    limitArg?: string
  }
  scheduling: {
    /** Minimum interval between forward syncs (seconds) */
    pollInterval: number
    /** Minimum interval between backfill pages (seconds) */
    backfillInterval: number
    /** Max consecutive errors before disabling auto-sync */
    maxConsecutiveErrors: number
  }
}
```

### 3.2 Sync Engine State Machine

Each source follows this state machine:

```
                    ┌──────────────┐
                    │   IDLE       │
                    └──────┬───────┘
                           │ timer fires or manual trigger
                    ┌──────▼───────┐
               ┌────│  DISPATCHING │────┐
               │    └──────────────┘    │
               ▼                        ▼
    ┌──────────────────┐    ┌──────────────────┐
    │ FORWARD_SYNCING  │    │ BACKFILL_SYNCING  │
    │ (fetch newest)   │    │ (fetch older page) │
    └────────┬─────────┘    └────────┬──────────┘
             │                       │
             ▼                       ▼
    ┌──────────────────┐    ┌──────────────────┐
    │ FORWARD_DONE     │    │ BACKFILL_DONE     │
    │ update cursor    │    │ update cursor     │
    └────────┬─────────┘    └────────┬──────────┘
             │                       │
             └───────────┬───────────┘
                         ▼
                  ┌──────────────┐
                  │   IDLE       │ (schedule next run)
                  └──────────────┘
```

Forward and backfill can run concurrently for the same source, but each
direction is serialized (no parallel pages for the same direction).

### 3.3 Database Schema Changes

```sql
-- Track bidirectional sync progress per source
CREATE TABLE IF NOT EXISTS sync_cursors (
  id                  INTEGER PRIMARY KEY,
  opencli_src_id      INTEGER NOT NULL UNIQUE REFERENCES opencli_sources(id) ON DELETE CASCADE,
  forward_cursor      TEXT,              -- newest item cursor (platform_id or timestamp)
  backward_cursor     TEXT,              -- oldest item cursor (platform_id or timestamp)
  backfill_complete   INTEGER NOT NULL DEFAULT 0,
  last_forward_sync   TEXT,              -- ISO timestamp
  last_backfill_sync  TEXT,              -- ISO timestamp
  consecutive_errors  INTEGER NOT NULL DEFAULT 0,
  total_pages_fetched INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Track individual sync operations for observability
CREATE TABLE IF NOT EXISTS sync_runs (
  id              INTEGER PRIMARY KEY,
  opencli_src_id  INTEGER NOT NULL REFERENCES opencli_sources(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL CHECK (direction IN ('forward', 'backfill')),
  status          TEXT NOT NULL CHECK (status IN ('running', 'success', 'error', 'partial')),
  items_fetched   INTEGER NOT NULL DEFAULT 0,
  items_added     INTEGER NOT NULL DEFAULT 0,
  items_updated   INTEGER NOT NULL DEFAULT 0,
  cursor_before   TEXT,                  -- cursor value before this run
  cursor_after    TEXT,                  -- cursor value after this run
  error_message   TEXT,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_source ON sync_runs(opencli_src_id);
CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs(started_at DESC);
```

### 3.4 Sync Engine Class

```typescript
class SyncEngine {
  private db: Database.Database
  private manager: OpenCLIManager
  private scheduler: SyncScheduler
  private running: Map<number, AbortController>  // opencliSrcId → abort

  /**
   * Start the engine: load all enabled sources, schedule their sync jobs.
   */
  start(): void

  /**
   * Stop all running syncs and scheduled jobs.
   */
  stop(): void

  /**
   * Trigger an immediate sync for a specific source (both directions).
   */
  syncNow(opencliSrcId: number): Promise<SyncRunResult>

  /**
   * Trigger only forward sync for a source.
   */
  syncForward(opencliSrcId: number): Promise<SyncRunResult>

  /**
   * Trigger one page of backfill for a source.
   */
  syncBackfillPage(opencliSrcId: number): Promise<SyncRunResult>

  /**
   * Get current sync status for all sources.
   */
  getStatus(): SyncSourceStatus[]
}
```

### 3.5 Scheduler

```typescript
class SyncScheduler {
  private timers: Map<number, NodeJS.Timeout>

  /**
   * Schedule a source's next forward sync based on its pollInterval.
   * Uses exponential backoff on consecutive errors.
   */
  scheduleForward(opencliSrcId: number, delayMs: number): void

  /**
   * Schedule next backfill page. Backfill runs slower than forward
   * to avoid rate limits (e.g., one page every 30s).
   */
  scheduleBackfill(opencliSrcId: number, delayMs: number): void

  /**
   * Cancel all scheduled jobs for a source.
   */
  cancel(opencliSrcId: number): void

  cancelAll(): void
}
```

---

## 4. Sync Flow: Detailed Walkthrough

### 4.1 First Sync (User just connected Twitter Bookmarks)

```
1. User clicks "Connect" → addOpenCLISource() → opencli_src_id = 42
2. SyncEngine initializes cursor: { forward: null, backward: null, backfillComplete: false }
3. SyncEngine triggers syncForward(42):
   a. Runs: opencli twitter bookmarks --limit 50 -f json
   b. Receives 50 items, sorted newest-first
   c. Upserts all 50 into captures table
   d. Sets forward_cursor = items[0].platform_id   (newest)
   e. Sets backward_cursor = items[49].platform_id  (oldest in this batch)
   f. Logs sync_run { direction: 'forward', items_fetched: 50, items_added: 50 }
4. SyncEngine schedules:
   - Next forward sync in 15 minutes
   - Next backfill page in 10 seconds
5. Backfill page runs:
   a. Runs: opencli twitter bookmarks --limit 50 --before <backward_cursor> -f json
   b. Receives 50 older items
   c. Upserts all into captures
   d. Updates backward_cursor = items[49].platform_id
   e. Schedules next backfill page in 10 seconds
6. Repeat step 5 until API returns < pageSize items → backfillComplete = true
```

### 4.2 Steady-State (Backfill complete, periodic forward sync)

```
1. Timer fires every 15 minutes
2. syncForward(42):
   a. Runs: opencli twitter bookmarks --limit 50 --since <forward_cursor> -f json
   b. Receives 3 new items
   c. Upserts into captures
   d. Updates forward_cursor = items[0].platform_id
   e. consecutive_errors = 0
3. Schedule next forward sync in 15 minutes
```

### 4.3 Interrupted Sync (App crashes mid-backfill)

```
1. App restarts
2. SyncEngine loads all cursors from sync_cursors table
3. For source 42: backfillComplete = false, backward_cursor = "tweet_12345"
4. Resumes backfill from backward_cursor — no data loss, no duplicate work
5. Items already synced are deduplicated by platform_id (idempotent upsert)
```

---

## 5. Edge Cases & Consistency

### 5.1 Deletion Detection (User unbookmarks a tweet)

**Problem:** User removes a bookmark between syncs. We have a stale item in our index.

**Approach: Tiered reconciliation**

| Level | Strategy | When | Cost |
|-------|----------|------|------|
| L0 | **Ignore** | Default for most sources | Zero |
| L1 | **Soft tombstone** | On next full-page overlap | Low |
| L2 | **Periodic full reconciliation** | Weekly/manual | High |

**L0 — Acceptable Staleness (Default):**
For most use cases, stale items in a personal search index are harmless. The item
was real content the user interacted with — keeping it indexed is often desirable.
This is the default for all sources.

**L1 — Overlap-Based Tombstoning:**
During forward sync, if we fetch a page that overlaps with items we already have,
we can detect "gaps" — items that existed in a previous fetch of the same range but
are now missing. Mark these as `tombstoned` (soft delete, excluded from search
but retained for audit).

```sql
ALTER TABLE captures ADD COLUMN tombstoned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE captures ADD COLUMN tombstoned_at TEXT;
```

**L2 — Full Reconciliation:**
Periodically fetch the complete list of current items and diff against our index.
Items in our index but not in the remote are tombstoned. This is expensive (many
API calls) and should only run on user request or on a weekly schedule.

```typescript
interface ReconciliationResult {
  checked: number       // items in our index
  confirmed: number     // still exist remotely
  tombstoned: number    // marked as deleted
  resurrected: number   // previously tombstoned, now exist again
}
```

**Recommendation:** Default to L0. Offer L2 as a manual "Refresh" action in the UI.
L1 is a nice-to-have optimization that can be added later.

### 5.2 Ordering Instability

**Problem:** Some APIs don't guarantee stable ordering. Items can shift positions
between fetches, causing duplicates or gaps.

**Solution:** Deduplication by `platform_id` (already implemented) handles duplicates.
Gaps are addressed by allowing a configurable overlap window — fetch slightly more
items than needed to account for shifts.

```typescript
// When forward-syncing, fetch a few extra items past the cursor
// to catch items that may have shifted position
const OVERLAP_BUFFER = 5
```

### 5.3 Rate Limiting

**Problem:** Platforms rate-limit API calls. Aggressive syncing gets blocked.

**Solution:** Exponential backoff with jitter.

```typescript
function getBackoffDelay(consecutiveErrors: number, baseMs: number): number {
  const delay = baseMs * Math.pow(2, Math.min(consecutiveErrors, 8))
  const jitter = delay * 0.2 * Math.random()
  return delay + jitter
}
```

The engine tracks `consecutive_errors` per source and increases delay
on each failure. After `maxConsecutiveErrors` (default: 5), auto-sync is
paused and the user is notified.

### 5.4 Pagination Cursor Unavailable

**Problem:** Some OpenCLI commands don't support cursor-based pagination
(e.g., `hackernews top` returns the current top 30 — no cursor, no history).

**Solution:** Classify sources by sync capability:

```typescript
type SyncMode =
  | 'bidirectional'     // Full cursor support (twitter bookmarks, github stars)
  | 'snapshot'          // No pagination, fetch current state each time (HN top, trending)
  | 'append_only'       // Only forward sync, no backfill (notifications)
```

For `snapshot` sources, each sync replaces the previous snapshot. For
`append_only`, only `forward_cursor` is used.

### 5.5 Content Mutation (Item edited after sync)

**Problem:** A tweet is edited, or a GitHub repo description changes.

**Solution:** The existing `insertCapture` already does upsert-on-platform_id,
updating `title`, `content_text`, etc. Forward sync naturally picks up
mutations when it re-fetches overlapping items. No special handling needed.

### 5.6 Clock Skew / Timezone Issues

**Problem:** `capturedAt` timestamps from different platforms may use different
timezones or have clock skew.

**Solution:** Always normalize to UTC ISO 8601 in the parser layer. Use
`platform_id` (not timestamps) as the primary cursor where available.
Timestamps are secondary sort keys only.

### 5.7 Large Backfill (User has 10,000 bookmarks)

**Problem:** Backfilling years of history takes many pages and significant time.

**Solution:**
- Backfill runs in small pages (50 items) with delays between pages
- Progress is persisted after every page (crash-safe)
- UI shows backfill progress: "Synced 2,400 / ~10,000 bookmarks (24%)"
- User can pause/resume backfill
- Backfill is lower priority than forward sync (new content first)

---

## 6. Strategy Classification

Mapping existing `SYNC_STRATEGIES` to sync modes:

| Source | Mode | Cursor Support | Notes |
|--------|------|---------------|-------|
| Twitter Bookmarks | `bidirectional` | `--before` / `--since` by tweet ID | Full history available |
| Twitter Timeline | `snapshot` | — | Ephemeral, changes constantly |
| GitHub Stars | `bidirectional` | `?page=N` via gh API | Paginated, stable order |
| GitHub Notifications | `append_only` | `--since` timestamp | New notifications only |
| Reddit Saved | `bidirectional` | `--after` fullname ID | Full history available |
| HN Top/Best/New | `snapshot` | — | Point-in-time ranking |
| YouTube Subscriptions | `snapshot` | — | Current subscription feed |
| Bilibili Favorites | `bidirectional` | Page-based | User's collection |
| Bilibili History | `append_only` | — | Append-only watch log |
| All "feed" types | `snapshot` | — | Algorithmic, not stable |
| All "hot/trending" | `snapshot` | — | Point-in-time ranking |
| All "notifications" | `append_only` | — | Append-only event log |
| Notion Favorites | `bidirectional` | — | User's collection |
| Douban Marks | `bidirectional` | Page-based | User's collection |

**Key insight:** User-curated collections (bookmarks, stars, saves, favorites)
are `bidirectional`. Algorithmic feeds (trending, hot, timeline) are `snapshot`.
Event logs (notifications, history) are `append_only`.

---

## 7. Implementation Plan

### Phase 1: Database & Types (this PR)
- Add `sync_cursors` and `sync_runs` tables to migrations
- Add `SyncCursor`, `SyncRun`, `SyncMode` types
- Extend `SyncStrategy` with `pagination` and `scheduling` fields
- Add `sync_mode` field to `SyncStrategy`
- Add cursor CRUD functions to queries.ts

### Phase 2: SyncEngine Core
- Implement `SyncEngine` class with forward/backfill methods
- Implement cursor management (read/update/reset)
- Implement `SyncScheduler` with timer management
- Wire into `OpenCLIManager` (SyncEngine uses Manager for fetching)

### Phase 3: Strategy Migration
- Classify all 50+ strategies by `SyncMode`
- Add pagination args for bidirectional sources
- Add poll intervals per source category

### Phase 4: UI Integration
- Show backfill progress per source in SourcesPanel
- Add "Pause/Resume Backfill" toggle
- Show sync history (last N sync_runs) per source
- Add manual "Full Refresh" (L2 reconciliation) button

### Phase 5: Reconciliation (Future)
- Implement L1 overlap-based tombstoning
- Implement L2 full reconciliation
- Add `tombstoned` column to captures
- Exclude tombstoned items from search

---

## 8. Configuration Defaults

```typescript
const SYNC_DEFAULTS = {
  /** Forward sync interval for bidirectional sources */
  forwardPollInterval: 15 * 60,     // 15 minutes

  /** Forward sync interval for snapshot sources */
  snapshotPollInterval: 60 * 60,    // 1 hour

  /** Delay between backfill pages */
  backfillPageDelay: 10,            // 10 seconds

  /** Items per page */
  defaultPageSize: 50,

  /** Max consecutive errors before pausing auto-sync */
  maxConsecutiveErrors: 5,

  /** Base backoff delay on error */
  errorBackoffBase: 60,             // 1 minute

  /** Overlap buffer for forward sync */
  forwardOverlapBuffer: 5,
}
```

---

## 9. Observability

The `sync_runs` table provides full audit trail:
- Which source synced, when, in which direction
- How many items fetched/added/updated
- Cursor progression over time
- Error messages for failed runs

This enables:
- **Sync health dashboard**: "Twitter Bookmarks: last synced 5 min ago, 2,340 items"
- **Error alerting**: "Reddit Saved has failed 3 times in a row"
- **Progress tracking**: "Backfill: 60% complete (3,000 of ~5,000 items)"

---

## 10. Summary

| Concern | Solution |
|---------|----------|
| New content | Forward cursor + scheduled polling |
| Historical content | Backward cursor + background backfill |
| Crash recovery | Cursors persisted per-page in SQLite |
| Duplicates | Idempotent upsert by platform_id |
| Deletions | Tiered: ignore (default) → tombstone → full reconciliation |
| Rate limits | Exponential backoff with jitter |
| Non-paginated sources | Snapshot mode (replace on each sync) |
| Large histories | Incremental backfill with progress tracking |
| Content mutations | Natural upsert on re-encounter |
| Clock skew | UTC normalization + ID-based cursors |
