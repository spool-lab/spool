import type {
  ConnectorSyncResult,
  SyncJob,
  SyncJobPriority,
  ScheduleConfig,
  SchedulerStatus,
  ConnectorStatus,
  SyncProgress,
} from './types.js'
import { DEFAULT_SCHEDULE, SyncErrorCode } from './types.js'
import type { ConnectorRegistry } from './registry.js'
import { SyncEngine, loadSyncState } from './sync-engine.js'
import type Database from 'better-sqlite3'
import {
  Cause,
  Clock,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  ManagedRuntime,
  pipe,
  Schedule,
} from 'effect'

type Direction = SyncJob['direction']

export type SchedulerEvent =
  | { type: 'sync-start'; connectorId: string }
  | { type: 'sync-progress'; progress: SyncProgress }
  | { type: 'sync-complete'; result: ConnectorSyncResult }
  | { type: 'sync-error'; connectorId: string; code: SyncErrorCode; message: string }

export type SchedulerEventHandler = (event: SchedulerEvent) => void

export class SyncScheduler {
  private engine: SyncEngine
  private config: ScheduleConfig
  private queue: SyncJob[] = []
  // Per-job cancel tokens. Fired by stop() so in-flight syncs wind down
  // cooperatively (engine checks Deferred.isDone at every loop yield point).
  private running = new Map<string, Deferred.Deferred<void>>()
  private tickFiber: Fiber.RuntimeFiber<void, never> | null = null
  private eventHandlers: SchedulerEventHandler[] = []
  // Production: Layer.empty. Tests inject TestContext.TestContext for TestClock.
  private runtime: ManagedRuntime.ManagedRuntime<never, never>
  private semaphore: Effect.Semaphore

  constructor(
    private db: Database.Database,
    private registry: ConnectorRegistry,
    config?: Partial<ScheduleConfig>,
    runtime?: ManagedRuntime.ManagedRuntime<never, never>,
  ) {
    this.engine = new SyncEngine(db)
    this.config = { ...DEFAULT_SCHEDULE, ...config }
    this.runtime = runtime ?? ManagedRuntime.make(Layer.empty)
    this.semaphore = Effect.runSync(Effect.makeSemaphore(this.config.concurrency))
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.tickFiber) return

    // Queue immediate forward sync synchronously so observers of the queue
    // right after start() see it populated.
    this.queueAll('both', 80)

