import { it } from '@effect/vitest'
import { describe, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { Duration, Effect, Fiber, TestClock } from 'effect'
import { SyncEngine } from './sync-engine.js'
import type { Connector, FetchContext, PageResult, AuthStatus } from './types.js'
import { createTestDB, makeItem } from './test-helpers.js'

// Regression tests for the Effect rewrite of fetchLoop / syncEphemeral.
// These exercise properties that were not observable in the old Promise-
// based implementation: interruptible sleep via Deferred.await racing,
// deadline-gated sleep via Clock.currentTimeMillis, and graceful abort
// before the first fetch.
//
// Driven by @effect/vitest + TestClock, so virtual time makes the
// assertions deterministic and the total wall-clock cost is near zero.

function connectorFromHandler(
  fetchPage: (ctx: FetchContext) => Promise<PageResult>,
  overrides: Partial<Connector> = {},
): Connector {
  return {
    id: 'test-connector',
    platform: 'test',
    label: 'Test',
    description: 'test',
    color: '#000',
    ephemeral: false,
    async checkAuth(): Promise<AuthStatus> { return { ok: true } },
    fetchPage,
    ...overrides,
  }
}

describe('SyncEngine — Effect.gen behavioral regressions', () => {
  let db: InstanceType<typeof Database>
  let engine: SyncEngine

  beforeEach(() => {
    db = createTestDB()
    engine = new SyncEngine(db)
  })

  it.effect('signal.abort wakes a long inter-page sleep', () =>
    Effect.gen(function* () {
      // Two-page connector with a nominal 60s inter-page delay. Under
      // TestClock that sleep never actually elapses — the virtual clock
      // does not advance until we tell it to. The abort listener resolves
      // the internal cancel Deferred, which wakes the sleep race
      // immediately and causes the loop top to return stopReason=cancelled
      // on its next iteration.
      const connector = connectorFromHandler(async (ctx) => {
        if (ctx.cursor === null) {
          return { items: [makeItem('#A')], nextCursor: 'c1' }
        }
        return { items: [makeItem('#B')], nextCursor: null }
      })

      const controller = new AbortController()
      const fiber = yield* Effect.fork(
        engine.syncEffect(connector, {
          direction: 'forward',
          delayMs: 60_000, // 60s nominal sleep between pages
          signal: controller.signal,
        }),
      )

      // Let the forked fiber run until it suspends inside the sleep race.
      // Yielding alone is not enough because the fiber is in a sync→async
      // chain (loadState → fetchPage Promise → upsert → sleep). A zero-
      // duration TestClock adjust lets the scheduler drain ready fibers.
      yield* TestClock.adjust(Duration.zero)

      // Abort from outside the Effect world. The bridge listener fires
      // synchronously via Deferred.unsafeDone, resolving the cancel signal.
      yield* Effect.sync(() => controller.abort())

      const result = yield* Fiber.join(fiber)

      expect(result.stopReason).toBe('cancelled')
      expect(result.added).toBeGreaterThanOrEqual(1)
    }),
  )

  it.effect('maxMinutes deadline stops the loop with stopReason=timeout', () =>
    Effect.gen(function* () {
      // An endless page stream. The only way out is the maxMinutes deadline.
      const connector = connectorFromHandler(async () => ({
        items: [makeItem(`#${Math.random()}`)],
        nextCursor: 'more',
      }))

      const fiber = yield* Effect.fork(
        engine.syncEffect(connector, {
          direction: 'forward',
          delayMs: 60_000,
          maxMinutes: 1,
        }),
      )

      // Advance virtual time past the 1-minute deadline. All suspended
      // sleeps resolve; the loop top reads Clock.currentTimeMillis, sees
      // it >= deadline, and returns stopReason=timeout.
      yield* TestClock.adjust(Duration.minutes(2))

      const result = yield* Fiber.join(fiber)

      expect(result.stopReason).toBe('timeout')
      expect(result.added).toBeGreaterThanOrEqual(1)
    }),
  )

  it.effect('aborting before sync starts returns cancelled without fetching', () =>
    Effect.gen(function* () {
      let fetchCalls = 0
      const connector = connectorFromHandler(async () => {
        fetchCalls++
        return { items: [makeItem('#A')], nextCursor: null }
      })

      const controller = new AbortController()
      controller.abort()

      const result = yield* engine.syncEffect(connector, {
        direction: 'forward',
        delayMs: 0,
        signal: controller.signal,
      })

      expect(result.stopReason).toBe('cancelled')
      expect(fetchCalls).toBe(0)
    }),
  )
})
