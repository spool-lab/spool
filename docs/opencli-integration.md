# OpenCLI Integration \u2014 Technical Design

> Integrating [OpenCLI](https://github.com/jackwener/opencli) into Spool to pull personal data from 50+ platforms and support one-off URL captures.

## Why

Spool currently indexes only local agent sessions (Claude Code, Codex). Users' "personal knowledge" lives across dozens of platforms \u2014 Twitter bookmarks, GitHub stars, YouTube likes, Reddit saves, HN favorites, Zhihu collections, and more. OpenCLI bridges this gap: it reuses existing Chrome login sessions via a Browser Bridge extension to pull structured data from 50+ platforms, with no API keys or OAuth tokens needed.

This integration adds three capabilities:
1. **Add Source** \u2014 connect platform data feeds (e.g., Twitter bookmarks) for periodic sync
2. **Capture URL** (\u2318K) \u2014 paste any URL, preview it, fetch & index via `opencli generate <url>`
3. **Onboarding** \u2014 guided setup for opencli CLI installation + Browser Bridge extension

---

## 1. Data Model

### Problem

OpenCLI data (bookmarks, stars, captures) doesn't fit the existing `sessions` \u2192 `messages` model. A tweet bookmark is a single item, not a conversation. We need a parallel `captures` table unified with existing data at the FTS search layer.

### Schema Additions (`packages/core/src/db/db.ts`)

Add to `runMigrations`:

```sql
-- Register opencli as a source alongside claude/codex
INSERT OR IGNORE INTO sources (name, base_path) VALUES
  ('opencli', '~/.spool/opencli');

-- Platform configurations (which feeds the user has connected)
CREATE TABLE IF NOT EXISTS opencli_sources (
  id          INTEGER PRIMARY KEY,
  source_id   INTEGER NOT NULL REFERENCES sources(id),
  platform    TEXT NOT NULL,            -- 'twitter', 'github', 'youtube', ...
  command     TEXT NOT NULL,            -- 'twitter bookmarks', 'github stars', ...
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_synced TEXT,
  sync_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (platform, command)
);

-- Captured items (bookmarks, stars, URL captures, etc.)
CREATE TABLE IF NOT EXISTS captures (
  id              INTEGER PRIMARY KEY,
  source_id       INTEGER NOT NULL REFERENCES sources(id),
  opencli_src_id  INTEGER REFERENCES opencli_sources(id),  -- NULL for one-off URL captures
  capture_uuid    TEXT NOT NULL UNIQUE,
  url             TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  content_text    TEXT NOT NULL DEFAULT '',
  author          TEXT,
  platform        TEXT NOT NULL,            -- 'twitter', 'github', 'youtube', ...
  platform_id     TEXT,                     -- platform-specific ID for dedup
  content_type    TEXT NOT NULL DEFAULT 'page',  -- 'tweet', 'repo', 'video', 'post', 'page'
  thumbnail_url   TEXT,
  metadata        TEXT NOT NULL DEFAULT '{}',    -- JSON blob for platform-specific data
  captured_at     TEXT NOT NULL,
  indexed_at      TEXT NOT NULL DEFAULT (datetime('now')),
  raw_json        TEXT
);

CREATE INDEX IF NOT EXISTS idx_captures_source   ON captures(source_id);
CREATE INDEX IF NOT EXISTS idx_captures_platform ON captures(platform);
CREATE INDEX IF NOT EXISTS idx_captures_url      ON captures(url);
CREATE INDEX IF NOT EXISTS idx_captures_captured ON captures(captured_at DESC);

-- FTS for captures (same tokenizer as messages_fts)
CREATE VIRTUAL TABLE IF NOT EXISTS captures_fts USING fts5(
  title,
  content_text,
  content='captures',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 1'
);

CREATE TRIGGER IF NOT EXISTS captures_fts_insert
AFTER INSERT ON captures BEGIN
  INSERT INTO captures_fts(rowid, title, content_text)
    VALUES(NEW.id, NEW.title, NEW.content_text);
END;

CREATE TRIGGER IF NOT EXISTS captures_fts_delete
AFTER DELETE ON captures BEGIN
  INSERT INTO captures_fts(captures_fts, rowid, title, content_text)
    VALUES('delete', OLD.id, OLD.title, OLD.content_text);
END;

-- Persisted setup state (survives app restarts)
CREATE TABLE IF NOT EXISTS opencli_setup (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### Type Additions (`packages/core/src/types.ts`)

```typescript
export type Source = 'claude' | 'codex' | 'opencli'

export interface CaptureResult {
  rank: number
  captureId: number
  captureUuid: string
  url: string
  title: string
  snippet: string
  platform: string
  contentType: string
  author: string | null
  capturedAt: string
}

export interface OpenCLISource {
  id: number
  sourceId: number
  platform: string
  command: string
  enabled: boolean
  lastSynced: string | null
  syncCount: number
}

export interface OpenCLISetupStatus {
  cliInstalled: boolean
  cliVersion: string | null
  browserBridgeReady: boolean
  chromeRunning: boolean
}

// Unified search result (discriminated union)
export type SearchResult =
  | (FragmentResult & { kind: 'fragment' })
  | (CaptureResult & { kind: 'capture' })
```

### Unified Search (`packages/core/src/db/queries.ts`)

```typescript
export function searchCaptures(
  db: Database.Database,
  query: string,
  opts: { limit?: number; platform?: string; since?: string },
): CaptureResult[] { /* FTS5 query against captures_fts */ }

export function searchAll(
  db: Database.Database,
  query: string,
  opts: { limit?: number; source?: string; since?: string },
): SearchResult[] {
  const fragments = searchFragments(db, query, opts)
    .map(f => ({ ...f, kind: 'fragment' as const }))
  const captures = searchCaptures(db, query, opts)
    .map(c => ({ ...c, kind: 'capture' as const }))
  return [...fragments, ...captures]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, opts.limit ?? 20)
}
```

---

## 2. OpenCLI Manager

**Location:** `packages/core/src/opencli/manager.ts`
**Shared util:** `packages/core/src/util/resolve-bin.ts` (extracted from `packages/app/src/main/acp.ts` `resolveGlobalBin` pattern)

Lives in `@spool/core` so both Electron app and CLI can use it.

```typescript
export class OpenCLIManager {
  // --- Setup & Detection ---
  async checkSetup(): Promise<OpenCLISetupStatus>
  // Runs `which opencli`, `opencli --version`, checks bridge status