    const tickProgram = pipe(
      this.tickOnceEffect(),
      Effect.repeat(Schedule.spaced(Duration.seconds(30))),
      Effect.asVoid,
      Effect.catchAllCause((cause) =>
        Cause.isInterruptedOnly(cause)
          ? Effect.void
          : Effect.logError('scheduler tick fiber crashed', cause),
      ),
    )
    this.tickFiber = this.runtime.runFork(tickProgram)
  }

  stop(): void {
    if (this.tickFiber) {
      // Fire-and-forget interrupt. runJob fibers are siblings (not children),
      // so this does NOT cascade to in-flight syncs — they unwind via the
      // per-job Deferred below.
      this.runtime.runFork(Fiber.interrupt(this.tickFiber))
      this.tickFiber = null
    }
    for (const [, deferred] of this.running) {
      Effect.runSync(Deferred.succeed(deferred, void 0))
    }
    this.running.clear()
    this.queue = []
  }

  /** Manually trigger sync for a specific connector. */
  triggerNow(connectorId: string, direction: Direction = 'both'): void {
    this.enqueue({ connectorId, direction, priority: 100, queuedAt: Date.now() })
    this.poke()
  }

  /** Notify the scheduler that the system woke from sleep. */
  onWake(): void {
    this.queueAll('forward', 60)
    this.poke()
  }

  /** Subscribe to scheduler events. */
  on(handler: SchedulerEventHandler): () => void {
    this.eventHandlers.push(handler)
    return () => {
      this.eventHandlers = this.eventHandlers.filter(h => h !== handler)
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  getStatus(): SchedulerStatus {
    const connectors: ConnectorStatus[] = this.registry.list().map(c => {
      const state = loadSyncState(this.db, c.id)
      return {
        id: c.id,
        label: c.label,
        description: c.description,
        platform: c.platform,
        color: c.color,
        enabled: state.enabled,
        syncing: this.running.has(c.id),
        state,
      }
    })

    return { running: this.tickFiber !== null, connectors }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private emit(event: SchedulerEvent): void {
    for (const handler of this.eventHandlers) {
      try { handler(event) } catch {}
    }
  }

  private poke(): void {
    this.runtime.runFork(this.tickOnceEffect())
  }

  private queueAll(direction: Direction, priority: SyncJobPriority): void {
    for (const connector of this.registry.list()) {
      const state = loadSyncState(this.db, connector.id)
      if (!state.enabled) continue
      this.enqueue({ connectorId: connector.id, direction, priority, queuedAt: Date.now() })
    }
  }

  private enqueue(job: SyncJob): void {
    if (this.running.has(job.connectorId)) return
    if (this.queue.some(j => j.connectorId === job.connectorId)) {
      this.queue = this.queue.map(j =>
        j.connectorId === job.connectorId && job.priority > j.priority ? job : j,
      )
      return
    }
    this.queue.push(job)
    this.queue.sort((a, b) => b.priority - a.priority)
  }

  private tickOnceEffect(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      if (self.tickFiber === null) return

      const now = yield* Clock.currentTimeMillis

      for (const connector of self.registry.list()) {
        const state = loadSyncState(self.db, connector.id)
        if (!state.enabled) continue

        if (state.consecutiveErrors > 0 && state.lastErrorAt) {
          const backoffMs = self.getBackoffMs(state.consecutiveErrors)
          if (now - new Date(state.lastErrorAt).getTime() < backoffMs) continue
        }

        if (state.lastErrorCode?.startsWith('AUTH_')) continue

        const lastForward = state.lastForwardSyncAt
          ? new Date(state.lastForwardSyncAt).getTime()
          : 0
        if (now - lastForward >= self.config.forwardIntervalMs) {
          self.enqueue({
            connectorId: connector.id,
            direction: 'forward',
            priority: 40,
            queuedAt: now,
          })
        }

        if (!state.tailComplete) {
          const lastBackfill = state.lastBackfillSyncAt
            ? new Date(state.lastBackfillSyncAt).getTime()
            : 0
          if (now - lastBackfill >= self.config.backfillIntervalMs) {
            self.enqueue({
              connectorId: connector.id,
              direction: 'backfill',
              priority: 20,
              queuedAt: now,
            })
          }
        }
      }

      yield* Effect.sync(() => self.drainQueue())
    })
  }

  // Drain queued work up to concurrency. The semaphore is the *real* gate on
  // how many jobs run simultaneously; this loop just submits fibers.
  // Fork as siblings of the tick fiber, NOT children — stop()'s interrupt of
  // the tick fiber must not cascade and short-circuit in-flight state persistence.
  private drainQueue(): void {
    while (this.queue.length > 0 && this.running.size < this.config.concurrency) {
      const job = this.queue.shift()!
      this.runtime.runFork(this.runJobEffect(job))
    }
  }

  private runJobEffect(job: SyncJob): Effect.Effect<void> {
    const self = this

    const body = Effect.gen(function* () {
      if (!self.registry.has(job.connectorId)) return
      const connector = self.registry.get(job.connectorId)

      const cancel = yield* Deferred.make<void>()
      yield* Effect.sync(() => {
        self.running.set(job.connectorId, cancel)
      })

      yield* Effect.sync(() =>
        self.emit({ type: 'sync-start', connectorId: job.connectorId }),
      )

      const result = yield* self.engine.syncEffect(connector, {
        direction: job.direction,
        delayMs: self.config.pageDelayMs,
        maxMinutes: self.config.maxMinutesPerRun,
        cancel,
        onProgress: (progress) => {
          self.emit({ type: 'sync-progress', progress })
        },
      })

      yield* Effect.sync(() => {
        self.emit({ type: 'sync-complete', result })
        if (result.error) {
          self.emit({
            type: 'sync-error',
            connectorId: job.connectorId,
            code: result.error.code as SyncErrorCode,
            message: result.error.message,
          })
        }
      })
    })

    return pipe(
      this.semaphore.withPermits(1)(body),
      Effect.ensuring(
        Effect.sync(() => {
          self.running.delete(job.connectorId)
          // Drain remaining queue immediately rather than waiting 30s for the
          // next periodic tick. Skips the connector rescan in tickOnceEffect.
          if (self.queue.length > 0 && self.tickFiber !== null) {
            self.drainQueue()
          }
        }),
      ),
      Effect.catchAllCause((cause) =>
        Cause.isInterruptedOnly(cause)
          ? Effect.void
          : Effect.sync(() => {
              self.emit({
                type: 'sync-error',
                connectorId: job.connectorId,
                code: SyncErrorCode.CONNECTOR_ERROR,
                message: `runJob defect: ${Cause.pretty(cause)}`,
              })
            }),
      ),
    )
  }

  private getBackoffMs(consecutiveErrors: number): number {
    const idx = Math.min(consecutiveErrors - 1, this.config.retryBackoffMs.length - 1)
    return this.config.retryBackoffMs[idx] ?? this.config.retryBackoffMs.at(-1) ?? 60_000
  }
}
