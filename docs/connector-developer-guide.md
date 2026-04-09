# Connector Developer Guide

> Everything you need to build, test, and publish a Spool connector.

---

## What is a Connector?

A connector is a small npm package that teaches Spool how to fetch data from one platform source. You implement two methods — `checkAuth()` and `fetchPage()` — and the framework handles everything else: scheduling, state persistence, error retries, progress UI, and search indexing.

A connector does NOT:
- Know when it will be called (the scheduler decides)
- Track pagination state (the sync engine manages cursors)
- Write to the database (the engine handles upserts)
- Handle retries or backoff (the scheduler handles this)

Your job is simple: **given a cursor, return one page of items.**

---

## Anatomy of a Connector

### The Interface

```typescript
interface Connector {
  readonly id: string          // Unique ID: 'twitter-bookmarks', 'github-stars'
  readonly platform: string    // Platform grouping: 'twitter', 'github'
  readonly label: string       // Display name: 'X Bookmarks', 'GitHub Stars'
  readonly description: string // One-liner for picker UI
  readonly color: string       // Hex color for badges: '#1DA1F2'
  readonly ephemeral: boolean  // true = cache (full-replace), false = user data (incremental)

  checkAuth(opts?: Record<string, string>): Promise<AuthStatus>
  fetchPage(cursor: string | null): Promise<PageResult>
}
```

### The Six Properties