  async installCli(): Promise<{ ok: boolean; error?: string }>
  // Runs `npm install -g @jackwener/opencli`

  // --- Source Sync ---
  async listAvailablePlatforms(): Promise<PlatformInfo[]>
  // Runs `opencli list -f json`, returns platform names + commands

  async syncSource(platform: string, command: string): Promise<CapturedItem[]>
  // Runs `opencli <platform> <command> -f json`
  // Deduplicates by platform_id against existing captures

  // --- URL Capture ---
  async captureUrl(url: string): Promise<CapturedItem>
  // Runs `opencli generate <url> -f json`

  // --- Internal ---
  private exec(args: string[], timeout?: number): Promise<string>
  // Spawns opencli with resolved binary path
  // Handles nvm/fnm/GUI context (reuse resolveGlobalBin)
  // Default timeout: 60s sync, 30s capture
}
```

**Parser** (`packages/core/src/opencli/parser.ts`): normalizes OpenCLI's JSON output into `CapturedItem` for DB insertion. Handles platform-specific field mapping (tweet text, repo description, video title, etc.).

---

## 3. IPC Layer

### New Channels (`packages/app/src/main/index.ts`)

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `opencli:check-setup` | invoke | Check CLI + bridge readiness |
| `opencli:install-cli` | invoke | Trigger `npm install -g` |
| `opencli:available-platforms` | invoke | List all platforms from `opencli list` |
| `opencli:add-source` | invoke | Register a platform+command to sync |
| `opencli:remove-source` | invoke | Remove a configured source |
| `opencli:list-sources` | invoke | Get all configured OpenCLI sources with stats |
| `opencli:sync-source` | invoke | Sync a specific source |
| `opencli:sync-all-sources` | invoke | Sync all enabled sources |
| `opencli:capture-url` | invoke | One-off URL capture |
| `opencli:capture-progress` | send\u2192renderer | Progress events during capture/sync |
| `spool:search` | invoke | **Modified** \u2014 calls `searchAll()` for unified results |

### Preload API (`packages/app/src/preload/index.ts`)

```typescript
opencli: {
  checkSetup: (): Promise<OpenCLISetupStatus> =>
    ipcRenderer.invoke('opencli:check-setup'),
  installCli: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('opencli:install-cli'),
  availablePlatforms: (): Promise<PlatformInfo[]> =>
    ipcRenderer.invoke('opencli:available-platforms'),
  addSource: (platform: string, command: string): Promise<{ ok: boolean; id: number }> =>
    ipcRenderer.invoke('opencli:add-source', { platform, command }),
  removeSource: (id: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('opencli:remove-source', { id }),
  listSources: (): Promise<OpenCLISource[]> =>
    ipcRenderer.invoke('opencli:list-sources'),
  syncSource: (id: number): Promise<{ ok: boolean; count: number }> =>
    ipcRenderer.invoke('opencli:sync-source', { id }),
  captureUrl: (url: string): Promise<{ ok: boolean; capture?: CaptureResult }> =>
    ipcRenderer.invoke('opencli:capture-url', { url }),
  onCaptureProgress: (cb: (e: { phase: string; message: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) =>
      cb(data as { phase: string; message: string })
    ipcRenderer.on('opencli:capture-progress', handler)
    return () => ipcRenderer.removeListener('opencli:capture-progress', handler)
  },
}
```

---

## 4. UI Components

### 4A. Onboarding (`OnboardingFlow.tsx`)

Multi-step wizard, triggered from "+ Connect" chip when OpenCLI is not yet set up.

**Steps:**
1. **Welcome** \u2014 "Connect your data sources" \u2014 explain OpenCLI pulls from 50+ platforms using existing browser sessions
2. **Install CLI** \u2014 show `npm install -g @jackwener/opencli` with copy button, auto-detect installation via polling `opencli:check-setup`
3. **Browser Bridge** \u2014 guide Chrome extension install, link to release/store, verify connection
4. **Done** \u2014 success checkmark, CTA "Add your first source"

**Design:**
- Warm amber accent on CTAs, step dots as progress indicators
- Geist Mono for terminal commands
- Setup status persisted in `opencli_setup` table \u2014 don't re-show if complete

### 4B. Sources Panel (`SourcesPanel.tsx`)

Slide-over panel showing all data sources:

- **Agent Sessions** (always on): Claude Code, Codex \u2014 show counts, auto-synced
- **Connected Platforms**: each added OpenCLI source with toggle, last-synced, count
- **Add Source**: platform picker grid from `opencli list`

```
[\u25cf] Your Twitter bookmarks    142 items \u00b7 synced 2h ago    [Sync] [\u00d7]
[\u25cf] Your GitHub stars           87 items \u00b7 synced 1d ago    [Sync] [\u00d7]
```

First-person framing per DESIGN.md.

### 4C. Capture URL Modal (`CaptureUrlModal.tsx`)

Triggered by **\u2318K**. Layout per the mockup screenshot:

1. Title: "Capture a URL"
2. Subtitle: "Paste any link \u2014 Spool will fetch and index it via OpenCLI."
3. URL input (Geist Mono, auto-focus)
4. Preview card (debounced): favicon + title + domain + platform badge
5. Buttons: Cancel (secondary) + "Capture & Index" (amber primary)
6. Divider + "Supported via OpenCLI" + platform chips

**Behavior:**
- Platform auto-detected from URL domain
- Capture triggers `opencli:capture-url`, button shows spinner then checkmark
- If OpenCLI not set up, redirect to onboarding
- Shortcut: register \u2318K in Electron menu accelerator

### 4D. HomeView Updates (`HomeView.tsx`)

- SourceChips: dynamically render all configured sources (claude, codex, + each OpenCLI platform)
- "+ Connect" chip: opens SourcesPanel (or OnboardingFlow if not set up)
- Platform badge colors: Twitter `#1DA1F2`, GitHub `#333`/`#E6EDF3`, YouTube `#FF0000`, Reddit `#FF4500`, HN `#FF6600`

### 4E. Search Results (`FragmentResults.tsx`)

- Handle `SearchResult` union type (fragment vs capture)
- Capture results: title, snippet, platform badge, first-person label ("You bookmarked this"), URL in Geist Mono
- Filter tabs: All | Sessions | Captures
- "via OpenCLI" attribution label on capture results

### 4F. Capture Detail (`CaptureDetail.tsx`)

- Full `content_text` display
- Metadata: author, platform, original URL (clickable)
- "Open Original" button \u2192 `shell.openExternal(url)`
- "via OpenCLI" label

---

## 5. CLI Additions (`packages/cli/src/index.ts`)

```
spool capture <url>                       # One-off URL capture
spool sources                             # List configured sources + stats
spool sources add <platform> <command>    # Add a new source
spool sources sync [platform]             # Sync one or all sources
spool sources remove <id>                 # Remove a source
```

---

## 6. Implementation Phases

| Phase | Description | Key Files |
|-------|-------------|-----------|
| **1** | Core data model: types, schema, queries | `core/src/types.ts`, `core/src/db/db.ts`, `core/src/db/queries.ts` |
| **2** | OpenCLI Manager: binary wrapper, parser, resolve-bin | `core/src/opencli/manager.ts`, `core/src/opencli/parser.ts`, `core/src/util/resolve-bin.ts` |
| **3** | Electron IPC: handlers + preload | `app/src/main/index.ts`, `app/src/preload/index.ts` |
| **4** | Onboarding UI | `app/src/renderer/components/OnboardingFlow.tsx` |
| **5** | Sources Panel + HomeView updates | `app/src/renderer/components/SourcesPanel.tsx`, `HomeView.tsx` |
| **6** | Capture URL Modal + \u2318K shortcut | `app/src/renderer/components/CaptureUrlModal.tsx` |
| **7** | Search integration | `FragmentResults.tsx`, `CaptureDetail.tsx` |
| **8** | CLI commands | `cli/src/index.ts` |

---

## 7. Verification

1. **Unit tests**: parser fixtures for Twitter, GitHub, YouTube JSON output
2. **DB tests**: `captures_fts` returns results, `searchAll` merges correctly
3. **Integration**: mock `opencli` binary, verify capture \u2192 index \u2192 search flow
4. **Manual E2E**:
   - "+ Connect" \u2192 onboarding wizard completes
   - Add Twitter bookmarks \u2192 sync \u2192 items in search
   - \u2318K \u2192 paste URL \u2192 capture \u2192 searchable
   - `spool capture <url>` from terminal
   - `spool sources` shows configured feeds
5. **Design QA**: warm amber accent, Geist fonts, first-person labels, "via OpenCLI" attribution per DESIGN.md
