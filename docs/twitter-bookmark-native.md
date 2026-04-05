# Twitter Bookmark Native Support

## Background

Spool currently fetches Twitter bookmarks via OpenCLI (`opencli twitter bookmarks -f json`). This works but depends on an external CLI tool and its browser bridge, adding friction and a layer of indirection.

[fieldtheory-cli](https://github.com/afar1/fieldtheory-cli) is a standalone CLI that syncs X/Twitter bookmarks locally using X's internal GraphQL API, authenticated via Chrome cookie extraction. It's battle-tested, handles rate limiting, pagination, and Chrome DB encryption edge cases well.

Goal: replace the OpenCLI-based Twitter bookmark sync with a native implementation based on fieldtheory-cli's approach, removing the OpenCLI dependency for Twitter entirely.

---

## Decision: Hybrid Copy + Rewrite

### Copy (nearly verbatim)

| File | Lines | Reason |
|------|-------|--------|
| `chrome-cookies.ts` | ~230 | Security-sensitive crypto (AES-128-CBC, PBKDF2, macOS Keychain). Handles locked DB, Chrome version differences, multiple browser variants. No benefit to rewriting. |
| GraphQL fetch + parse from `graphql-bookmarks.ts` | ~250 | X's internal API: query ID, feature flags, response shape parsing (`convertTweetToRecord`, `parseBookmarksResponse`), retry with exponential backoff, rate limit (429) handling, cursor pagination. Getting this right requires exact knowledge of their response format. |

### Rewrite (adapt to spool architecture)

| Component | Reason |
|-----------|--------|
| Storage layer | fieldtheory uses JSONL cache + `sql.js`. Spool has `better-sqlite3` with `captures` table + FTS5. Tweets go into `captures` like any other source. |
| Sync orchestration | New `TwitterBookmarkManager` class paralleling `OpenCLIManager`, writing directly to spool's DB. |
| Type mapping | Map fieldtheory's `BookmarkRecord` to spool's `CapturedItem` at the boundary. |

### Skip entirely

- OAuth flow (`bookmarks.ts`, `xauth.ts`) -- GraphQL via Chrome cookies is sufficient for macOS
- Classification system (`bookmark-classify.ts`, `bookmark-classify-llm.ts`) -- spool has its own FTS search
- JSONL cache layer -- unnecessary when writing directly to SQLite
- `sql.js` / `sql.js-fts5` dependency -- spool uses `better-sqlite3`
- Viz/stats/sample/domains CLI commands -- not in scope

### Remove from spool

- Twitter-related OpenCLI strategies (`twitter bookmarks`, `timeline`, `notifications`, `following`) from `strategies.ts`
- Any existing Twitter bookmark data in the DB (no backward compatibility needed)

---

## Target Architecture

```
packages/core/src/twitter/
├── chrome-cookies.ts    -- copied from fieldtheory (minimal adaptation)
├── graphql-fetch.ts     -- copied: fetch, parse, retry, pagination logic
├── manager.ts           -- new: TwitterBookmarkManager
└── types.ts             -- internal BookmarkRecord subset
```

### TwitterBookmarkManager

Responsibilities:
1. Extract Chrome cookies (macOS only for now)
2. Fetch bookmarks via GraphQL with cursor pagination
3. Parse tweet responses into `BookmarkRecord`
4. Convert `BookmarkRecord` -> `CapturedItem`
5. Insert/upsert into existing `captures` table (dedup by `platform_id`)
6. Emit progress events (same pattern as `OpenCLIManager`)
7. Track sync state (incremental sync: stop at newest known bookmark)

Interface sketch:

```typescript
class TwitterBookmarkManager {
  constructor(db: Database.Database, onProgress?: ProgressCallback)

  /** Check if Chrome cookies are available for X. */
  checkAuth(opts?: { chromeProfileDirectory?: string }): AuthStatus

  /** Sync bookmarks from X via GraphQL. */
  syncBookmarks(opts?: SyncOptions): Promise<SyncResult>
}
```

### Integration Points

- **Electron IPC**: `twitter:check-auth`, `twitter:sync-bookmarks` handlers alongside existing `opencli:*` handlers
- **Sync worker**: Called from the background sync worker, same as OpenCLI sync
- **CLI**: `spool sync` includes Twitter bookmark sync automatically when auth is available
- **Core exports**: `TwitterBookmarkManager` exported from `@spool/core`

### CapturedItem Mapping

```
BookmarkRecord.tweetId       -> CapturedItem.platformId
BookmarkRecord.url           -> CapturedItem.url
BookmarkRecord.text          -> CapturedItem.contentText
BookmarkRecord.authorHandle  -> CapturedItem.author
"twitter"                    -> CapturedItem.platform
BookmarkRecord.tweetId       -> CapturedItem.platformId
"tweet"                      -> CapturedItem.contentType
BookmarkRecord.authorProfileImageUrl -> CapturedItem.thumbnailUrl
{ engagement, media, links, author, language, ... } -> CapturedItem.metadata (JSON)
BookmarkRecord.postedAt      -> CapturedItem.capturedAt
full BookmarkRecord JSON     -> CapturedItem.rawJson
```

---

## Open Questions (UX/Product)

> To be discussed before implementation.

- How should the Twitter sync be surfaced in the UI? Separate from OpenCLI sources or unified?
- What does the first-run auth flow look like? (Chrome must be logged into X)
- Should sync be automatic on app launch, or manual trigger only?
- How to handle auth failures gracefully in the desktop app?
- Should we show Twitter-specific metadata (engagement counts, media previews) in search results?
- Chrome profile selection UX -- how does the user pick which Chrome profile to use?

---

## Dependencies

No new npm dependencies required. All functionality uses Node.js built-ins:
- `node:crypto` (PBKDF2, AES decryption)
- `node:child_process` (sqlite3 CLI for Chrome DB, macOS Keychain)
- `node:fs`, `node:os`, `node:path`
- Native `fetch` (Node 18+)