| Property | Purpose | Example |
|----------|---------|---------|
| `id` | Globally unique across all connectors. Used as DB key, IPC identifier, and npm package suffix. | `'twitter-bookmarks'` |
| `platform` | Groups connectors from the same service. One platform can have multiple connectors (e.g. `twitter-bookmarks`, `twitter-following`). | `'twitter'` |
| `label` | Shown in the connector list and settings UI. Keep it short. | `'X Bookmarks'` |
| `description` | Shown below the label in the connector picker. One sentence. | `'Your saved tweets on X'` |
| `color` | Hex color for the platform dot/badge in the UI. Use the platform's brand color. | `'#1DA1F2'` |
| `ephemeral` | **Critical flag.** Determines sync strategy. See [Ephemeral vs. Persistent](#ephemeral-vs-persistent) below. | `false` |

### The Two Methods

#### `checkAuth(): Promise<AuthStatus>`

Called before each sync cycle and when the user clicks "Connect" in the UI. Returns whether the connector can authenticate with the platform right now.

```typescript
interface AuthStatus {
  ok: boolean
  error?: SyncErrorCode    // Machine-readable error classification
  message?: string         // Technical detail (logged, not shown to user)
  hint?: string            // User-facing guidance: "Log into X in Chrome, then retry."
}
```

**Rules:**
- Must be fast (< 2 seconds). Don't make network requests here — just check if credentials exist locally.
- Always provide a `hint` on failure. The hint is shown directly in the UI. Write it as an instruction the user can act on.
- Never throw. Always return an `AuthStatus` object.

#### `fetchPage(cursor: string | null): Promise<PageResult>`

The core data fetching method. Called repeatedly by the sync engine to paginate through the platform's data.

```typescript
interface PageResult {
  items: CapturedItem[]    // Items on this page
  nextCursor: string | null // Cursor for next page, null = no more data
}
```

**Rules:**
- When `cursor` is `null`, fetch the **newest** page (most recent items first).
- Return `nextCursor: null` when there are no more pages.
- Items should be ordered newest-first within each page (this is how most APIs work naturally).
- Throw `SyncError` on failures. The engine catches it, updates error state, and the scheduler handles backoff.
- Keep pages small-ish (10–25 items). The engine adds a delay between pages to avoid rate limiting.

---

## CapturedItem: The Universal Data Unit

Every item from every connector is normalized into this shape before storage:

```typescript
interface CapturedItem {
  url: string              // Original URL on the platform
  title: string            // Display title
  contentText: string      // Full text content (indexed for search)
  author: string | null    // Author handle or name
  platform: string         // Must match connector.platform
  platformId: string | null // Platform-unique ID (CRITICAL for dedup)
  contentType: string      // 'tweet', 'repo', 'video', 'post', 'page', etc.
  thumbnailUrl: string | null
  metadata: Record<string, unknown>  // Platform-specific extras
  capturedAt: string       // ISO 8601 timestamp from the platform
  rawJson: string | null   // Raw API response for future re-parsing
}
```

### Key Fields Explained

**`platform` + `platformId`** — The deduplication key. The sync engine upserts items by this pair. If two items share the same `(platform, platformId)`, the newer one updates the older one. **Always set `platformId`** to the platform's native ID for the item (tweet ID, repo ID, video ID, etc.).

**`contentText`** — This is what gets full-text indexed. Put the main textual content here: tweet text, repo description, article body, etc. This powers Spool's search.

**`capturedAt`** — Use the platform's timestamp, not the sync time. For a tweet, this is when the tweet was posted. For a GitHub star, this is when the repo was starred. This determines sort order in search results.

**`metadata`** — Extensible JSON bag for anything not covered by the base fields. Common uses:
- Engagement counts: `{ likeCount, repostCount, viewCount }`
- Media attachments: `{ media: [{ type, url, width, height }] }`
- Author details: `{ authorSnapshot: { handle, name, bio, followers } }`
- Platform-specific data: `{ language, conversationId, isVerified }`

The framework automatically adds `metadata.connectorId` — you don't need to set this.

**`rawJson`** — Store the raw API response. This allows re-parsing items when the schema changes, without re-fetching from the platform.

---

## Ephemeral vs. Persistent

The `ephemeral` flag fundamentally changes how the sync engine treats your connector:

### `ephemeral: false` — User-Owned Data (Default)

For data the user created, saved, or curated: bookmarks, stars, saved posts, watch history.

**Sync strategy: Dual-frontier incremental sync.**

```
[oldest] ◄── tail (backfill) ──── stored data ──── head (forward) ──► [newest]
```

- **Forward sync** runs frequently (every 15 min). Fetches from newest, stops when it hits already-known items (3 consecutive pages with 0 new items).
- **Backfill** runs less often (every 60 min). Fills in historical data from where it last stopped, working backwards through time.
- Items are upserted (dedup by `platform + platformId`), never deleted.
- State persists across app restarts: cursors, page counts, error history.

### `ephemeral: true` — Cache Data

For public/trending data not tied to user actions: hot topics, trending repos, rankings.

**Sync strategy: Full-replace.**

- Every sync cycle deletes all existing items for this connector, then fetches fresh.
- No cursor tracking. Always starts from page 1.
- Simpler, but items don't persist between syncs.

---

## Scheduled Sync: How and When Your Connector Runs

You don't control when your connector runs. The **SyncScheduler** handles this automatically.

### Default Schedule

| Parameter | Default | Meaning |
|-----------|---------|---------|
| Forward interval | 15 minutes | How often new items are fetched |
| Backfill interval | 60 minutes | How often historical backfill runs |
| Page delay | 1200ms | Sleep between `fetchPage()` calls (rate limiting) |
| Max minutes per run | 10 minutes | Sync aborts after this (scheduler-initiated only; CLI has no limit) |
| Concurrency | 1 | Only one connector syncs at a time |

The schedule is **global** — all connectors share the same intervals. Per-connector tuning is not currently exposed (but `configJson` in the DB is reserved for this).

### When Does Sync Happen?

| Event | What Happens | Priority |
|-------|-------------|----------|
| App launch | All enabled connectors queue for forward+backfill | 80 |
| System wake | All enabled connectors queue for forward | 60 |
| Every 30 seconds | Scheduler checks which connectors are "due" based on interval | 40 (forward) / 20 (backfill) |
| User clicks "Sync now" | That connector queues immediately | 100 |

Higher priority jobs run first. With concurrency=1, only one connector syncs at a time.

### Error Backoff

When `fetchPage()` throws a `SyncError`, the engine increments `consecutiveErrors` on the connector's state. The scheduler uses this to delay retries:

| Consecutive Errors | Wait Before Retry |
|-------------------|-------------------|
| 0 | Normal interval |
| 1 | 60 seconds |
| 2 | 5 minutes |
| 3 | 30 minutes |
| 4+ | 2 hours (cap) |

On a successful sync, `consecutiveErrors` resets to 0.

**Auth errors are special**: any error code starting with `AUTH_` causes the scheduler to stop retrying entirely. The connector stays disabled until the user manually re-authenticates (clicks "Connect" in the UI, which calls `checkAuth()` again).

### Stop Conditions

The sync engine stops a forward sync when ANY of:
1. **Caught up**: 3 consecutive pages with 0 new items
2. **End of data**: `nextCursor` is `null`
3. **Time limit**: Exceeded `maxMinutes` (10 min for scheduler, unlimited for CLI)
4. **Cancelled**: App is quitting or user aborted
5. **Error**: `fetchPage()` threw

### Progress & Events

The scheduler emits events that flow to the UI in real time:

```typescript
type SchedulerEvent =
  | { type: 'sync-start'; connectorId: string }
  | { type: 'sync-progress'; progress: SyncProgress }
  | { type: 'sync-complete'; result: ConnectorSyncResult }
  | { type: 'sync-error'; connectorId: string; code: SyncErrorCode; message: string }
```

The UI shows: which connector is syncing, current page, items found, phase (forward/backfill).

---

## Error Handling

Connectors signal errors by throwing `SyncError`:

```typescript
import { SyncError } from '@spool/core'

throw new SyncError('API_RATE_LIMITED', 'Got 429, retry after 60s')
throw new SyncError('AUTH_SESSION_EXPIRED', 'Cookie returned 401')
throw new SyncError('NETWORK_OFFLINE')  // message defaults to hint text
```

### Error Code Reference

| Code | When to Use | Framework Behavior |
|------|------------|-------------------|
| `AUTH_CHROME_NOT_FOUND` | Chrome or its cookie DB doesn't exist | Stop scheduling, show "needs setup" |
| `AUTH_NOT_LOGGED_IN` | Platform cookies missing (user not logged in) | Stop scheduling, show "log in" hint |
| `AUTH_COOKIE_DECRYPT_FAILED` | OS-level decryption failed | Stop scheduling |
| `AUTH_KEYCHAIN_DENIED` | macOS Keychain access denied | Stop scheduling |
| `AUTH_SESSION_EXPIRED` | 401/403 from platform API | Stop scheduling, show "re-authenticate" |
| `API_RATE_LIMITED` | 429 response | Retry with backoff |
| `API_SERVER_ERROR` | 5xx response | Retry with backoff |
| `NETWORK_OFFLINE` | DNS/connection failure | Retry with backoff |
| `NETWORK_TIMEOUT` | Request timed out | Retry with backoff |
| `API_PARSE_ERROR` | Response shape doesn't match expected schema | No retry (likely a breaking API change) |
| `CONNECTOR_ERROR` | Anything else | No retry |

**Rule of thumb**: Use `AUTH_*` codes for anything that requires user action to fix. Use `API_*`/`NETWORK_*` codes for transient issues the framework can retry.

---

## Authentication Patterns

The `Connector` interface doesn't prescribe how authentication works — it only requires that `checkAuth()` returns an `AuthStatus`. This gives you flexibility to implement whatever auth pattern your platform needs.

### Pattern 1: Chrome Cookie Extraction (Recommended)

Used by Twitter Bookmarks. Reads encrypted cookies directly from Chrome's SQLite database on macOS. **No user interaction needed** — if the user is logged into the platform in Chrome, it just works.

```typescript
async checkAuth(): Promise<AuthStatus> {
  try {
    const cookies = extractChromeCookies('.example.com', ['session_id', 'csrf_token'])
    return { ok: true }
  } catch (e) {
    if (e instanceof SyncError) {
      return { ok: false, error: e.code, message: e.message, hint: e.hint }
    }
    return { ok: false, error: 'AUTH_UNKNOWN', hint: 'Check that Chrome is installed and you are logged in.' }
  }
}

async fetchPage(cursor: string | null): Promise<PageResult> {
  const cookies = extractChromeCookies('.example.com', ['session_id', 'csrf_token'])
  const response = await fetch('https://api.example.com/bookmarks', {
    headers: { Cookie: cookies.cookieHeader }
  })
  // ... parse response
}
```

**Pros**: Zero friction, no OAuth flow, works with any platform the user is logged into.
**Cons**: macOS only (for now), requires Chrome, cookies can expire mid-sync.

**Shared utility**: The Twitter Bookmarks connector includes a `chrome-cookies.ts` module with macOS Keychain integration, AES-128-CBC decryption, and Chrome DB version handling. Other cookie-based connectors can reuse or adapt this code.

### Pattern 2: CLI Tool Delegation

Used when a well-maintained CLI tool already exists for the platform (e.g., `gh` for GitHub). The connector shells out to the CLI instead of making direct API calls.

```typescript
async checkAuth(): Promise<AuthStatus> {
  try {
    const { stdout } = await execAsync('gh auth status')
    return { ok: true }
  } catch {
    return { ok: false, hint: 'Run `gh auth login` in your terminal.' }
  }
}

async fetchPage(cursor: string | null): Promise<PageResult> {
  const page = cursor ? parseInt(cursor) : 1
  const { stdout } = await execAsync(`gh api /user/starred?per_page=30&page=${page}`)
  const repos = JSON.parse(stdout)
  return {
    items: repos.map(repoToCapturedItem),
    nextCursor: repos.length === 30 ? String(page + 1) : null,
  }
}
```

**Pros**: Leverages existing auth flows (OAuth tokens managed by the CLI), well-tested API wrappers.
**Cons**: Requires the CLI to be installed, subprocess overhead, output parsing can be brittle.

### Pattern 3: API Token / Config File

For platforms that use API keys, tokens, or config files. The token is stored in the connector's `configJson` field in the DB, or read from a well-known config file path.

```typescript
async checkAuth(): Promise<AuthStatus> {
  const config = this.loadConfig()  // from configJson or ~/.config/myplatform/token
  if (!config?.apiToken) {
    return { ok: false, hint: 'Set your API token in Spool connector settings.' }
  }
  return { ok: true }
}
```

### Pattern 4: No Auth Required

For public data sources (RSS feeds, public APIs). Just return `{ ok: true }`.

```typescript
async checkAuth(): Promise<AuthStatus> {
  return { ok: true }
}
```

### Auth Design Guidelines

1. **`checkAuth()` must be fast** — no network calls. Check if credentials exist, not if they're valid.
2. **Always provide a `hint`** — this is shown to the user in the UI. Make it actionable.
3. **Never store secrets in code** — use Chrome cookies, CLI auth, or per-connector `configJson`.
4. **Handle expiration gracefully** — if a 401/403 comes during `fetchPage()`, throw `SyncError('AUTH_SESSION_EXPIRED')`. The framework will stop scheduling and surface it in the UI.

---

## Building a Connector: Step by Step

### 1. Create the Package

```bash
mkdir spool-lab-connector-github-stars
cd spool-lab-connector-github-stars
npm init -y
```

Edit `package.json`:

```json
{
  "name": "@spool-lab/connector-github-stars",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "spool": {
    "type": "connector",
    "id": "github-stars",
    "platform": "github",
    "label": "GitHub Stars",
    "description": "Repos you've starred on GitHub",
    "color": "#333333",
    "ephemeral": false
  },
  "peerDependencies": {
    "@spool/core": "^0.x"
  }
}
```

The `spool` field is the connector manifest. The app reads this to display connector metadata in the UI and on the spool.pro directory page, without loading the module.

### 2. Implement the Connector

```typescript
// src/index.ts
import type { Connector, AuthStatus, PageResult, CapturedItem } from '@spool/core'
import { SyncError } from '@spool/core'
import { execSync } from 'node:child_process'

export default class GitHubStarsConnector implements Connector {
  readonly id = 'github-stars'
  readonly platform = 'github'
  readonly label = 'GitHub Stars'
  readonly description = 'Repos you\'ve starred on GitHub'
  readonly color = '#333333'
  readonly ephemeral = false

  async checkAuth(): Promise<AuthStatus> {
    try {
      execSync('gh auth status', { stdio: 'pipe' })
      return { ok: true }
    } catch {
      return {
        ok: false,
        error: 'AUTH_NOT_LOGGED_IN',
        hint: 'Install GitHub CLI and run `gh auth login` in your terminal.',
      }
    }
  }

  async fetchPage(cursor: string | null): Promise<PageResult> {
    const page = cursor ? parseInt(cursor) : 1
    const perPage = 30

    let stdout: string
    try {
      const result = execSync(
        `gh api /user/starred?per_page=${perPage}&page=${page} -H "Accept: application/vnd.github.v3.star+json"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      )
      stdout = result
    } catch (e: any) {
      if (e.status === 401) throw new SyncError('AUTH_SESSION_EXPIRED')
      if (e.status === 429) throw new SyncError('API_RATE_LIMITED')
      throw new SyncError('CONNECTOR_ERROR', e.message)
    }

    const starred = JSON.parse(stdout)
    const items: CapturedItem[] = starred.map((entry: any) => ({
      url: entry.repo.html_url,
      title: entry.repo.full_name,
      contentText: entry.repo.description ?? '',
      author: entry.repo.owner.login,
      platform: 'github',
      platformId: String(entry.repo.id),
      contentType: 'repo',
      thumbnailUrl: entry.repo.owner.avatar_url,
      metadata: {
        language: entry.repo.language,
        stars: entry.repo.stargazers_count,
        forks: entry.repo.forks_count,
        topics: entry.repo.topics,
      },
      capturedAt: entry.starred_at,  // when YOU starred it, not when repo was created
      rawJson: JSON.stringify(entry),
    }))

    return {
      items,
      nextCursor: starred.length === perPage ? String(page + 1) : null,
    }
  }
}
```

### 3. Declare the Manifest

The `spool` field in `package.json` (shown above) must include:

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Always `"connector"` |
| `id` | Yes | Must match `connector.id` in code |
| `platform` | Yes | Must match `connector.platform` in code |
| `label` | Yes | Display name |
| `description` | Yes | One-line description |
| `color` | Yes | Hex color for UI |
| `ephemeral` | Yes | Sync strategy flag |

### 4. Test Locally

During development, install your connector locally:

```bash
cd ~/.spool/connectors
npm install /path/to/your/spool-lab-connector-github-stars
```

Restart the Spool app. Your connector should appear in the Sources panel. Or test via CLI:

```bash
spool connector sync github-stars
```

### 5. Publish

```bash
npm publish --access public
```

Users install via:
```bash
# From Spool app UI (future), or manually:
cd ~/.spool/connectors && npm install @spool-lab/connector-github-stars
```

---

## What Happens at Runtime

Here's the full lifecycle of a connector, from installation to search results:

```
1. DISCOVERY
   App starts → scans ~/.spool/connectors/node_modules/@spool-lab/connector-*
   → require() each → new ConnectorClass() → registry.register(connector)

