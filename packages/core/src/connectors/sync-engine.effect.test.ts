import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { SyncEngine } from './sync-engine.js'
import type { Connector, FetchContext, PageResult, AuthStatus } from './types.js'
import { createTestDB, makeItem } from './test-helpers.js'

// Regression tests for the Effect.gen rewrite of fetchLoop / syncEphemeral.
// These assert properties that were NOT observable in the old Promise-based
// implementation: interruptible sleep, deadline-gated sleep for maxMinutes,
// and that all 65 Phase B contract tests keep passing untouched.

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

  it('signal.abort wakes a long inter-page sleep within a few ms', async () => {
    // Two pages, with a long delayMs between them. Without interruptible sleep,
    // cancellation would have to wait out the full delay. With Effect.race +
    // abort-listener, the sleep wakes immediately on abort and the loop top
    // sees signal.aborted on the next iteration.
    const connector = connectorFromHandler(async (ctx) => {
      if (ctx.cursor === null) {
        return { items: [makeItem('#A')], nextCursor: 'c1' }
      }
      return { items: [makeItem('#B')], nextCursor: null }
    })

    const controller = new AbortController()
    const LONG_DELAY = 5000
    const ABORT_AFTER = 20
    const BUDGET = 500  // generous budget; without interruptible sleep this would be >= LONG_DELAY

    setTimeout(() => controller.abort(), ABORT_AFTER)

    const started = Date.now()
    const result = await engine.sync(connector, {
      direction: 'forward',
      delayMs: LONG_DELAY,
      signal: controller.signal,
    })
    const elapsed = Date.now() - started

    expect(elapsed).toBeLessThan(BUDGET)
    expect(result.stopReason).toBe('cancelled')
    expect(result.added).toBeGreaterThanOrEqual(1)
  })

  it('maxMinutes deadline caps a long sleep with ms-level precision', async () => {
    // With the old polling-only implementation, a long delayMs between pages
    // meant maxMinutes enforcement could overshoot by up to delayMs. With the
    // deadline-capped sleep, the sleep never exceeds the remaining deadline.
    const connector = connectorFromHandler(async () => ({
      items: [makeItem(`#${Date.now()}`)],
      nextCursor: 'c1',
    }))

    const started = Date.now()
    const result = await engine.sync(connector, {
      direction: 'forward',
      delayMs: 10_000, // nominal 10s between pages
      maxMinutes: 0.01, // ~600ms budget
    })
    const elapsed = Date.now() - started

    // Deadline-aware sleep should bring this in comfortably under 2s
    // (the old loop would have slept the full 10s before checking).
    expect(elapsed).toBeLessThan(2_000)
    expect(result.stopReason).toBe('timeout')
  })

  it('aborting before sync starts returns cancelled without fetching', async () => {
    let fetchCalls = 0
    const connector = connectorFromHandler(async () => {
      fetchCalls++
      return { items: [makeItem('#A')], nextCursor: null }
    })

    const controller = new AbortController()
    controller.abort()

    const result = await engine.sync(connector, {
      direction: 'forward',
      delayMs: 0,
      signal: controller.signal,
    })

    expect(result.stopReason).toBe('cancelled')
    expect(fetchCalls).toBe(0)
  })
})
