import type {
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

export type SchedulerEvent =
  | { type: 'sync-start'; connectorId: string }
  | { type: 'sync-progress'; progress: SyncProgress }
  | { type: 'sync-complete'; result: import('./types.js').ConnectorSyncResult }
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
  private started = false
  private eventHandlers: SchedulerEventHandler[] = []
  // Effect runtime. Production: Layer.empty (default clock). Tests inject
  // ManagedRuntime.make(TestContext.TestContext) to gain TestClock.
  private runtime: ManagedRuntime.ManagedRuntime<never, never>
  // Concurrency gate. Created on start() so config.concurrency is honored
  // even if the config were swapped between start/stop cycles.
  private semaphore: Effect.Semaphore | null = null

  constructor(
    private db: Database.Database,
    private registry: ConnectorRegistry,
    config?: Partial<ScheduleConfig>,
    runtime?: ManagedRuntime.ManagedRuntime<never, never>,
  ) {
    this.engine = new SyncEngine(db)
    this.config = { ...DEFAULT_SCHEDULE, ...config }
    this.runtime = runtime ?? ManagedRuntime.make(Layer.empty)
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.started) return
    this.started = true

    this.semaphore = Effect.runSync(Effect.makeSemaphore(this.config.concurrency))

    // Queue immediate forward sync for all enabled connectors synchronously
    // so observers of the queue right after start() see it populated.
    this.queueAll('both', 80)

    // Tick fiber: first run happens inside a bootstrap so the 30s Schedule
    // doesn't delay startup, then Effect.repeat drives the cadence.
    const tickProgram = pipe(
      this.tickOnceEffect(),
      Effect.repeat(Schedule.spaced(Duration.seconds(30))),
      Effect.asVoid,
      Effect.catchAllCause((cause) =>
        Effect.logError('scheduler tick fiber crashed', cause),
      ),
    )
    this.tickFiber = this.runtime.runFork(tickProgram)
  }

  stop(): void {
    this.started = false
    if (this.tickFiber) {
      // Fire-and-forget interrupt. The fiber respects Effect interruption at
      // its next yield point. runJob fibers are siblings (not children), so
      // this does NOT cascade to in-flight syncs — they unwind via the
      // per-job Deferred below.
      this.runtime.runFork(Fiber.interrupt(this.tickFiber))
      this.tickFiber = null
    }
    for (const [, deferred] of this.running) {
      Effect.runSync(Deferred.succeed(deferred, void 0))
    }
    this.running.clear()
    this.queue = []
    this.semaphore = null
  }

  /** Manually trigger sync for a specific connector. */
  triggerNow(connectorId: string, direction: 'forward' | 'backfill' | 'both' = 'both'): void {
    this.enqueue({ connectorId, direction, priority: 100, queuedAt: Date.now() })
    this.runtime.runFork(this.tickOnceEffect())
  }

  /** Notify the scheduler that the system woke from sleep. */
  onWake(): void {
    this.queueAll('forward', 60)
    this.runtime.runFork(this.tickOnceEffect())
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

    return { running: this.started, connectors }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private emit(event: SchedulerEvent): void {
    for (const handler of this.eventHandlers) {
      try { handler(event) } catch {}
    }
  }

  private queueAll(direction: 'forward' | 'backfill' | 'both', priority: SyncJobPriority): void {
    for (const connector of this.registry.list()) {
      const state = loadSyncState(this.db, connector.id)
      if (!state.enabled) continue
      this.enqueue({ connectorId: connector.id, direction, priority, queuedAt: Date.now() })
    }
  }

  private enqueue(job: SyncJob): void {
    // Don't queue if already queued or running
    if (this.running.has(job.connectorId)) return
    if (this.queue.some(j => j.connectorId === job.connectorId)) {
      // Replace with higher priority if applicable
      this.queue = this.queue.map(j =>
        j.connectorId === job.connectorId && job.priority > j.priority ? job : j,
      )
      return
    }
    this.queue.push(job)
    this.queue.sort((a, b) => b.priority - a.priority)
  }

  /**
   * One pass of the scheduling decision loop: read Clock, scan connectors for
   * due syncs, enqueue them, and fork runJob fibers for as many queued jobs as
   * the semaphore will allow. Called from the tick fiber's repeat loop and
   * from triggerNow()/onWake() as an immediate poke.
   */
  private tickOnceEffect(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      if (!self.started) return

      const now = yield* Clock.currentTimeMillis

      for (const connector of self.registry.list()) {
        const state = loadSyncState(self.db, connector.id)
        if (!state.enabled) continue

        // Skip if in backoff due to errors.
        if (state.consecutiveErrors > 0 && state.lastErrorAt) {
          const backoffMs = self.getBackoffMs(state.consecutiveErrors)
          if (now - new Date(state.lastErrorAt).getTime() < backoffMs) continue
        }

        // Skip if needsReauth
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

      // Drain queue up to concurrency limit. The semaphore is the *real* gate
      // on how many jobs run simultaneously; this loop just submits as many
      // fibers as we have queued work for.
      while (self.queue.length > 0 && self.running.size < self.config.concurrency) {
        const job = self.queue.shift()!
        // Fork as a sibling of the tick fiber, NOT a child — stop()'s
        // interrupt of the tick fiber must not cascade and short-circuit
        // in-flight sync state persistence.
        yield* Effect.sync(() => self.runtime.runFork(self.runJobEffect(job)))
      }
    })
  }

  /**
   * Build the Effect that runs a single sync job. Wraps the inner body with
   * `semaphore.withPermits(1)` so at most `config.concurrency` jobs execute in
   * parallel.
   */
  private runJobEffect(job: SyncJob): Effect.Effect<void> {
    const self = this
    const semaphore = this.semaphore
    if (!semaphore) return Effect.void

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
      semaphore.withPermits(1)(body),
      Effect.ensuring(
        Effect.sync(() => {
          self.running.delete(job.connectorId)
          // When a permit frees up, immediately try to drain more queued work
          // instead of waiting 30s for the next periodic tick.
          if (self.queue.length > 0 && self.started) {
            self.runtime.runFork(self.tickOnceEffect())
          }
        }),
      ),
      // Defect in the forked fiber must not take down the runtime.
      Effect.catchAllCause((cause) =>
        Effect.sync(() => {
          self.emit({
            type: 'sync-error',
            connectorId: job.connectorId,
            code: SyncErrorCode.CONNECTOR_ERROR,
            message: `runJob defect: ${cause.toString()}`,
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