2. SCHEDULING
   SyncScheduler.start() → queues all enabled connectors (priority 80)
   → tick() every 30s checks which connectors are "due"
   → dequeues highest priority job → calls SyncEngine.sync()

3. SYNC CYCLE (for persistent connectors)
   SyncEngine.sync(connector)
     → loadState() from connector_sync_state table
     → FORWARD PHASE: fetchPage(null) → fetchPage(cursor1) → ... → stop on stale
     → BACKFILL PHASE: fetchPage(tailCursor) → ... → stop on budget or end
     → saveState() with updated cursors

4. ITEM PROCESSING (per page)
   For each item in PageResult:
     → tag with metadata.connectorId
     → upsert by (platform, platformId) into captures table
     → FTS trigger auto-indexes title + contentText

5. EVENTS
   sync-start → sync-progress (per page) → sync-complete
   → forwarded via IPC to renderer → UI updates in real time

6. SEARCH
   User searches → FTS5 query on captures_fts → results include connector items
   → shown alongside Claude Code sessions in unified results
```

### Database Tables Your Data Touches

| Table | What's Stored | Who Writes |
|-------|--------------|------------|
| `captures` | Your items (one row per CapturedItem) | SyncEngine |
| `captures_fts` | Full-text index on title + contentText | SQLite trigger (automatic) |
| `connector_sync_state` | Cursors, error counts, timestamps, enabled flag | SyncEngine |

You never interact with these tables directly. The framework handles all reads and writes.

---

## FAQ

### Can I make network requests in `checkAuth()`?

Avoid it. `checkAuth()` is called from the UI thread and should return in under 2 seconds. Check if credentials exist locally (cookies in Chrome DB, CLI auth status, config file). Don't validate them against the remote API — that's what `fetchPage()` is for.

### What if my platform doesn't use cursor-based pagination?

Use page numbers as cursor strings: return `nextCursor: String(page + 1)` and parse with `parseInt(cursor)`. See the GitHub Stars example above.

### What if my platform returns items oldest-first?

The sync engine expects newest-first for forward sync to work correctly (it stops when it hits known items). If your API returns oldest-first, you may need to reverse the response or use `ephemeral: true`.

### How do I store per-connector settings (e.g., which Chrome profile to use)?

The `configJson` field in `connector_sync_state` is available for this. Access it via the constructor options pattern used by Twitter Bookmarks:

```typescript
constructor(private opts?: { chromeProfileDirectory?: string }) {}
```

Settings UI is not yet standardized — for now, pass options at registration time.

### What's the difference between a native connector and wrapping an external CLI?

| | Native (e.g., Twitter Bookmarks) | CLI Wrapper (e.g., GitHub Stars via `gh`) |
|--|---|---|
| **Auth** | Reads Chrome cookies directly | Delegates to CLI's auth (`gh auth login`) |
| **Data fetching** | Direct HTTP/GraphQL calls | Shells out to CLI, parses stdout |
| **Dependencies** | None (Node.js built-ins only) | Requires external CLI installed |
| **Performance** | Fast, no subprocess overhead | Subprocess per page |
| **Pagination control** | Full control over cursors and page size | Limited to CLI's pagination options |
| **Error handling** | Precise: can distinguish 429/401/5xx | Limited: parse stderr or exit codes |

Both implement the same `Connector` interface. The framework doesn't care how `fetchPage()` gets its data. Choose native for high-volume connectors or platforms where you need fine-grained control. Choose CLI wrappers when a good CLI already exists and volume is low.
