import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Duration, Effect, ManagedRuntime, TestClock, TestContext } from 'effect'
import Database from 'better-sqlite3'
import { SyncScheduler, type SchedulerEvent } from './sync-scheduler.js'
import { ConnectorRegistry } from './registry.js'
import { SyncError, SyncErrorCode } from './types.js'
import type { Connector, AuthStatus, FetchContext, PageResult } from './types.js'
import { createTestDB, makeItem, setState } from './test-helpers.js'

// ── Test Helpers ────────────────────────────────────────────────────────────

function createTestConnector(
  id: string,
  fetchPageFn?: (ctx: FetchContext) => Promise<PageResult>,
): Connector {
  return {
    id,
    platform: 'test',
    label: `Test ${id}`,
    description: 'test connector',
    color: '#000',
    ephemeral: false,
    async checkAuth(): Promise<AuthStatus> { return { ok: true } },
    fetchPage:
      fetchPageFn ?? (async () => ({ items: [makeItem(`${id}-1`)], nextCursor: null })),
  }
}

/**
 * Build a test runtime whose default Clock is TestClock. The scheduler's
 * tick fiber and per-job runJob fibers all run in this runtime so
 * `runtime.runPromise(TestClock.adjust(...))` advances time deterministically.
 */
function makeTestRuntime() {
  return ManagedRuntime.make(TestContext.TestContext)
}

/**
 * TestClock advance + microtask drain. The scheduler forks real Promise-based
 * fetchPage calls, so after advancing virtual time we need to yield to the JS
 * microtask/macrotask queues a few times so the forked runJob fibers can
 * progress through their await boundaries before we assert.
 */
