import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { Effect, Logger, Option, Tracer } from 'effect'
import { SyncEngine } from './sync-engine.js'
import type { Connector, FetchContext, PageResult, AuthStatus } from './types.js'
import { createTestDB, makeItem } from './test-helpers.js'

// ── Observability regressions ──────────────────────────────────────────────
// Verifies the Logger + Tracer contract added in the Effect rewrite:
//   1. sync completion emits a structured INFO log via Effect.logInfo
//   2. sync.cycle / sync.forward / sync.fetchPage / sync.upsert spans are
//      emitted with the expected names and attributes
//
// These tests use Effect's Logger.replace and Tracer layers to intercept
// without touching production code. Both run via `engine.syncEffect(...)`,
// the Effect-native entry point, instead of the Promise wrapper.

function scripted(pages: PageResult[]): Connector {
  let i = 0
  return {
    id: 'test-connector',
    platform: 'test',
    label: 'Test',
    description: 'test',
    color: '#000',
    ephemeral: false,
    async checkAuth(): Promise<AuthStatus> { return { ok: true } },
    async fetchPage(_ctx: FetchContext) {
      const page = pages[i] ?? { items: [], nextCursor: null }
      i++
      return page
    },
  }
}

describe('SyncEngine — Observability', () => {
  let db: InstanceType<typeof Database>
  let engine: SyncEngine

  beforeEach(() => {
    db = createTestDB()
    engine = new SyncEngine(db)
  })

  // ── Logger.replace ──────────────────────────────────────────────────────

  it('emits a structured INFO "done" log on successful sync', async () => {
    type CapturedLog = { level: string; message: string }
    const captured: CapturedLog[] = []
    const testLogger = Logger.make(({ logLevel, message }) => {
      const text = Array.isArray(message) ? message.map(String).join(' ') : String(message)
      captured.push({ level: logLevel.label, message: text })
    })
    const loggerLayer = Logger.replace(Logger.defaultLogger, testLogger)

    const connector = scripted([
      { items: [makeItem('#1'), makeItem('#2')], nextCursor: null },
    ])

    const program = engine.syncEffect(connector, { direction: 'forward', delayMs: 0 })
    await Effect.runPromise(program.pipe(Effect.provide(loggerLayer)))

    const doneLog = captured.find(
      (l) => l.level === 'INFO' && l.message.includes('done:') && l.message.includes('test-connector'),
    )
    expect(doneLog, `expected a "done:" INFO log, got: ${JSON.stringify(captured)}`).toBeDefined()
    expect(doneLog!.message).toContain('added=2')
    expect(doneLog!.message).toMatch(/reason=end_of_data|reason=caught_up|reason=reached_since/)
  })

  it('emits an ERROR log when fetchPage fails', async () => {
    type CapturedLog = { level: string; message: string }
    const captured: CapturedLog[] = []
    const testLogger = Logger.make(({ logLevel, message }) => {
      const text = Array.isArray(message) ? message.map(String).join(' ') : String(message)
      captured.push({ level: logLevel.label, message: text })
    })
    const loggerLayer = Logger.replace(Logger.defaultLogger, testLogger)

    const connector: Connector = {
      id: 'test-connector',
      platform: 'test',
      label: 'Test',
      description: 'test',
      color: '#000',
      ephemeral: false,
      async checkAuth(): Promise<AuthStatus> { return { ok: true } },
      async fetchPage(): Promise<PageResult> {
        throw new Error('boom from test')
      },
    }

    const program = engine.syncEffect(connector, { direction: 'forward', delayMs: 0 })
    await Effect.runPromise(program.pipe(Effect.provide(loggerLayer)))

    const errLog = captured.find(
      (l) => l.level === 'ERROR' && l.message.includes('boom from test'),
    )
    expect(errLog, `expected an ERROR log containing the thrown message, got: ${JSON.stringify(captured)}`).toBeDefined()
  })

  // ── Custom Tracer ──────────────────────────────────────────────────────

  interface CapturedSpan {
    name: string
    attributes: Record<string, unknown>
    parentName: string | null
  }

  function collectingTracer(collected: CapturedSpan[]): Tracer.Tracer {
    return Tracer.make({
      span(name, parent, context, links, startTime, kind, options) {
        const attrs = new Map<string, unknown>()
        // withSpan passes initial attributes via the options parameter;
        // later calls to .attribute() also update the map.
        if (options?.attributes) {
          for (const [k, v] of Object.entries(options.attributes)) attrs.set(k, v)
        }
        const parentName = Option.isSome(parent)
          ? parent.value._tag === 'Span'
            ? parent.value.name
            : parent.value.spanId
          : null
        const span: Tracer.Span = {
          _tag: 'Span',
          name,
          spanId: `test-${collected.length}`,
          traceId: 'test-trace',
          parent,
          context,
          status: { _tag: 'Started', startTime },
          attributes: attrs,
          links,
          sampled: true,
          kind,
          attribute(key, value) {
            attrs.set(key, value)
          },
          event() {},
          addLinks() {},
          end() {
            collected.push({
              name,
              attributes: Object.fromEntries(attrs),
              parentName,
            })
          },
        }
        return span
      },
      context(f) {
        return f()
      },
    })
  }

  it('emits sync.cycle / sync.forward / sync.fetchPage / sync.upsert spans with correct attributes', async () => {
    const spans: CapturedSpan[] = []
    const tracer = collectingTracer(spans)

    const connector = scripted([
      { items: [makeItem('#a'), makeItem('#b')], nextCursor: 'c1' },
      { items: [makeItem('#c')], nextCursor: null },
    ])

    const program = engine.syncEffect(connector, { direction: 'forward', delayMs: 0 })
    await Effect.runPromise(program.pipe(Effect.withTracer(tracer)))

    const names = spans.map((s) => s.name)
    expect(names).toContain('sync.cycle')
    expect(names).toContain('sync.forward')
    expect(names.filter((n) => n === 'sync.fetchPage')).toHaveLength(2)
    expect(names.filter((n) => n === 'sync.upsert')).toHaveLength(2)

    const cycle = spans.find((s) => s.name === 'sync.cycle')!
    expect(cycle.attributes['connector.id']).toBe('test-connector')
    expect(cycle.attributes['sync.direction']).toBe('forward')
    expect(cycle.parentName).toBe(null)

    const forward = spans.find((s) => s.name === 'sync.forward')!
    expect(forward.parentName).toBe('sync.cycle')

    const fetchPages = spans.filter((s) => s.name === 'sync.fetchPage')
    expect(fetchPages[0].attributes['connector.id']).toBe('test-connector')
    expect(fetchPages[0].attributes['sync.phase']).toBe('forward')
    expect(fetchPages[0].attributes['sync.page']).toBe(1)
    expect(fetchPages[1].attributes['sync.page']).toBe(2)
    // fetchPage spans should nest under sync.forward
    expect(fetchPages[0].parentName).toBe('sync.forward')

    const upserts = spans.filter((s) => s.name === 'sync.upsert')
    expect(upserts[0].attributes['items.count']).toBe(2)
    expect(upserts[1].attributes['items.count']).toBe(1)
  })

  it('does not emit sync.backfill when tailComplete is true', async () => {
    const spans: CapturedSpan[] = []
    const tracer = collectingTracer(spans)

    // First sync sets up tailComplete via a single-page forward that hits end_of_data.
    // Then we inspect the second sync, which should only emit sync.forward (no backfill).
    const connector = scripted([
      { items: [makeItem('#x')], nextCursor: null },
    ])
    await Effect.runPromise(
      engine.syncEffect(connector, { direction: 'both', delayMs: 0 }).pipe(
        Effect.withTracer(collectingTracer([])),
      ),
    )

    // Second cycle — this is the one we observe
    const connector2 = scripted([
      { items: [makeItem('#x')], nextCursor: null },
    ])
    await Effect.runPromise(
      engine.syncEffect(connector2, { direction: 'both', delayMs: 0 }).pipe(
        Effect.withTracer(tracer),
      ),
    )

    const names = spans.map((s) => s.name)
    expect(names).toContain('sync.forward')
    expect(names).not.toContain('sync.backfill')
  })
})
