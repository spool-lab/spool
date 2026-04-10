import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { SyncEngine, loadSyncState } from './sync-engine.js'
import type { Connector, FetchContext, PageResult, AuthStatus } from './types.js'
import type { CapturedItem } from '../types.js'

// ── Test Helpers ────────────────────────────────────────────────────────────

function createTestDB(): InstanceType<typeof Database> {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE sources (
      id        INTEGER PRIMARY KEY,
      name      TEXT NOT NULL UNIQUE,
      base_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO sources (name, base_path) VALUES ('claude', '~/.claude/projects');

    CREATE TABLE captures (
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

    CREATE TABLE connector_sync_state (
      connector_id        TEXT PRIMARY KEY,
      head_cursor         TEXT,
      head_item_id        TEXT,
      tail_cursor         TEXT,
      tail_complete       INTEGER NOT NULL DEFAULT 0,
      last_forward_sync_at  TEXT,
      last_backfill_sync_at TEXT,
      total_synced        INTEGER NOT NULL DEFAULT 0,
      consecutive_errors  INTEGER NOT NULL DEFAULT 0,
      enabled             INTEGER NOT NULL DEFAULT 1,
      config_json         TEXT NOT NULL DEFAULT '{}',
      last_error_code     TEXT,
      last_error_message  TEXT
    );
  `)
  return db
}

function makeItem(platformId: string): CapturedItem {
  return {
    url: `https://example.com/${platformId}`,
    title: `Item ${platformId}`,
    contentText: '',
    author: null,
    platform: 'test',
    platformId,
    contentType: 'post',
    thumbnailUrl: null,
    metadata: {},
    capturedAt: new Date().toISOString(),
    rawJson: null,
  }
}

type FetchPageFn = (ctx: FetchContext) => Promise<PageResult>

function createMockConnector(fetchPageFn: FetchPageFn): Connector {
  return {
    id: 'test-connector',
    platform: 'test',
    label: 'Test',
    description: 'test connector',
    color: '#000',
    ephemeral: false,
    async checkAuth(): Promise<AuthStatus> { return { ok: true } },
    fetchPage: fetchPageFn,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('SyncEngine — dual-frontier', () => {
  let db: InstanceType<typeof Database>
  let engine: SyncEngine

  beforeEach(() => {
    db = createTestDB()
    engine = new SyncEngine(db)
  })

  // ── A.1.1: FetchContext is passed correctly ─────────────────────────────

  describe('FetchContext passing', () => {
    it('passes sinceItemId and phase to connector during forward', async () => {
      const calls: FetchContext[] = []
      const connector = createMockConnector(async (ctx) => {
        calls.push({ ...ctx })
        return { items: [makeItem('#100')], nextCursor: null }
      })

      await engine.sync(connector, { direction: 'forward' })

      expect(calls).toHaveLength(1)
      expect(calls[0].phase).toBe('forward')
      expect(calls[0].sinceItemId).toBeNull()
      expect(calls[0].cursor).toBeNull()
    })

    it('passes sinceItemId from previous forward cycle', async () => {
      const calls: FetchContext[] = []
      let callCount = 0
      const connector = createMockConnector(async (ctx) => {
        calls.push({ ...ctx })
        callCount++
        if (callCount === 1) {
          return { items: [makeItem('#200'), makeItem('#199')], nextCursor: null }
        }
        // Second cycle: return the anchor item to trigger early-exit
        return { items: [makeItem('#201'), makeItem('#200')], nextCursor: null }
      })

      // First sync: establishes headItemId = #200
      await engine.sync(connector, { direction: 'forward' })
      // Second sync: should pass sinceItemId = #200
      await engine.sync(connector, { direction: 'forward' })

      expect(calls[1].sinceItemId).toBe('#200')
    })

    it('passes null sinceItemId during backfill', async () => {
      const calls: FetchContext[] = []
      const connector = createMockConnector(async (ctx) => {
        calls.push({ ...ctx })
        return { items: [makeItem('#100')], nextCursor: null }
      })

      await engine.sync(connector, { direction: 'backfill' })

      expect(calls[0].phase).toBe('backfill')
      expect(calls[0].sinceItemId).toBeNull()
    })
  })

  // ── A.1.2: tailCursor scope ─────────────────────────────────────────────

  describe('tailCursor scope', () => {
    it('forward writes tailCursor during initial sync (handoff to backfill)', async () => {
      let callCount = 0
      const connector = createMockConnector(async () => {
        callCount++
        if (callCount === 1) return { items: [makeItem('#100')], nextCursor: 'cur1' }
        return { items: [makeItem('#99')], nextCursor: null }
      })

      await engine.sync(connector, { direction: 'forward' })
      const state = loadSyncState(db, 'test-connector')
      // tailCursor should be set from forward's page traversal (initial sync handoff)
      expect(state.tailCursor).toBe('cur1')
    })

    it('forward does NOT overwrite tailCursor on subsequent cycles', async () => {
      // Simulate: initial sync sets tailCursor deep, then forward runs again
      let callCount = 0
      const connector = createMockConnector(async () => {
        callCount++
        // Initial forward: 2 pages
        if (callCount === 1) return { items: [makeItem('#100')], nextCursor: 'cur1' }
        if (callCount === 2) return { items: [makeItem('#99')], nextCursor: null }
        // Backfill: goes deeper
        if (callCount === 3) return { items: [makeItem('#50')], nextCursor: 'deep-cursor' }
        if (callCount === 4) return { items: [makeItem('#49')], nextCursor: null }
        // Second forward: should NOT touch tailCursor
        if (callCount === 5) return { items: [makeItem('#101'), makeItem('#100')], nextCursor: null }
        return { items: [], nextCursor: null }
      })

      // Cycle 1: forward + backfill, tailCursor ends at backfill's position
      await engine.sync(connector, { direction: 'both' })
      const stateAfterCycle1 = loadSyncState(db, 'test-connector')
      expect(stateAfterCycle1.tailCursor).toBe('deep-cursor')

      // Cycle 2: forward only — tailCursor must stay at deep-cursor
      await engine.sync(connector, { direction: 'forward' })
      const stateAfterCycle2 = loadSyncState(db, 'test-connector')
      expect(stateAfterCycle2.tailCursor).toBe('deep-cursor')
    })
  })

  // ── A.1.3: headItemId write timing ──────────────────────────────────────

  describe('headItemId write timing', () => {
    it('sets headItemId from page 0 first item', async () => {
      let callCount = 0
      const connector = createMockConnector(async () => {
        callCount++
        if (callCount === 1) return { items: [makeItem('#200'), makeItem('#199')], nextCursor: 'c1' }
        return { items: [makeItem('#198')], nextCursor: null }
      })

      await engine.sync(connector, { direction: 'forward' })
      const state = loadSyncState(db, 'test-connector')
      // headItemId should be #200 (page 0 first item), NOT #198 (last page first item)
      expect(state.headItemId).toBe('#200')
    })

    it('does not update headItemId when resuming from headCursor', async () => {
      // Set up state as if forward was interrupted: headItemId=#200, headCursor=mid-point
      db.prepare(`
        INSERT INTO connector_sync_state (connector_id, head_item_id, head_cursor, tail_cursor, enabled)
        VALUES ('test-connector', '#200', 'resume-cur', 'tail-cur', 1)
      `).run()

      let callCount = 0
      const connector = createMockConnector(async () => {
        callCount++
        // Resumed forward: starts from resume-cur, returns older items
        if (callCount === 1) return { items: [makeItem('#195'), makeItem('#200')], nextCursor: null }
        return { items: [], nextCursor: null }
      })

      await engine.sync(connector, { direction: 'forward' })
      const state = loadSyncState(db, 'test-connector')
      // headItemId should remain #200, NOT be overwritten by #195
      expect(state.headItemId).toBe('#200')
    })
  })

  // ── A.1.4: headCursor resume ────────────────────────────────────────────

  describe('headCursor resume', () => {
    it('clears headCursor on normal forward completion', async () => {
      const connector = createMockConnector(async () => {
        return { items: [makeItem('#100')], nextCursor: null }
      })

      await engine.sync(connector, { direction: 'forward' })
      const state = loadSyncState(db, 'test-connector')
      expect(state.headCursor).toBeNull()
    })

    it('preserves headCursor on timeout', async () => {
      let callCount = 0
      const connector = createMockConnector(async () => {
        callCount++
        // Return pages indefinitely
        return { items: [makeItem(`#${100 + callCount}`)], nextCursor: `cur${callCount}` }
      })

      // maxMinutes=0.0001 (~6ms) to trigger timeout quickly
      await engine.sync(connector, { direction: 'forward', maxMinutes: 0.0001, delayMs: 10 })
      const state = loadSyncState(db, 'test-connector')
      // headCursor should be preserved (non-null) for resume
      expect(state.headCursor).not.toBeNull()
    })

    it('resumes forward from headCursor instead of null', async () => {
      // Pre-set headCursor from a previous interrupted forward
      db.prepare(`
        INSERT INTO connector_sync_state (connector_id, head_item_id, head_cursor, enabled)
        VALUES ('test-connector', '#200', 'resume-from-here', 1)
      `).run()

      const calls: FetchContext[] = []
      const connector = createMockConnector(async (ctx) => {
        calls.push({ ...ctx })
        return { items: [makeItem('#198'), makeItem('#200')], nextCursor: null }
      })

      await engine.sync(connector, { direction: 'forward' })
      // Should start from headCursor, not null
      expect(calls[0].cursor).toBe('resume-from-here')
    })
  })

  // ── A.1.5: early-exit on sinceItemId ────────────────────────────────────

  describe('early-exit on sinceItemId', () => {
    it('stops forward when page contains sinceItemId', async () => {
      // Set up: headItemId = #200 from previous cycle
      db.prepare(`
        INSERT INTO connector_sync_state (connector_id, head_item_id, tail_cursor, enabled)
        VALUES ('test-connector', '#200', 'some-tail', 1)
      `).run()

      let callCount = 0
      const connector = createMockConnector(async () => {
        callCount++
        // Page 1 contains the anchor item #200
        return { items: [makeItem('#202'), makeItem('#201'), makeItem('#200')], nextCursor: 'more' }
      })

      const result = await engine.sync(connector, { direction: 'forward' })
      expect(result.stopReason).toBe('reached_since')
      // Should only make 1 API call — no need to fetch more pages
      expect(callCount).toBe(1)
    })

    it('falls back to stale-page detection when no anchor exists', async () => {
      let callCount = 0
      const connector = createMockConnector(async () => {
        callCount++
        // Return the same items every time (all already in DB after page 1)
        return { items: [makeItem('#100')], nextCursor: `cur${callCount}` }
      })

      const result = await engine.sync(connector, { direction: 'forward', stalePageLimit: 3 })
      expect(result.stopReason).toBe('caught_up')
      // 1 page with new data + 3 stale pages = 4 total
      expect(callCount).toBe(4)
    })
  })

  // ── A.1.6: anchor invalidation ──────────────────────────────────────────

  describe('anchor invalidation', () => {
    it('clears headItemId when forward completes without hitting anchor', async () => {
      // Set up: headItemId = #200 but that item was deleted from the platform
      db.prepare(`
        INSERT INTO connector_sync_state (connector_id, head_item_id, tail_cursor, enabled)
        VALUES ('test-connector', '#200', 'some-tail', 1)
      `).run()

      const connector = createMockConnector(async () => {
        // Returns items but never #200 — anchor is stale
        return { items: [makeItem('#300')], nextCursor: null }
      })

      await engine.sync(connector, { direction: 'forward' })
      const state = loadSyncState(db, 'test-connector')
      // Anchor should be cleared since forward completed without hitting it
      expect(state.headItemId).toBeNull()
    })

    it('does NOT clear headItemId when forward is interrupted by timeout', async () => {
      // headCursor is set so this is a resumed forward — page 0 won't overwrite headItemId
      db.prepare(`
        INSERT INTO connector_sync_state (connector_id, head_item_id, head_cursor, enabled)
        VALUES ('test-connector', '#200', 'resume-cur', 1)
      `).run()

      let callCount = 0
      const connector = createMockConnector(async () => {
        callCount++
        return { items: [makeItem(`#${300 + callCount}`)], nextCursor: `cur${callCount}` }
      })

      await engine.sync(connector, { direction: 'forward', maxMinutes: 0.0001, delayMs: 10 })
      const state = loadSyncState(db, 'test-connector')
      // Anchor should be preserved — forward didn't complete, can't judge validity.
      // headItemId stays #200 because this was a resumed forward (startCursor != null),
      // so A.1.3 skips the page-0 update.
      expect(state.headItemId).toBe('#200')
    })

    it('preserves headItemId when forward hits the anchor (reached_since)', async () => {
      db.prepare(`
        INSERT INTO connector_sync_state (connector_id, head_item_id, tail_cursor, enabled)
        VALUES ('test-connector', '#200', 'some-tail', 1)
      `).run()

      const connector = createMockConnector(async () => {
        return { items: [makeItem('#201'), makeItem('#200')], nextCursor: 'more' }
      })

      await engine.sync(connector, { direction: 'forward' })
      const state = loadSyncState(db, 'test-connector')
      // headItemId should be updated to #201 (page 0 first item, newer than #200)
      expect(state.headItemId).toBe('#201')
    })
  })
})