async function flush(runtime: ReturnType<typeof makeTestRuntime>, ms: number): Promise<void> {
  await runtime.runPromise(TestClock.adjust(Duration.millis(ms)))
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve))
    await runtime.runPromise(Effect.sleep(Duration.zero))
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('SyncScheduler contract (effect)', () => {
  let db: InstanceType<typeof Database>
  let registry: ConnectorRegistry
  let scheduler: SyncScheduler | undefined
  let runtime: ReturnType<typeof makeTestRuntime>

  beforeEach(() => {
    db = createTestDB()
    registry = new ConnectorRegistry()
    runtime = makeTestRuntime()
    scheduler = undefined
  })

  afterEach(async () => {
    scheduler?.stop()
    await runtime.dispose()
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

      scheduler = new SyncScheduler(
        db,
        registry,
        {
          forwardIntervalMs: 1_000,
          retryBackoffMs: [1_000],
          pageDelayMs: 0,
          maxMinutesPerRun: 1,
        },
        runtime,
      )
      scheduler.start()

      await flush(runtime, 100)
      expect(fetchCalls).toHaveLength(1)

      // AUTH errors never retry — advance far past any configured backoff
      await flush(runtime, 120_000)
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

      scheduler = new SyncScheduler(
        db,
        registry,
        {
          forwardIntervalMs: 1_000,
          backfillIntervalMs: 999_999_999,
          retryBackoffMs: [5_000, 60_000],
          pageDelayMs: 0,
          maxMinutesPerRun: 1,
        },
        runtime,
      )
      scheduler.start()

      await flush(runtime, 100)
      expect(fetchCalls).toHaveLength(1)

      // t=30s: tick fires, backoff=5s has elapsed (30>5), retry → errors=2
      await flush(runtime, 30_000)
      expect(fetchCalls).toHaveLength(2)

      // t=60s: 30s since last error, backoff=60s → skip
      await flush(runtime, 30_000)
      expect(fetchCalls).toHaveLength(2)

      // t=90s: 60s since last error → retry
      await flush(runtime, 30_000)
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

      scheduler = new SyncScheduler(
        db,
        registry,
        {
          forwardIntervalMs: 1_000,
          retryBackoffMs: [60_000],
          pageDelayMs: 0,
          maxMinutesPerRun: 1,
        },
        runtime,
      )
      scheduler.start()

      await flush(runtime, 100)
      expect(fetchCalls).toHaveLength(1)

      // t=30s: only 30s since lastErrorAt, backoff=60s → skip
      await flush(runtime, 30_000)
      expect(fetchCalls).toHaveLength(1)

      // t=60s: 60s since lastErrorAt → retry
      await flush(runtime, 30_000)
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

      scheduler = new SyncScheduler(
        db,
        registry,
        {
          forwardIntervalMs: 1_000,
          retryBackoffMs: [5_000],
          pageDelayMs: 0,
          maxMinutesPerRun: 1,
        },
        runtime,
      )
      scheduler.start()

      await flush(runtime, 100)
      shouldFail = false

      // t=30s: backoff=5s elapsed, retry fires — now succeeds
      await flush(runtime, 30_000)

      const state = db
        .prepare(
          'SELECT consecutive_errors, last_error_at FROM connector_sync_state WHERE connector_id = ?',
        )
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

      scheduler = new SyncScheduler(
        db,
        registry,
        {
          forwardIntervalMs: 10_000,
          backfillIntervalMs: 999_999_999,
          pageDelayMs: 0,
          maxMinutesPerRun: 1,
        },
        runtime,
      )
      scheduler.start()

      await flush(runtime, 100)
      expect(fetchCalls.length).toBeGreaterThanOrEqual(1)

      fetchCalls.length = 0

      // t=30s: 30s > 10s forwardIntervalMs → forward due
      await flush(runtime, 30_000)
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

      scheduler = new SyncScheduler(
        db,
        registry,
        {
          forwardIntervalMs: 999_999_999,
          backfillIntervalMs: 1_000,
          pageDelayMs: 0,
          maxMinutesPerRun: 1,
        },
        runtime,
      )
      scheduler.start()

      await flush(runtime, 100)
      await flush(runtime, 90_000)

      const backfillCalls = phases.filter((p) => p === 'backfill')
      expect(backfillCalls).toHaveLength(0)
    })

    it('triggerNow during running sync is a no-op (enqueue dedupes)', async () => {
      let fetchCount = 0
      let release: () => void = () => {}
      const connector = createTestConnector('dedupe', async () => {
        fetchCount++
        await new Promise<void>((resolve) => { release = resolve })
        return { items: [makeItem('d-1')], nextCursor: null }
      })
      registry.register(connector)
      setState(db, { connectorId: 'dedupe', tailComplete: true })

      scheduler = new SyncScheduler(
        db,
        registry,
        { forwardIntervalMs: 999_999_999, pageDelayMs: 0, maxMinutesPerRun: 1 },
        runtime,
      )
      scheduler.start()
      await flush(runtime, 100)

      expect(fetchCount).toBe(1) // startup sync in flight, parked

      scheduler.triggerNow('dedupe', 'forward')
      await flush(runtime, 100)

      expect(fetchCount).toBe(1) // no new sync — enqueue sees running.has(id) and no-ops

      release()
      await flush(runtime, 100) // let cleanup run
    })

    it('triggerNow runs immediately with highest priority', async () => {
      const fetchCalls: number[] = []
      const connector = createTestConnector('manual', async () => {
        fetchCalls.push(Date.now())
        return { items: [makeItem('m-1')], nextCursor: null }
      })
      registry.register(connector)
      setState(db, { connectorId: 'manual' })

      scheduler = new SyncScheduler(
        db,
        registry,
        {
          forwardIntervalMs: 999_999_999,
          pageDelayMs: 0,
          maxMinutesPerRun: 1,
        },
        runtime,
      )
      scheduler.start()

      await flush(runtime, 100)
      const afterStartup = fetchCalls.length

      scheduler.triggerNow('manual', 'forward')
      await flush(runtime, 100)

      expect(fetchCalls.length).toBeGreaterThan(afterStartup)
    })
  })

  describe('Concurrency', () => {
    it('semaphore caps simultaneous syncs at config.concurrency', async () => {
      const inFlight = new Set<string>()
      let maxInFlight = 0
      const gates = new Map<string, () => void>()
      const makeSlow = (id: string): Connector =>
        createTestConnector(id, async () => {
          inFlight.add(id)
          maxInFlight = Math.max(maxInFlight, inFlight.size)
          await new Promise<void>((resolve) => gates.set(id, resolve))
          inFlight.delete(id)
          return { items: [makeItem(`${id}-1`)], nextCursor: null }
        })

      for (const id of ['c1', 'c2', 'c3', 'c4']) {
        registry.register(makeSlow(id))
        setState(db, { connectorId: id, tailComplete: true })
      }

      scheduler = new SyncScheduler(
        db,
        registry,
        {
          forwardIntervalMs: 1_000,
          pageDelayMs: 0,
          maxMinutesPerRun: 1,
          concurrency: 2,
        },
        runtime,
      )
      scheduler.start()

      // Let all 4 runJob fibers be forked and block on fetchPage
      await flush(runtime, 100)

      expect(maxInFlight).toBe(2)
      expect(inFlight.size).toBe(2)

      // Release the 2 currently in flight — next 2 should pick up permits
      for (const id of Array.from(inFlight)) gates.get(id)!()
      await flush(runtime, 100)
      expect(maxInFlight).toBe(2) // still capped

      // Release second wave
      for (const id of Array.from(inFlight)) gates.get(id)!()
      await flush(runtime, 100)
    })
  })

  describe('Cancellation', () => {
    it('stop() causes in-flight sync to return with stopReason=cancelled and no sync-error', async () => {
      const events: SchedulerEvent[] = []
      let page = 0
      const connector = createTestConnector('cancel-me', async () => {
        page++
        return {
          items: [makeItem(`c-${page}`)],
          nextCursor: `cursor-${page + 1}`,
        }
      })
      registry.register(connector)
      setState(db, { connectorId: 'cancel-me', tailComplete: true })

      scheduler = new SyncScheduler(
        db,
        registry,
        {
          forwardIntervalMs: 999_999_999,
          // long enough that the inter-page sleep is still pending when stop() fires
          pageDelayMs: 60_000,
          maxMinutesPerRun: 5,
        },
        runtime,
      )
      scheduler.on((event) => events.push(event))
      scheduler.start()

      await flush(runtime, 100)
      expect(page).toBeGreaterThanOrEqual(1)

      scheduler.stop()
      await flush(runtime, 100)

      const completes = events.filter((e) => e.type === 'sync-complete')
      const errors = events.filter((e) => e.type === 'sync-error')
      expect(completes).toHaveLength(1)
      expect(
        completes[0]!.type === 'sync-complete' && completes[0]!.result.stopReason,
      ).toBe('cancelled')
      expect(errors).toHaveLength(0)
    })
  })
})
