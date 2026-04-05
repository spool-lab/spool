# Connector & Sync Architecture

## Overview

This document defines the architecture for Spool's data source connectors and the universal sync engine that drives them. The goal is to replace the current OpenCLI-centric approach with a plugin-based connector model, starting with native Twitter Bookmark support.

Reference implementation: [fieldtheory-cli](https://github.com/afar1/fieldtheory-cli)

---

## Data Ownership Model

Not all platform data is equal. Spool distinguishes two kinds:

| Kind | Description | Sync strategy | Examples |
|------|-------------|---------------|----------|
| **User-owned** | Data the user created, saved, or explicitly curated | Persistent dual-frontier sync | Bookmarks, stars, saved posts, favorites, published content, reviews, following lists, watch history |
| **Ephemeral** | Public/trending data not tied to user actions | Full-replace cache | Hot topics, trending, rankings, explore feeds, frontpage |

Only user-owned data warrants the full local-first sync treatment. Ephemeral data can be fetched on demand and discarded/re-fetched freely.

### Classification of current OpenCLI strategies

**User-owned (persistent sync):**
- Twitter: bookmarks, following, notifications
- Reddit: saved, upvoted
- YouTube: subscriptions
- GitHub: stars, notifications
- Bilibili: favorite, history, feed, dynamic
- Instagram: saved
- Facebook: notifications, groups
- Notion: favorites, sidebar
- Douban: marks, reviews
- Xiaohongshu: notifications, creator-notes
- Douyin: videos, collections
- Jike: feed, notifications
- TikTok: following, notifications
- V2EX: notifications
- Weibo: feed

**Ephemeral (cache):**
- HN: top, best, new, show, ask, jobs
- Reddit: frontpage, popular
- Bilibili: hot, ranking
- Weibo: hot
- Zhihu: hot
- Xiaohongshu: feed (algorithm-recommended)
- Douban: movie-hot, book-hot, top250
- Substack: feed
- Medium: feed
- Instagram: explore
- TikTok: explore
- V2EX: hot, latest
- DEV.to: top
- Lobsters: hot, newest
- Stack Overflow: hot
- Wikipedia: trending
- Steam: top-sellers

**Gray area (timeline/algorithmic feeds):** Twitter timeline, LinkedIn timeline, Reddit hot, Facebook feed — algorithm-ranked, essentially ephemeral.

---

## Connector Interface

A connector is a self-contained module that knows how to authenticate with and fetch data from one specific source. It does NOT know about scheduling, sync state, or storage — those are handled by the framework.

```typescript
interface Connector {
  /** Unique identifier, e.g. 'twitter-bookmarks' */
  id: string

  /** Platform name for grouping, e.g. 'twitter' */
  platform: string

  /** Human-readable label, e.g. 'X Bookmarks' */
  label: string

  /** Short description for the connector picker */
  description: string

  /** UI color for badges/dots */
  color: string

  /** Whether this is ephemeral (cache) or user-owned (persistent) */
  ephemeral: boolean

  /** Check if authentication is available */
  checkAuth(opts?: Record<string, string>): Promise<AuthStatus>

  /**
   * Fetch one page of data.
   *
   * This is the ONLY method a connector must implement for data fetching.
   * The sync engine calls this repeatedly with cursors to paginate.
   *
   * @param cursor - null for first page, otherwise the cursor from previous page
   * @returns items on this page + cursor for next page (null = no more pages)
   */
  fetchPage(cursor: string | null): Promise<PageResult>
}

interface AuthStatus {
  ok: boolean
  error?: string
  /** Guidance for the user on how to fix auth, e.g. "Log into X in Chrome" */
  hint?: string
}

interface PageResult {
  items: CapturedItem[]
  /** Cursor for the next page. null means no more data in this direction. */
  nextCursor: string | null
}
```

### Example: Twitter Bookmarks Connector

```typescript
class TwitterBookmarksConnector implements Connector {
  id = 'twitter-bookmarks'
  platform = 'twitter'
  label = 'X Bookmarks'
  description = 'Your saved tweets on X'
  color = '#1DA1F2'
  ephemeral = false

  async checkAuth() {
    try {
      extractChromeXCookies(defaultChromeDir, 'Default')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message, hint: 'Log into X in Chrome, then retry.' }
    }
  }

  async fetchPage(cursor: string | null): Promise<PageResult> {
    const cookies = extractChromeXCookies(...)
    const response = await fetchGraphQLBookmarks(cookies, cursor)
    return {
      items: response.records.map(toCaputredItem),
      nextCursor: response.nextCursor ?? null,
    }
  }
}
```

### File structure

```
packages/core/src/connectors/
├── types.ts                     ← Connector, AuthStatus, PageResult interfaces
├── registry.ts                  ← ConnectorRegistry (register, list, get)
├── sync-engine.ts               ← SyncEngine (dual-frontier logic)
├── sync-scheduler.ts            ← SyncScheduler (timing, orchestration)
├── twitter-bookmarks/
│   ├── index.ts                 ← TwitterBookmarksConnector
│   ├── chrome-cookies.ts        ← copied from fieldtheory-cli
│   └── graphql-fetch.ts         ← copied from fieldtheory-cli
├── github-stars/                ← future
│   └── index.ts
└── opencli-generic/             ← wraps OpenCLI as a fallback connector
    └── index.ts
```

---

## Sync Engine: Dual-Frontier Model

The sync engine is platform-agnostic. It takes any `Connector` and manages the sync state.

### Concept

```
[history end] ◄── tail frontier ──── stored data ──── head frontier ──► [newest]
                   (backfill ←)                        (→ forward)
```

Two independent frontiers:

- **Head (forward):** Fetches new items added since last sync. Runs frequently (every 15min). Stops when it encounters already-known items or runs out of pages.
- **Tail (backfill):** Fills in historical data. Runs less frequently (idle time). Stops when it reaches the end of available history or exhausts its page budget.

### Sync State (per connector, stored in DB)

```typescript
interface SyncState {
  connectorId: string

  // Head frontier
  headCursor: string | null      // cursor to resume forward sync
  headItemId: string | null      // platform_id of newest known item

  // Tail frontier
  tailCursor: string | null      // cursor to resume backfill
  tailComplete: boolean          // true = reached end of history

  // Metadata
  lastForwardSyncAt: string | null
  lastBackfillSyncAt: string | null
  totalSynced: number
  consecutiveErrors: number      // for backoff calculation
}
```

### Sync Engine Implementation

```typescript
class SyncEngine {
  constructor(private db: Database.Database) {}

  /**
   * Run a sync cycle for a connector.
   * The engine handles state, dedup, and stop conditions.
   * The connector just fetches pages.
   */
  async sync(connector: Connector, opts?: SyncOptions): Promise<SyncResult> {
    if (connector.ephemeral) {
      return this.syncEphemeral(connector, opts)
    }
    return this.syncPersistent(connector, opts)
  }

  /** Persistent sync: dual-frontier for user-owned data */
  private async syncPersistent(connector, opts): Promise<SyncResult> {
    const state = this.loadState(connector.id)
    let added = 0

    // Phase 1: Forward sync (high priority)
    // Fetch from newest, stop when we hit known items
    if (opts?.direction !== 'backfill') {
      let cursor = null  // start from newest
      let stalePages = 0
      for (let page = 0; page < maxPages; page++) {
        const result = await connector.fetchPage(cursor)
        const { newCount } = this.upsertItems(connector, result.items)
        added += newCount

        if (newCount === 0) stalePages++
        else stalePages = 0

        // Stop conditions
        if (stalePages >= 3) break            // caught up
        if (!result.nextCursor) break          // no more pages
        if (this.hasKnownItem(result.items, state)) break  // overlap

        cursor = result.nextCursor
        await this.delay(opts?.delayMs ?? 600)
      }
      state.headCursor = cursor
      state.lastForwardSyncAt = new Date().toISOString()
    }

    // Phase 2: Backfill (lower priority, budget-limited)
    if (!state.tailComplete && opts?.direction !== 'forward') {
      let cursor = state.tailCursor  // resume from last position
      const backfillBudget = opts?.backfillPages ?? 10
      for (let page = 0; page < backfillBudget; page++) {
        const result = await connector.fetchPage(cursor)
        const { newCount } = this.upsertItems(connector, result.items)
        added += newCount

        if (!result.nextCursor) {
          state.tailComplete = true
          break
        }
        cursor = result.nextCursor
        await this.delay(opts?.delayMs ?? 600)
      }
      state.tailCursor = cursor
      state.lastBackfillSyncAt = new Date().toISOString()
    }

    state.totalSynced += added
    state.consecutiveErrors = 0
    this.saveState(state)
    return { added, total: state.totalSynced }
  }

  /** Ephemeral sync: full-replace for trending/cache data */
  private async syncEphemeral(connector, opts): Promise<SyncResult> {
    // Delete existing items for this connector, fetch fresh
    this.deleteItems(connector.id)
    let cursor = null
    let added = 0
    const maxPages = opts?.maxPages ?? 5
    for (let page = 0; page < maxPages; page++) {
      const result = await connector.fetchPage(cursor)
      this.insertItems(connector, result.items)
      added += result.items.length
      if (!result.nextCursor) break
      cursor = result.nextCursor
    }
    return { added, total: added }
  }
}
```

### Stop conditions for forward sync

The engine stops forward-syncing when ANY of:
1. **Stale pages**: 3 consecutive pages with 0 new items (caught up)
2. **Known overlap**: A fetched item's `platformId` already exists in DB
3. **No cursor**: API returned no `nextCursor` (end of data)
4. **Budget**: Hit `maxPages` limit
5. **Timeout**: Exceeded `maxMinutes`

### CapturedItem dedup

All items go through `insertCapture()` which already deduplicates by `(platform, platform_id)`. The sync engine doesn't need its own dedup logic — it just counts how many were new vs. updated to decide stop conditions.

---

## Sync Scheduler

The scheduler is the orchestration layer that decides WHEN to run syncs. It runs in the Electron background worker thread.

### Design Principles

1. **Connectors don't know about scheduling.** A connector is a pure data fetcher.
2. **Sync engine doesn't know about timing.** It runs one sync cycle when asked.
3. **Scheduler owns the clock.** It decides what to sync, when, and in what order.

### Schedule Configuration

```typescript
interface ScheduleConfig {
  /** Forward sync interval. Default: 15 min */
  forwardIntervalMs: number

  /** Backfill sync interval. Default: 60 min */
  backfillIntervalMs: number

  /** Max connectors syncing concurrently. Default: 1 */
  concurrency: number

  /** Base delay between pages within a sync. Default: 600ms */
  pageDelayMs: number

  /** Max pages per forward sync cycle. Default: 50 */
  forwardMaxPages: number

  /** Max pages per backfill cycle. Default: 10 */
  backfillMaxPages: number

  /** Retry backoff sequence (ms). Default: [1min, 5min, 30min, 2hr] */
  retryBackoffMs: number[]

  /** Max time for a single sync run. Default: 5 min */
  maxMinutesPerRun: number
}

const DEFAULT_SCHEDULE: ScheduleConfig = {
  forwardIntervalMs: 15 * 60_000,    // 15 min
  backfillIntervalMs: 60 * 60_000,   // 1 hr
  concurrency: 1,
  pageDelayMs: 600,
  forwardMaxPages: 50,
  backfillMaxPages: 10,
  retryBackoffMs: [60_000, 300_000, 1_800_000, 7_200_000],
  maxMinutesPerRun: 5,
}
```

### Scheduler Implementation

```typescript
class SyncScheduler {
  private engine: SyncEngine
  private registry: ConnectorRegistry
  private queue: PriorityQueue<SyncJob>
  private running: Map<string, AbortController>
  private timer: NodeJS.Timeout | null

  constructor(engine: SyncEngine, registry: ConnectorRegistry) { ... }

  /** Start the scheduler. Called on app launch. */
  start(): void {
    // 1. Queue immediate forward sync for all enabled connectors
    // 2. Start the tick loop
    this.queueAllForward()
    this.tick()
  }

  /** Stop all syncs and the timer. Called on app quit. */
  stop(): void { ... }

  /** Manually trigger sync for a specific connector. */
  triggerNow(connectorId: string): void {
    this.queue.push({ connectorId, direction: 'forward', priority: 100 })
    this.tick()
  }

  /** The main loop. Runs every few seconds. */
  private async tick(): Promise<void> {
    // 1. Check if any connectors are due for forward sync
    //    (lastForwardSyncAt + forwardIntervalMs < now)
    // 2. Check if any non-complete connectors are due for backfill
    //    (lastBackfillSyncAt + backfillIntervalMs < now)
    // 3. Queue jobs, respecting concurrency limit
    // 4. Run next job from priority queue
    // 5. Schedule next tick
  }

  /** Get status for UI display. */
  getStatus(): SchedulerStatus {
    return {
      connectors: this.registry.list().map(c => ({
        id: c.id,
        label: c.label,
        state: this.engine.loadState(c.id),
        syncing: this.running.has(c.id),
      })),
    }
  }
}
```

### Priority Queue

Jobs are prioritized:

| Priority | Trigger | Description |
|----------|---------|-------------|
| 100 | Manual | User clicked "Sync now" |
| 80 | Launch | First sync after app launch |
| 60 | Wake | Sync after system wake from sleep |
| 40 | Interval | Scheduled forward sync |
| 20 | Backfill | Background history backfill |

Higher priority jobs run first. Only `concurrency` jobs run at once (default: 1 to avoid rate limit issues across platforms).

### Lifecycle Events

| Event | Action |
|-------|--------|
| **App launch** | Queue forward sync for all connectors (priority 80) |
| **System wake** | Queue forward sync for all connectors (priority 60) |
| **Interval tick** | Check which connectors are due, queue at priority 40 |
| **Idle time** | Queue backfill for incomplete connectors (priority 20) |
| **Manual trigger** | Queue specific connector (priority 100) |
| **Auth change** | Re-check auth, queue if newly available |
| **Error** | Exponential backoff: skip connector for `retryBackoffMs[consecutiveErrors]` |
| **App quit** | Graceful stop: finish current page, save state, abort remaining |

### Error Handling & Backoff

```
consecutiveErrors = 0  →  next sync at normal interval
consecutiveErrors = 1  →  wait 1 min before retry
consecutiveErrors = 2  →  wait 5 min
consecutiveErrors = 3  →  wait 30 min
consecutiveErrors ≥ 4  →  wait 2 hr (cap)
```

Auth errors (401/403) are special: the scheduler marks the connector as `needsReauth` and stops scheduling it until the user re-authenticates.

### Checkpoint & Crash Safety

The sync engine writes state to DB after every page (or every N pages for performance). If the app crashes mid-sync:
- Forward sync: may re-fetch some pages, but dedup prevents duplicates
- Backfill: resumes from last saved `tailCursor`
- No data loss, at most some redundant API calls

---

## DB Schema Changes

New table for sync state (replaces `opencli_sources` over time):

```sql
CREATE TABLE IF NOT EXISTS connector_sync_state (
  connector_id   TEXT PRIMARY KEY,
  head_cursor    TEXT,
  head_item_id   TEXT,
  tail_cursor    TEXT,
  tail_complete  INTEGER DEFAULT 0,
  last_forward_sync_at  TEXT,
  last_backfill_sync_at TEXT,
  total_synced   INTEGER DEFAULT 0,
  consecutive_errors    INTEGER DEFAULT 0,
  enabled        INTEGER DEFAULT 1,
  config_json    TEXT    -- per-connector overrides (e.g. chrome profile)
);
```

The existing `captures` table is unchanged. The `opencli_src_id` foreign key becomes optional — native connectors set it to NULL and use `connector_id` in `connector_sync_state` instead.

---

## Integration Points

### Electron Main Process

```typescript
// On app ready
const registry = new ConnectorRegistry()
registry.register(new TwitterBookmarksConnector())
// registry.register(new GitHubStarsConnector())  // future

const engine = new SyncEngine(db)
const scheduler = new SyncScheduler(engine, registry)

// IPC handlers
ipcMain.handle('connector:list', () => registry.list())
ipcMain.handle('connector:check-auth', (_, id) => registry.get(id).checkAuth())
ipcMain.handle('connector:sync-now', (_, id) => scheduler.triggerNow(id))
ipcMain.handle('connector:status', () => scheduler.getStatus())

// Start scheduler in worker thread
scheduler.start()
```

### Worker Thread

The scheduler and engine run in the existing sync worker thread (`sync-worker.ts`), alongside the file-based session syncer. They share the same DB connection.

### CLI

```bash
spool sync                    # forward sync all connectors + session files
spool sync --connector twitter-bookmarks   # sync specific connector
spool sync --backfill         # run backfill for all incomplete connectors
spool status                  # show connector states + sync progress
```

---

## Migration Path

1. **Phase 1**: Implement Connector interface + SyncEngine + TwitterBookmarksConnector. Wire into Electron and CLI. Existing OpenCLI code untouched.
2. **Phase 2**: Implement SyncScheduler. Replace manual sync triggers with scheduled sync.
3. **Phase 3**: Remove Twitter-related OpenCLI strategies. Wrap remaining OpenCLI platforms as `OpenCLIGenericConnector` instances using the same Connector interface.
4. **Phase 4**: Gradually replace high-value OpenCLI strategies with native connectors (GitHub Stars, etc.).

At each phase, existing data can be wiped and re-synced. No backward compatibility needed.
