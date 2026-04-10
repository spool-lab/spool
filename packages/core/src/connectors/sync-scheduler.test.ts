import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { SyncScheduler } from './sync-scheduler.js'
import { ConnectorRegistry } from './registry.js'
import { SyncError, SyncErrorCode } from './types.js'
import type { Connector, AuthStatus, FetchContext, PageResult, SchedulerEvent } from './types.js'
import { createTestDB, makeItem, setState } from './test-helpers.js'

// ── Test Helpers ────────────────────────────────────────────────────────────

function createTestConnector(id: string, fetchPageFn?: (ctx: FetchContext) => Promise<PageResult>): Connector {
  return {
    id,
    platform: 'test',
    label: `Test ${id}`,
    description: 'test connector',
    color: '#000',
    ephemeral: false,
    async checkAuth(): Promise<AuthStatus> { return { ok: true } },
    fetchPage: fetchPageFn ?? (async () => ({ items: [makeItem(`${id}-1`)], nextCursor: null })),
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('SyncScheduler contract', () => {
  let db: InstanceType<typeof Database>
  let registry: ConnectorRegistry
  let scheduler: SyncScheduler | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    db = createTestDB()
    registry = new ConnectorRegistry()
    scheduler = undefined
  })

  afterEach(() => {
    scheduler?.stop()
    vi.useRealTimers()
  })

  describe('Backoff', () => {
    it('AUTH_* error: no further syncs after auth failure', async () => {
      const fetchCalls: number[] = []
      const connector = createTestConnector('auth-fail', async () => {
        fetchCalls.push(Date.now())
        throw new SyncError(SyncErrorCode.AUTH_SESSION_EXPIRED, 'expired')
      })
      registry.register(connector)
      setState(db, { connectorId: 'auth-fail' })

      scheduler = new SyncScheduler(db, registry, {
        forwardIntervalMs: 1_000,
        retryBackoffMs: [1_000],
        pageDelayMs: 0,
        maxMinutesPerRun: 1,
      })
      scheduler.start()

      // Startup fires first sync which fails with AUTH error
      await vi.advanceTimersByTimeAsync(100)
      expect(fetchCalls).toHaveLength(1)

      // AUTH errors should never be retried
      await vi.advanceTimersByTimeAsync(120_000)

      expect(fetchCalls).toHaveLength(1)
    })

    it('non-auth error: respects backoff sequence across ticks', async () => {
      const fetchCalls: number[] = []
      const connector = createTestConnector('backoff-test', async () => {
        fetchCalls.push(Date.now())
        throw new SyncError(SyncErrorCode.NETWORK_OFFLINE, 'server down')
      })
      registry.register(connector)
      setState(db, { connectorId: 'backoff-test' })

      scheduler = new SyncScheduler(db, registry, {
        forwardIntervalMs: 1_000,
        backfillIntervalMs: 999_999_999,
        retryBackoffMs: [5_000, 60_000],
        pageDelayMs: 0,
        maxMinutesPerRun: 1,
      })
      scheduler.start()

      // Startup fires immediately
      await vi.advanceTimersByTimeAsync(100)
      expect(fetchCalls).toHaveLength(1)

      // t=30s: tick fires, backoff=5s has elapsed (30>5), retry → consecutiveErrors=2
      await vi.advanceTimersByTimeAsync(30_000)
      expect(fetchCalls).toHaveLength(2)

      // t=60s: tick fires, 30s since last error, backoff=60s → 30<60, skip
      await vi.advanceTimersByTimeAsync(30_000)
      expect(fetchCalls).toHaveLength(2)

      // t=90s: tick fires, 60s since last error at t=30s → 60>=60, retry
      await vi.advanceTimersByTimeAsync(30_000)
      expect(fetchCalls).toHaveLength(3)
    })

    it('backoff base is lastErrorAt, not lastForwardSyncAt', async () => {
      const fetchCalls: number[] = []
      const connector = createTestConnector('backoff-base', async () => {
        fetchCalls.push(Date.now())
        throw new SyncError(SyncErrorCode.API_SERVER_ERROR, 'fail')
      })
      registry.register(connector)
      setState(db, { connectorId: 'backoff-base' })

      scheduler = new SyncScheduler(db, registry, {
        forwardIntervalMs: 1_000,
        retryBackoffMs: [60_000],
        pageDelayMs: 0,
        maxMinutesPerRun: 1,
      })
      scheduler.start()

      // Startup fires first sync
      await vi.advanceTimersByTimeAsync(100)
      expect(fetchCalls).toHaveLength(1)

      // t=30s: only 30s since lastErrorAt, backoff=60s → skip
      await vi.advanceTimersByTimeAsync(30_000)
      expect(fetchCalls).toHaveLength(1)

      // t=60s: 60s since lastErrorAt → retry
      await vi.advanceTimersByTimeAsync(30_000)
      expect(fetchCalls).toHaveLength(2)
    })

    it('success after errors resets consecutiveErrors and lastErrorAt', async () => {
      let shouldFail = true
      const connector = createTestConnector('recovery', async () => {
        if (shouldFail) throw new SyncError(SyncErrorCode.API_SERVER_ERROR, 'fail')
        return { items: [makeItem('ok')], nextCursor: null }
      })
      registry.register(connector)
      setState(db, { connectorId: 'recovery' })

      scheduler = new SyncScheduler(db, registry, {
        forwardIntervalMs: 1_000,
        retryBackoffMs: [5_000],
        pageDelayMs: 0,
        maxMinutesPerRun: 1,
      })
      scheduler.start()

      // Startup sync fails
      await vi.advanceTimersByTimeAsync(100)

      // Switch to success before next tick
      shouldFail = false

      // t=30s: backoff=5s elapsed, retry fires — now succeeds
      await vi.advanceTimersByTimeAsync(30_000)

      const state = db.prepare('SELECT consecutive_errors, last_error_at FROM connector_sync_state WHERE connector_id = ?')
        .get('recovery') as { consecutive_errors: number; last_error_at: string | null }
      expect(state.consecutive_errors).toBe(0)
      expect(state.last_error_at).toBeNull()
    })
  })

  describe('Scheduling', () => {
    it('forward sync is scheduled after forwardIntervalMs elapses', async () => {
      const fetchCalls: string[] = []
      const connector = createTestConnector('interval-test', async (ctx) => {
        fetchCalls.push(ctx.phase)
        return { items: [makeItem('i-1')], nextCursor: null }
      })
      registry.register(connector)
      setState(db, { connectorId: 'interval-test' })

      scheduler = new SyncScheduler(db, registry, {
        forwardIntervalMs: 10_000,
        backfillIntervalMs: 999_999_999,
        pageDelayMs: 0,
        maxMinutesPerRun: 1,
      })
      scheduler.start()

      // Startup fires immediately
      await vi.advanceTimersByTimeAsync(100)
      expect(fetchCalls.length).toBeGreaterThanOrEqual(1)

      fetchCalls.length = 0

      // t=30s: tick fires, 30s > 10s forwardIntervalMs → forward due
      await vi.advanceTimersByTimeAsync(30_000)
      expect(fetchCalls.length).toBeGreaterThanOrEqual(1)
    })

    it('backfill not scheduled when tailComplete', async () => {
      const phases: string[] = []
      const connector = createTestConnector('backfill-done', async (ctx) => {
        phases.push(ctx.phase)
        return { items: [makeItem('bf-1')], nextCursor: null }
      })
      registry.register(connector)
      setState(db, {
        connectorId: 'backfill-done',
        tailComplete: true,
      })

      scheduler = new SyncScheduler(db, registry, {
        forwardIntervalMs: 999_999_999,
        backfillIntervalMs: 1_000,
        pageDelayMs: 0,
        maxMinutesPerRun: 1,
      })
      scheduler.start()

      // Startup fires 'both', engine skips backfill when tailComplete
      await vi.advanceTimersByTimeAsync(100)

      await vi.advanceTimersByTimeAsync(90_000)

      const backfillCalls = phases.filter(p => p === 'backfill')
      expect(backfillCalls).toHaveLength(0)
    })

    it('triggerNow runs immediately with highest priority', async () => {
      const fetchCalls: number[] = []
      const connector = createTestConnector('manual', async () => {
        fetchCalls.push(Date.now())
        return { items: [makeItem('m-1')], nextCursor: null }
      })
      registry.register(connector)
      setState(db, { connectorId: 'manual' })

      scheduler = new SyncScheduler(db, registry, {
        forwardIntervalMs: 999_999_999,
        pageDelayMs: 0,
        maxMinutesPerRun: 1,
      })
      scheduler.start()

      // Startup fires
      await vi.advanceTimersByTimeAsync(100)
      const afterStartup = fetchCalls.length

      // Manual trigger
      scheduler.triggerNow('manual', 'forward')
      await vi.advanceTimersByTimeAsync(100)

      expect(fetchCalls.length).toBeGreaterThan(afterStartup)
    })
  })
})
