import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { SyncEngine, loadSyncState } from './sync-engine.js'
import { SyncError, SyncErrorCode } from './types.js'
import type { Connector, FetchContext, PageResult, AuthStatus } from './types.js'
import { createTestDB, makeItem, setState, countCaptures } from './test-helpers.js'

// ── Test Helpers ────────────────────────────────────────────────────────────

type FetchPageFn = (ctx: FetchContext) => Promise<PageResult>

function createConnector(fetchPageFn: FetchPageFn, overrides?: Partial<Connector>): Connector {
  return {
    id: 'test-connector',
    platform: 'test',
    label: 'Test',
    description: 'test connector',
    color: '#000',
    ephemeral: false,
    async checkAuth(): Promise<AuthStatus> { return { ok: true } },
    fetchPage: fetchPageFn,
    ...overrides,
  }
}

function createScriptedConnector(
  pages: PageResult[],
  opts?: {
    id?: string
    ephemeral?: boolean
    onFetch?: (ctx: FetchContext, callIndex: number) => void
  },
): Connector {
  let callIndex = 0
  return createConnector(
    async (ctx) => {
      opts?.onFetch?.(ctx, callIndex)
      const page = pages[callIndex] ?? { items: [], nextCursor: null }
      callIndex++
      return page
    },
    { id: opts?.id ?? 'test-connector', ephemeral: opts?.ephemeral ?? false },
  )
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('SyncEngine contract', () => {
  let db: InstanceType<typeof Database>
  let engine: SyncEngine

  beforeEach(() => {
    db = createTestDB()
    engine = new SyncEngine(db)
  })

  // ── Tail-side ───────────────────────────────────────────────────────────

  describe('Tail-side', () => {
    it('initial forward: fetches from null, sets tailCursor for backfill handoff', async () => {
      const connector = createScriptedConnector([
        { items: [makeItem('#100')], nextCursor: 'cur-A' },
        { items: [makeItem('#99')], nextCursor: null },
      ])

      await engine.sync(connector, { direction: 'forward', delayMs: 0 })
      const state = loadSyncState(db, 'test-connector')

      expect(state.tailCursor).toBe('cur-A')
      expect(state.headItemId).toBe('#100')
      expect(state.headCursor).toBeNull()
    })

    it('backfill: resumes from tailCursor and sets tailComplete on end', async () => {
      setState(db, {
        connectorId: 'test-connector',
        tailCursor: 'backfill-start',
        headItemId: '#100',
      })

      const calls: FetchContext[] = []
      const connector = createScriptedConnector([
        { items: [makeItem('#50')], nextCursor: 'deep' },
        { items: [makeItem('#49')], nextCursor: null },
      ], { onFetch: (ctx) => calls.push({ ...ctx }) })

      await engine.sync(connector, { direction: 'backfill', delayMs: 0 })
      const state = loadSyncState(db, 'test-connector')

      expect(calls[0].cursor).toBe('backfill-start')
      expect(calls[0].phase).toBe('backfill')
      expect(calls[0].sinceItemId).toBeNull()
      expect(state.tailComplete).toBe(true)
    })

    it('forward + backfill interleave: 3 forward cycles + 2 backfill cycles maintain state continuity', async () => {
      let callCount = 0
      const connector = createConnector(async () => {
        callCount++
        if (callCount === 1) return { items: [makeItem('#100')], nextCursor: 'f1' }
        if (callCount === 2) return { items: [makeItem('#99')], nextCursor: null }
        if (callCount === 3) return { items: [makeItem('#50')], nextCursor: 'b1' }
        if (callCount === 4) return { items: [makeItem('#49')], nextCursor: null }
        if (callCount === 5) return { items: [makeItem('#101'), makeItem('#100')], nextCursor: 'f2' }
        if (callCount === 6) return { items: [makeItem('#102'), makeItem('#101')], nextCursor: 'f3' }
        return { items: [], nextCursor: null }
      })

      // Cycle 1: forward + backfill
      const r1 = await engine.sync(connector, { direction: 'both', delayMs: 0 })
      const s1 = loadSyncState(db, 'test-connector')
      expect(r1.added).toBe(4)
      expect(s1.headItemId).toBe('#100')
      expect(s1.tailComplete).toBe(true)

      // Cycle 2: forward only (backfill complete)
      const r2 = await engine.sync(connector, { direction: 'both', delayMs: 0 })
      const s2 = loadSyncState(db, 'test-connector')
      expect(r2.added).toBe(1)
      expect(s2.headItemId).toBe('#101')
      expect(r2.stopReason).toBe('reached_since')

      // Cycle 3: forward again
      const r3 = await engine.sync(connector, { direction: 'both', delayMs: 0 })
      const s3 = loadSyncState(db, 'test-connector')
      expect(r3.added).toBe(1)
      expect(s3.headItemId).toBe('#102')

      expect(countCaptures(db)).toBe(6)
      expect(s3.totalSynced).toBe(6)
    })

    it('ephemeral: deleteConnectorItems clears old data, full replace each sync', async () => {
      const connector1 = createScriptedConnector([
        { items: [makeItem('#A'), makeItem('#B')], nextCursor: null },
      ], { ephemeral: true })

      await engine.sync(connector1, { direction: 'forward', delayMs: 0 })
      expect(countCaptures(db)).toBe(2)

      const connector2 = createScriptedConnector([
        { items: [makeItem('#C'), makeItem('#D'), makeItem('#E')], nextCursor: null },
      ], { ephemeral: true })

      const r2 = await engine.sync(connector2, { direction: 'forward', delayMs: 0 })
      expect(countCaptures(db)).toBe(3)
      expect(r2.added).toBe(3)
      expect(r2.total).toBe(3)
    })

    it('ephemeral re-sync drops stars on captures that are being wiped', async () => {
      const connector1 = createScriptedConnector([
        { items: [makeItem('#A')], nextCursor: null },
      ], { ephemeral: true })
      await engine.sync(connector1, { direction: 'forward', delayMs: 0 })

      // Star the capture that was just synced
      const capUuid = (db.prepare('SELECT capture_uuid FROM captures').get() as { capture_uuid: string }).capture_uuid
      db.prepare("INSERT INTO stars (item_type, item_uuid) VALUES ('capture', ?)").run(capUuid)
      expect(db.prepare("SELECT COUNT(*) AS n FROM stars WHERE item_type='capture'").get()).toEqual({ n: 1 })

      // Re-sync replaces captures with new UUIDs → star on old UUID must go
      const connector2 = createScriptedConnector([
        { items: [makeItem('#B')], nextCursor: null },
      ], { ephemeral: true })
      await engine.sync(connector2, { direction: 'forward', delayMs: 0 })

      expect(db.prepare("SELECT COUNT(*) AS n FROM stars WHERE item_type='capture'").get()).toEqual({ n: 0 })
    })
  })

  // ── Head-side ───────────────────────────────────────────────────────────

  describe('Head-side', () => {
    it('passes sinceItemId and phase via FetchContext on forward', async () => {
      const calls: FetchContext[] = []
      const connector = createScriptedConnector([
        { items: [makeItem('#100')], nextCursor: null },
      ], { onFetch: (ctx) => calls.push({ ...ctx }) })

      await engine.sync(connector, { direction: 'forward', delayMs: 0 })

      expect(calls[0].phase).toBe('forward')
      expect(calls[0].sinceItemId).toBeNull()
      expect(calls[0].cursor).toBeNull()
    })

    it('passes sinceItemId from previous forward cycle', async () => {
      const calls: FetchContext[] = []
      let callCount = 0
      const connector = createConnector(async (ctx) => {
        calls.push({ ...ctx })
        callCount++
        if (callCount === 1) return { items: [makeItem('#200'), makeItem('#199')], nextCursor: null }
        return { items: [makeItem('#201'), makeItem('#200')], nextCursor: null }
      })

      await engine.sync(connector, { direction: 'forward', delayMs: 0 })
      await engine.sync(connector, { direction: 'forward', delayMs: 0 })

      expect(calls[1].sinceItemId).toBe('#200')
    })

    it('passes null sinceItemId during backfill', async () => {
      const calls: FetchContext[] = []
      const connector = createScriptedConnector([
        { items: [makeItem('#100')], nextCursor: null },
      ], { onFetch: (ctx) => calls.push({ ...ctx }) })

      await engine.sync(connector, { direction: 'backfill', delayMs: 0 })

      expect(calls[0].phase).toBe('backfill')
      expect(calls[0].sinceItemId).toBeNull()
    })

    it('early-exit: stops forward when page contains sinceItemId (reached_since)', async () => {
      setState(db, {
        connectorId: 'test-connector',
        headItemId: '#200',
        tailCursor: 'some-tail',
      })

      let callCount = 0
      const connector = createConnector(async () => {
        callCount++
        return { items: [makeItem('#202'), makeItem('#201'), makeItem('#200')], nextCursor: 'more' }
      })

      const result = await engine.sync(connector, { direction: 'forward', delayMs: 0 })
      expect(result.stopReason).toBe('reached_since')
      expect(callCount).toBe(1)
    })

    it('headItemId advances monotonically across forward cycles', async () => {
      let callCount = 0
      const connector = createConnector(async () => {
        callCount++
        if (callCount === 1) return { items: [makeItem('#100'), makeItem('#99')], nextCursor: null }
        if (callCount === 2) return { items: [makeItem('#102'), makeItem('#101'), makeItem('#100')], nextCursor: 'more' }
        return { items: [], nextCursor: null }
      })

      await engine.sync(connector, { direction: 'forward', delayMs: 0 })
      expect(loadSyncState(db, 'test-connector').headItemId).toBe('#100')

      await engine.sync(connector, { direction: 'forward', delayMs: 0 })
      expect(loadSyncState(db, 'test-connector').headItemId).toBe('#102')
    })

    it('stale-page fallback when no anchor exists', async () => {
      let callCount = 0
      const connector = createConnector(async () => {
        callCount++
        return { items: [makeItem('#100')], nextCursor: `cur${callCount}` }
      })

      const result = await engine.sync(connector, { direction: 'forward', stalePageLimit: 3, delayMs: 0 })
      expect(result.stopReason).toBe('caught_up')
      expect(callCount).toBe(4)
    })

    it('anchor invalidation: clears headItemId when forward completes without hitting anchor', async () => {
      setState(db, {
        connectorId: 'test-connector',
        headItemId: '#200',
        tailCursor: 'some-tail',
      })

      const connector = createScriptedConnector([
        { items: [makeItem('#300')], nextCursor: null },
      ])

      await engine.sync(connector, { direction: 'forward', delayMs: 0 })
      expect(loadSyncState(db, 'test-connector').headItemId).toBeNull()
    })

    it('anchor preserved on timeout (incomplete forward cannot judge validity)', async () => {
      setState(db, {
        connectorId: 'test-connector',
        headItemId: '#200',
        headCursor: 'resume-cur',
      })

      let callCount = 0
      const connector = createConnector(async () => {
        callCount++
        return { items: [makeItem(`#${300 + callCount}`)], nextCursor: `cur${callCount}` }
      })

      await engine.sync(connector, { direction: 'forward', maxMinutes: 0.0001, delayMs: 10 })
      expect(loadSyncState(db, 'test-connector').headItemId).toBe('#200')
    })

    it('anchor preserved when reached_since — then updated to page-0 first item', async () => {
      setState(db, {
        connectorId: 'test-connector',
        headItemId: '#200',
        tailCursor: 'some-tail',
      })

      const connector = createScriptedConnector([
        { items: [makeItem('#201'), makeItem('#200')], nextCursor: 'more' },
      ])

      await engine.sync(connector, { direction: 'forward', delayMs: 0 })
      expect(loadSyncState(db, 'test-connector').headItemId).toBe('#201')
    })

    describe('headCursor resume', () => {
      it('clears headCursor on normal forward completion', async () => {
        const connector = createScriptedConnector([
          { items: [makeItem('#100')], nextCursor: null },
        ])

        await engine.sync(connector, { direction: 'forward', delayMs: 0 })
        expect(loadSyncState(db, 'test-connector').headCursor).toBeNull()
      })

      it('preserves headCursor on timeout for resume', async () => {
        let callCount = 0
        const connector = createConnector(async () => {
          callCount++
          return { items: [makeItem(`#${100 + callCount}`)], nextCursor: `cur${callCount}` }
        })

        await engine.sync(connector, { direction: 'forward', maxMinutes: 0.0001, delayMs: 10 })
        expect(loadSyncState(db, 'test-connector').headCursor).not.toBeNull()
      })

      it('resumes forward from headCursor instead of null', async () => {
        setState(db, {
          connectorId: 'test-connector',
          headItemId: '#200',
          headCursor: 'resume-from-here',
        })

        const calls: FetchContext[] = []
        const connector = createScriptedConnector([
          { items: [makeItem('#198'), makeItem('#200')], nextCursor: null },
        ], { onFetch: (ctx) => calls.push({ ...ctx }) })

        await engine.sync(connector, { direction: 'forward', delayMs: 0 })
        expect(calls[0].cursor).toBe('resume-from-here')
      })

      it('does not update headItemId when resuming from headCursor', async () => {
        setState(db, {
          connectorId: 'test-connector',
          headItemId: '#200',
          headCursor: 'resume-cur',
          tailCursor: 'tail-cur',
        })

        const connector = createScriptedConnector([
          { items: [makeItem('#195'), makeItem('#200')], nextCursor: null },
        ])

        await engine.sync(connector, { direction: 'forward', delayMs: 0 })
        expect(loadSyncState(db, 'test-connector').headItemId).toBe('#200')
      })

      it('full resume lifecycle: interrupt → resume → complete → clear', async () => {
        let callCount = 0
        const connector = createConnector(async () => {
          callCount++
          if (callCount <= 3) return { items: [makeItem(`#${100 + callCount}`)], nextCursor: `cur${callCount}` }
          if (callCount === 4) return { items: [makeItem('#104'), makeItem('#101')], nextCursor: null }
          return { items: [], nextCursor: null }
        })

        // Cycle A: timeout after a few pages
        await engine.sync(connector, { direction: 'forward', maxMinutes: 0.0001, delayMs: 10 })
        const afterA = loadSyncState(db, 'test-connector')
        expect(afterA.headCursor).not.toBeNull()
        expect(afterA.headItemId).toBe('#101')

        // Cycle B: resume from headCursor, completes normally
        await engine.sync(connector, { direction: 'forward', delayMs: 0 })
        const afterB = loadSyncState(db, 'test-connector')
        expect(afterB.headCursor).toBeNull()
      })
    })

    it('forward does NOT overwrite tailCursor on subsequent cycles', async () => {
      let callCount = 0
      const connector = createConnector(async () => {
        callCount++
        if (callCount === 1) return { items: [makeItem('#100')], nextCursor: 'cur1' }
        if (callCount === 2) return { items: [makeItem('#99')], nextCursor: null }
        if (callCount === 3) return { items: [makeItem('#50')], nextCursor: 'deep-cursor' }
        if (callCount === 4) return { items: [makeItem('#49')], nextCursor: null }
        if (callCount === 5) return { items: [makeItem('#101'), makeItem('#100')], nextCursor: null }
        return { items: [], nextCursor: null }
      })

      await engine.sync(connector, { direction: 'both', delayMs: 0 })
      expect(loadSyncState(db, 'test-connector').tailCursor).toBe('deep-cursor')

      await engine.sync(connector, { direction: 'forward', delayMs: 0 })
      expect(loadSyncState(db, 'test-connector').tailCursor).toBe('deep-cursor')
    })

    it('initial sync handoff: forward sets tailCursor only when tailCursor and headCursor are both null', async () => {
      const connector = createScriptedConnector([
        { items: [makeItem('#100')], nextCursor: 'handoff-cursor' },
        { items: [makeItem('#99')], nextCursor: null },
      ])

      await engine.sync(connector, { direction: 'forward', delayMs: 0 })
      const state = loadSyncState(db, 'test-connector')
      expect(state.tailCursor).toBe('handoff-cursor')
    })
  })

  // ── Error handling ──────────────────────────────────────────────────────

  describe('Error handling', () => {
    it('sets lastErrorAt, consecutiveErrors, and error code on failure', async () => {
      const connector = createConnector(async () => {
        throw new SyncError(SyncErrorCode.NETWORK_OFFLINE, 'no network')
      })

      const result = await engine.sync(connector, { direction: 'forward', delayMs: 0 })
      const state = loadSyncState(db, 'test-connector')

      expect(state.lastErrorAt).not.toBeNull()
      expect(state.consecutiveErrors).toBe(1)
      expect(state.lastErrorCode).toBe('NETWORK_OFFLINE')
      expect(result.error).toBeDefined()
      expect(result.stopReason).toBe('error: NETWORK_OFFLINE')
    })

    it('clears error state on successful sync', async () => {
      setState(db, {
        connectorId: 'test-connector',
        consecutiveErrors: 3,
        lastErrorAt: '2026-01-01T00:00:00Z',
        lastErrorCode: SyncErrorCode.NETWORK_OFFLINE,
        lastErrorMessage: 'was offline',
      })

      const connector = createScriptedConnector([
        { items: [makeItem('#100')], nextCursor: null },
      ])

      await engine.sync(connector, { direction: 'forward', delayMs: 0 })
      const state = loadSyncState(db, 'test-connector')

      expect(state.lastErrorAt).toBeNull()
      expect(state.consecutiveErrors).toBe(0)
      expect(state.lastErrorCode).toBeNull()
    })

    it('increments consecutiveErrors on repeated failures', async () => {
      const connector = createConnector(async () => {
        throw new Error('fail')
      })

      await engine.sync(connector, { direction: 'forward', delayMs: 0 })
      expect(loadSyncState(db, 'test-connector').consecutiveErrors).toBe(1)

      await engine.sync(connector, { direction: 'forward', delayMs: 0 })
      expect(loadSyncState(db, 'test-connector').consecutiveErrors).toBe(2)

      await engine.sync(connector, { direction: 'forward', delayMs: 0 })
      expect(loadSyncState(db, 'test-connector').consecutiveErrors).toBe(3)
    })

    it('partial success: items added before error are persisted', async () => {
      let callCount = 0
      const connector = createConnector(async () => {
        callCount++
        if (callCount === 1) return { items: [makeItem('#100')], nextCursor: 'next' }
        throw new SyncError(SyncErrorCode.API_SERVER_ERROR, 'server error on page 2')
      })

      const result = await engine.sync(connector, { direction: 'forward', delayMs: 0 })

      expect(result.added).toBe(1)
      expect(result.error).toBeDefined()
      expect(countCaptures(db)).toBe(1)
      expect(loadSyncState(db, 'test-connector').consecutiveErrors).toBe(1)
    })

    it('wraps non-SyncError in CONNECTOR_ERROR', async () => {
      const connector = createConnector(async () => {
        throw new TypeError('unexpected null')
      })

      const result = await engine.sync(connector, { direction: 'forward', delayMs: 0 })
      expect(result.error?.code).toBe('CONNECTOR_ERROR')
    })
  })

  // ── Cancellation ────────────────────────────────────────────────────────

  describe('Cancellation', () => {
    it('signal.abort() stops at page boundary with state saved', async () => {
      const controller = new AbortController()
      let callCount = 0
      const connector = createConnector(async () => {
        callCount++
        if (callCount === 2) controller.abort()
        return { items: [makeItem(`#${callCount}`)], nextCursor: `cur${callCount}` }
      })

      const result = await engine.sync(connector, {
        direction: 'forward',
        delayMs: 0,
        signal: controller.signal,
      })

      expect(result.stopReason).toBe('cancelled')
      expect(result.added).toBeGreaterThanOrEqual(1)
      const state = loadSyncState(db, 'test-connector')
      expect(state.headCursor).not.toBeNull()
    })

    it('can resume forward after cancellation', async () => {
      const controller = new AbortController()
      let callCount = 0
      const connector = createConnector(async () => {
        callCount++
        if (callCount === 1) {
          const result = { items: [makeItem('#100')], nextCursor: 'cur1' }
          controller.abort()
          return result
        }
        if (callCount === 2) return { items: [makeItem('#99'), makeItem('#100')], nextCursor: null }
        return { items: [], nextCursor: null }
      })

      await engine.sync(connector, { direction: 'forward', delayMs: 0, signal: controller.signal })
      const afterCancel = loadSyncState(db, 'test-connector')
      expect(afterCancel.headCursor).not.toBeNull()

      const result2 = await engine.sync(connector, { direction: 'forward', delayMs: 0 })
      expect(loadSyncState(db, 'test-connector').headCursor).toBeNull()
    })
  })

  // ── Checkpoint ──────────────────────────────────────────────────────────

  describe('Checkpoint', () => {
    it('persists progress across 30 pages', async () => {
      const totalPages = 30
      let callCount = 0
      const connector = createConnector(async () => {
        callCount++
        if (callCount <= totalPages) {
          return { items: [makeItem(`#${callCount}`)], nextCursor: callCount < totalPages ? `cur${callCount}` : null }
        }
        return { items: [], nextCursor: null }
      })

      await engine.sync(connector, { direction: 'forward', delayMs: 0 })

      const state = loadSyncState(db, 'test-connector')
      expect(state.totalSynced).toBe(30)
      expect(countCaptures(db)).toBe(30)
    })
  })

  // ── Dedup ───────────────────────────────────────────────────────────────

  describe('Dedup', () => {
    it('same platformId twice does not produce duplicate rows', async () => {
      const connector = createScriptedConnector([
        { items: [makeItem('#100'), makeItem('#100')], nextCursor: null },
      ])

      const result = await engine.sync(connector, { direction: 'forward', delayMs: 0 })
      expect(result.added).toBe(1)
      expect(countCaptures(db)).toBe(1)
    })

    it('same platformId across syncs updates rather than duplicates', async () => {
      const connector1 = createScriptedConnector([
        { items: [makeItem('#100')], nextCursor: null },
      ])
      await engine.sync(connector1, { direction: 'forward', delayMs: 0 })

      let callCount = 0
      const connector2 = createConnector(async () => {
        callCount++
        if (callCount === 1) return { items: [makeItem('#100')], nextCursor: null }
        return { items: [], nextCursor: null }
      })

      const result = await engine.sync(connector2, { direction: 'forward', delayMs: 0 })
      expect(result.added).toBe(0)
      expect(countCaptures(db)).toBe(1)
    })
  })

  // ── Direction routing ───────────────────────────────────────────────────

  describe('Direction routing', () => {
    it('direction=both runs forward then backfill', async () => {
      const phases: string[] = []
      const connector = createConnector(async (ctx) => {
        phases.push(ctx.phase)
        return { items: [makeItem(`#${phases.length}`)], nextCursor: null }
      })

      await engine.sync(connector, { direction: 'both', delayMs: 0 })
      expect(phases).toEqual(['forward', 'backfill'])
    })

    it('direction=both skips backfill when tailComplete', async () => {
      setState(db, {
        connectorId: 'test-connector',
        tailComplete: true,
        headItemId: '#100',
      })

      const phases: string[] = []
      const connector = createConnector(async (ctx) => {
        phases.push(ctx.phase)
        return { items: [makeItem('#101'), makeItem('#100')], nextCursor: null }
      })

      await engine.sync(connector, { direction: 'both', delayMs: 0 })
      expect(phases).toEqual(['forward'])
    })

    it('direction=both skips backfill when forward errors', async () => {
      let callCount = 0
      const connector = createConnector(async (ctx) => {
        callCount++
        if (ctx.phase === 'forward') throw new Error('fail')
        return { items: [makeItem('#1')], nextCursor: null }
      })

      await engine.sync(connector, { direction: 'both', delayMs: 0 })
      expect(callCount).toBe(1)
    })
  })

  // ── Progress callback ──────────────────────────────────────────────────

  describe('Progress callback', () => {
    it('calls onProgress per page and once at completion', async () => {
      const progress: Array<{ page: number; running: boolean }> = []
      const connector = createScriptedConnector([
        { items: [makeItem('#1')], nextCursor: 'c1' },
        { items: [makeItem('#2')], nextCursor: null },
      ])

      await engine.sync(connector, {
        direction: 'forward',
        delayMs: 0,
        onProgress: (p) => progress.push({ page: p.page, running: p.running }),
      })

      expect(progress.length).toBe(3)
      expect(progress[0]).toEqual({ page: 1, running: true })
      expect(progress[1]).toEqual({ page: 2, running: true })
      expect(progress[2].running).toBe(false)
    })
  })

  // ── Timeout ─────────────────────────────────────────────────────────────

  describe('Timeout', () => {
    it('maxMinutes=0 means unlimited (no timeout)', async () => {
      let callCount = 0
      const connector = createConnector(async () => {
        callCount++
        if (callCount <= 5) return { items: [makeItem(`#${callCount}`)], nextCursor: `c${callCount}` }
        return { items: [makeItem(`#${callCount}`)], nextCursor: null }
      })

      const result = await engine.sync(connector, { direction: 'forward', maxMinutes: 0, delayMs: 0 })
      expect(result.stopReason).toBe('end_of_data')
      expect(callCount).toBe(6)
    })
  })
})
