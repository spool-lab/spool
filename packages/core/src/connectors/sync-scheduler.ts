import type {
  Connector,
  SyncJob,
  SyncJobPriority,
  ConnectorSyncResult,
  ScheduleConfig,
  SchedulerStatus,
  ConnectorStatus,
  SyncProgress,
} from './types.js'
import { DEFAULT_SCHEDULE, SyncErrorCode } from './types.js'
import type { ConnectorRegistry } from './registry.js'
import { SyncEngine, loadSyncState } from './sync-engine.js'
import type Database from 'better-sqlite3'

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
  private running = new Map<string, AbortController>()
  private timer: ReturnType<typeof setInterval> | null = null
  private started = false
  private eventHandlers: SchedulerEventHandler[] = []

  constructor(
    private db: Database.Database,
    private registry: ConnectorRegistry,
    config?: Partial<ScheduleConfig>,
  ) {
    this.engine = new SyncEngine(db)
    this.config = { ...DEFAULT_SCHEDULE, ...config }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.started) return
    this.started = true

    // Queue immediate forward sync for all enabled connectors
    this.queueAll('both', 80)

    // Start the tick loop (check every 30 seconds)
    this.timer = setInterval(() => this.tick(), 30_000)
    // Run first tick immediately
    this.tick()
  }

  stop(): void {
    this.started = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    // Abort all running syncs
    for (const [, controller] of this.running) {
      controller.abort()
    }
    this.running.clear()
    this.queue = []
  }

  /** Manually trigger sync for a specific connector. */
  triggerNow(connectorId: string, direction: 'forward' | 'backfill' | 'both' = 'both'): void {
    this.enqueue({ connectorId, direction, priority: 100, queuedAt: Date.now() })
    this.tick()
  }

  /** Notify the scheduler that the system woke from sleep. */
  onWake(): void {
    this.queueAll('forward', 60)
    this.tick()
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

  private tick(): void {
    if (!this.started) return

    // Check if any connectors are due for scheduled sync
    const now = Date.now()
    for (const connector of this.registry.list()) {
      const state = loadSyncState(this.db, connector.id)
      if (!state.enabled) continue

      // Skip if in backoff due to errors.
      // Use lastErrorAt (when the error occurred) as the backoff base, not
      // lastForwardSyncAt/lastBackfillSyncAt (which may be from an earlier
      // successful sync and would under-count the backoff window).
      if (state.consecutiveErrors > 0 && state.lastErrorAt) {
        const backoffMs = this.getBackoffMs(state.consecutiveErrors)
        if (now - new Date(state.lastErrorAt).getTime() < backoffMs) {
          continue
        }
      }

      // Skip if needsReauth
      if (state.lastErrorCode?.startsWith('AUTH_')) continue

      // Forward sync due?
      const lastForward = state.lastForwardSyncAt
        ? new Date(state.lastForwardSyncAt).getTime()
        : 0
      if (now - lastForward >= this.config.forwardIntervalMs) {
        this.enqueue({
          connectorId: connector.id,
          direction: 'forward',
          priority: 40,
          queuedAt: now,
        })
      }

      // Backfill due?
      if (!state.tailComplete) {
        const lastBackfill = state.lastBackfillSyncAt
          ? new Date(state.lastBackfillSyncAt).getTime()
          : 0
        if (now - lastBackfill >= this.config.backfillIntervalMs) {
          this.enqueue({
            connectorId: connector.id,
            direction: 'backfill',
            priority: 20,
            queuedAt: now,
          })
        }
      }
    }

    // Run jobs up to concurrency limit
    while (this.running.size < this.config.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!
      this.runJob(job)
    }
  }

  private async runJob(job: SyncJob): Promise<void> {
    if (!this.registry.has(job.connectorId)) return

    const connector = this.registry.get(job.connectorId)
    const controller = new AbortController()
    this.running.set(job.connectorId, controller)

    this.emit({ type: 'sync-start', connectorId: job.connectorId })

    try {
      const result = await this.engine.sync(connector, {
        direction: job.direction,
        delayMs: this.config.pageDelayMs,
        maxMinutes: this.config.maxMinutesPerRun,
        signal: controller.signal,
        onProgress: (progress) => {
          this.emit({ type: 'sync-progress', progress })
        },
      })

      this.emit({ type: 'sync-complete', result })

      if (result.error) {
        this.emit({
          type: 'sync-error',
          connectorId: job.connectorId,
          code: result.error.code as SyncErrorCode,
          message: result.error.message,
        })
      }
    } catch (err) {
      this.emit({
        type: 'sync-error',
        connectorId: job.connectorId,
        code: SyncErrorCode.CONNECTOR_ERROR,
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      this.running.delete(job.connectorId)
      // Trigger next tick to pick up queued jobs
      if (this.queue.length > 0) {
        // Use setTimeout to avoid stack overflow from recursive tick
        setTimeout(() => this.tick(), 0)
      }
    }
  }

  private getBackoffMs(consecutiveErrors: number): number {
    const idx = Math.min(consecutiveErrors - 1, this.config.retryBackoffMs.length - 1)
    return this.config.retryBackoffMs[idx] ?? this.config.retryBackoffMs.at(-1) ?? 60_000
  }
}
