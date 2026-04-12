import { Data } from 'effect'
import type { Deferred } from 'effect'
import type {
  Connector,
  AuthStatus,
  PageResult,
  FetchContext,
  CapturedItem,
  SyncState,
} from '@spool/connector-sdk'
import { SyncError as SdkSyncError, SyncErrorCode, SYNC_ERROR_HINTS } from '@spool/connector-sdk'

// ── Re-exports from SDK ────────────────────────────────────────────────────
export {
  SyncErrorCode,
  SYNC_ERROR_HINTS,
} from '@spool/connector-sdk'
export type {
  Connector,
  AuthStatus,
  PageResult,
  FetchContext,
  CapturedItem,
  SyncState,
} from '@spool/connector-sdk'

// ── Internal Effect-tagged SyncError ──────────────────────────────────────
const RETRYABLE_CODES = new Set<SyncErrorCode>([
  SyncErrorCode.API_RATE_LIMITED,
  SyncErrorCode.API_SERVER_ERROR,
  SyncErrorCode.NETWORK_OFFLINE,
  SyncErrorCode.NETWORK_TIMEOUT,
  SyncErrorCode.SYNC_MAX_PAGES,
  SyncErrorCode.SYNC_TIMEOUT,
  SyncErrorCode.SYNC_CANCELLED,
])

/**
 * Internal Effect-tagged version of SyncError used inside @spool/core for
 * Effect's typed error channel. External callers (connectors) use the plain
 * class exported from @spool/connector-sdk. Translation between the two
 * happens in SyncError.from().
 */
export class SyncError extends Data.TaggedError('SyncError')<{
  readonly code: SyncErrorCode
  readonly message: string
  readonly cause?: unknown
}> {
  constructor(code: SyncErrorCode, message?: string, cause?: unknown) {
    super({ code, message: message ?? SYNC_ERROR_HINTS[code], cause })
  }

  static from(e: unknown): SyncError {
    if (e instanceof SyncError) return e
    if (e instanceof SdkSyncError) {
      return new SyncError(e.code, e.message, e.cause)
    }
    return new SyncError(
      SyncErrorCode.CONNECTOR_ERROR,
      e instanceof Error ? e.message : String(e),
      e,
    )
  }

  /** Whether this error indicates the connector needs re-authentication. */
  get needsReauth(): boolean {
    return this.code.startsWith('AUTH_')
  }

  /** Whether this error is transient and the sync can be retried. */
  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code)
  }
}

// ── SyncOptions / SyncProgress / ConnectorSyncResult ──────────────────────

export interface SyncOptions {
  /** Which direction to sync. Default: 'both'. */
  direction?: 'forward' | 'backfill' | 'both'
  /** Delay between page requests in ms. Default: 600. */
  delayMs?: number
  /** Max runtime in minutes. 0 = unlimited. Default: 0 (no limit). */
  maxMinutes?: number
  /** Consecutive pages with 0 new items before stopping forward sync. Default: 3. */
  stalePageLimit?: number
  /** AbortSignal for cancellation. */
  signal?: AbortSignal
  /**
   * Caller-owned cancellation Deferred. When provided, syncEffect uses this
   * instead of creating its own — allowing callers like SyncScheduler to
   * cancel from outside. If `signal` is also set, it is bridged into this
   * Deferred.
   */
  cancel?: Deferred.Deferred<void>
  /** Progress callback. */
  onProgress?: (progress: SyncProgress) => void
}

export interface SyncProgress {
  connectorId: string
  phase: 'forward' | 'backfill'
  page: number
  fetched: number
  added: number
  running: boolean
}

export interface ConnectorSyncResult {
  connectorId: string
  added: number
  total: number
  pages: number
  direction: 'forward' | 'backfill' | 'both'
  stopReason: string
  error?: {
    code: SyncErrorCode
    message: string
  }
}

// ── Scheduler types (remain in core) ──────────────────────────────────────

export interface ScheduleConfig {
  forwardIntervalMs: number
  backfillIntervalMs: number
  concurrency: number
  pageDelayMs: number
  retryBackoffMs: number[]
  maxMinutesPerRun: number
}

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  forwardIntervalMs: 15 * 60_000,
  backfillIntervalMs: 60 * 60_000,
  concurrency: 1,
  pageDelayMs: 1200,
  retryBackoffMs: [60_000, 300_000, 1_800_000, 7_200_000],
  maxMinutesPerRun: 10,
}

export type SyncJobPriority = 100 | 80 | 60 | 40 | 20

export interface SyncJob {
  connectorId: string
  direction: 'forward' | 'backfill' | 'both'
  priority: SyncJobPriority
  queuedAt: number
}

export interface ConnectorStatus {
  id: string
  label: string
  description: string
  platform: string
  color: string
  enabled: boolean
  syncing: boolean
  state: SyncState
}

export interface SchedulerStatus {
  running: boolean
  connectors: ConnectorStatus[]
}
