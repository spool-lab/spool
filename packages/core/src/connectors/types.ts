import type { CapturedItem } from '../types.js'

// ── Error Types ─────────────────────────────────────────────────────────────

/**
 * Enumerated sync error codes.
 *
 * Every error that can occur during sync maps to one of these codes so the UI
 * can display a specific, actionable message and we can track failure patterns.
 */
export enum SyncErrorCode {
  // ── Auth ────────────────────────────────────────────────────────────
  /** Chrome is not installed or the Cookies DB was not found. */
  AUTH_CHROME_NOT_FOUND = 'AUTH_CHROME_NOT_FOUND',
  /** The user is not logged into the platform in Chrome. */
  AUTH_NOT_LOGGED_IN = 'AUTH_NOT_LOGGED_IN',
  /** Chrome cookie decryption failed (wrong profile, Chrome open, etc). */
  AUTH_COOKIE_DECRYPT_FAILED = 'AUTH_COOKIE_DECRYPT_FAILED',
  /** macOS Keychain access denied or password not found. */
  AUTH_KEYCHAIN_DENIED = 'AUTH_KEYCHAIN_DENIED',
  /** Session expired mid-sync (401/403 from API). */
  AUTH_SESSION_EXPIRED = 'AUTH_SESSION_EXPIRED',
  /** Generic auth failure not covered above. */
  AUTH_UNKNOWN = 'AUTH_UNKNOWN',

  // ── Network / API ──────────────────────────────────────────────────
  /** Rate limited by the platform (429). Retry later. */
  API_RATE_LIMITED = 'API_RATE_LIMITED',
  /** Platform returned a server error (5xx). */
  API_SERVER_ERROR = 'API_SERVER_ERROR',
  /** Network unreachable or DNS failure. */
  NETWORK_OFFLINE = 'NETWORK_OFFLINE',
  /** Request timed out. */
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  /** API response could not be parsed (schema change?). */
  API_PARSE_ERROR = 'API_PARSE_ERROR',
  /** API returned an unexpected status code. */
  API_UNEXPECTED_STATUS = 'API_UNEXPECTED_STATUS',

  // ── Sync engine ────────────────────────────────────────────────────
  /** Exceeded max pages per sync cycle. */
  SYNC_MAX_PAGES = 'SYNC_MAX_PAGES',
  /** Exceeded max runtime per sync cycle. */
  SYNC_TIMEOUT = 'SYNC_TIMEOUT',
  /** Sync was cancelled (app quit, user abort). */
  SYNC_CANCELLED = 'SYNC_CANCELLED',

  // ── Storage ────────────────────────────────────────────────────────
  /** Database write failed. */
  DB_WRITE_ERROR = 'DB_WRITE_ERROR',

  // ── Connector ──────────────────────────────────────────────────────
  /** A connector-specific error not covered by other codes. */
  CONNECTOR_ERROR = 'CONNECTOR_ERROR',
}

/**
 * Human-readable hints for each error code.
 * Shown in the sync UI so the user knows what happened and how to fix it.
 */
export const SYNC_ERROR_HINTS: Record<SyncErrorCode, string> = {
  [SyncErrorCode.AUTH_CHROME_NOT_FOUND]:
    'Chrome is not installed, or the cookies database was not found. Install Google Chrome and open it at least once.',
  [SyncErrorCode.AUTH_NOT_LOGGED_IN]:
    'You are not logged into this platform in Chrome. Open Chrome, log in, then retry.',
  [SyncErrorCode.AUTH_COOKIE_DECRYPT_FAILED]:
    'Could not decrypt Chrome cookies. Try closing Chrome completely and retrying. If using a non-default profile, check your connector settings.',
  [SyncErrorCode.AUTH_KEYCHAIN_DENIED]:
    'Could not read the Chrome encryption key from macOS Keychain. You may need to grant access in System Settings > Privacy > Keychain.',
  [SyncErrorCode.AUTH_SESSION_EXPIRED]:
    'Your session expired during sync. Open Chrome, visit the platform to refresh your login, then retry.',
  [SyncErrorCode.AUTH_UNKNOWN]:
    'Authentication failed for an unknown reason. Check that you are logged in via Chrome and retry.',
  [SyncErrorCode.API_RATE_LIMITED]:
    'The platform rate-limited requests. Spool will retry automatically after a cooldown.',
  [SyncErrorCode.API_SERVER_ERROR]:
    'The platform returned a server error. This is usually temporary — Spool will retry later.',
  [SyncErrorCode.NETWORK_OFFLINE]:
    'No internet connection. Spool will sync when connectivity is restored.',
  [SyncErrorCode.NETWORK_TIMEOUT]:
    'The request timed out. Check your internet connection. Spool will retry later.',
  [SyncErrorCode.API_PARSE_ERROR]:
    'The platform returned an unexpected response format. This may indicate an API change — check for Spool updates.',
  [SyncErrorCode.API_UNEXPECTED_STATUS]:
    'The platform returned an unexpected HTTP status. This may be temporary — Spool will retry later.',
  [SyncErrorCode.SYNC_MAX_PAGES]:
    'Sync stopped after reaching the page limit. Remaining data will be fetched in the next cycle.',
  [SyncErrorCode.SYNC_TIMEOUT]:
    'Sync stopped after reaching the time limit. Remaining data will be fetched in the next cycle.',
  [SyncErrorCode.SYNC_CANCELLED]:
    'Sync was cancelled. It will resume in the next cycle.',
  [SyncErrorCode.DB_WRITE_ERROR]:
    'Failed to write to the local database. Check disk space and permissions for ~/.spool/',
  [SyncErrorCode.CONNECTOR_ERROR]:
    'The connector encountered an error. Check the error details below.',
}

export class SyncError extends Error {
  public readonly code: SyncErrorCode
  public override readonly cause?: unknown

  constructor(
    code: SyncErrorCode,
    message?: string,
    cause?: unknown,
  ) {
    super(message ?? SYNC_ERROR_HINTS[code])
    this.name = 'SyncError'
    this.code = code
    this.cause = cause
  }

  /** Whether this error indicates the connector needs re-authentication. */
  get needsReauth(): boolean {
    return this.code.startsWith('AUTH_')
  }

  /** Whether this error is transient and the sync can be retried. */
  get retryable(): boolean {
    switch (this.code) {
      case SyncErrorCode.API_RATE_LIMITED:
      case SyncErrorCode.API_SERVER_ERROR:
      case SyncErrorCode.NETWORK_OFFLINE:
      case SyncErrorCode.NETWORK_TIMEOUT:
      case SyncErrorCode.SYNC_MAX_PAGES:
      case SyncErrorCode.SYNC_TIMEOUT:
      case SyncErrorCode.SYNC_CANCELLED:
        return true
      default:
        return false
    }
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthStatus {
  ok: boolean
  error?: SyncErrorCode
  message?: string
  /** Actionable guidance for the user. */
  hint?: string
}

// ── Connector ────────────────────────────────────────────────────────────────

export interface PageResult {
  items: CapturedItem[]
  /** Cursor for the next page. null = no more data. */
  nextCursor: string | null
}

export interface FetchContext {
  /** Pagination cursor. null = start from the newest page. */
  cursor: string | null
  /** Platform ID of the newest known item (head anchor). null = no anchor. */
  sinceItemId: string | null
  /** Which sync phase is requesting this page. */
  phase: 'forward' | 'backfill'
}

export interface Connector {
  /** Unique identifier, e.g. 'twitter-bookmarks'. */
  readonly id: string
  /** Platform name for grouping, e.g. 'twitter'. */
  readonly platform: string
  /** Human-readable label, e.g. 'X Bookmarks'. */
  readonly label: string
  /** Short description for the connector picker. */
  readonly description: string
  /** UI color for badges/dots. */
  readonly color: string
  /** Ephemeral = cache (full-replace), persistent = user-owned (dual-frontier). */
  readonly ephemeral: boolean

  /** Check if authentication / prerequisites are available. */
  checkAuth(opts?: Record<string, string>): Promise<AuthStatus>

  /**
   * Fetch one page of data.
   *
   * The sync engine calls this repeatedly, following nextCursor.
   * The connector handles API-level retries (429, 5xx) internally.
   * If retries are exhausted, throw a SyncError.
   */
  fetchPage(ctx: FetchContext): Promise<PageResult>
}

// ── Sync State ───────────────────────────────────────────────────────────────

export interface SyncState {
  connectorId: string
  // Head frontier (newest end)
  headCursor: string | null
  headItemId: string | null
  // Tail frontier (oldest end)
  tailCursor: string | null
  tailComplete: boolean
  // Metadata
  lastForwardSyncAt: string | null
  lastBackfillSyncAt: string | null
  totalSynced: number
  consecutiveErrors: number
  enabled: boolean
  /** Per-connector config overrides (e.g. Chrome profile). */
  configJson: Record<string, unknown>
  /** When the last error occurred (ISO 8601). Used as the backoff base time.
   *  Cleared on successful sync. */
  lastErrorAt: string | null
  /** Last error code, null if last sync succeeded. */
  lastErrorCode: SyncErrorCode | null
  /** Last error message for UI display. */
  lastErrorMessage: string | null
}

// ── Sync Options & Results ───────────────────────────────────────────────────

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

// ── Scheduler ────────────────────────────────────────────────────────────────

export interface ScheduleConfig {
  /** Forward sync interval in ms. Default: 15 min. */
  forwardIntervalMs: number
  /** Backfill interval in ms. Default: 60 min. */
  backfillIntervalMs: number
  /** Max concurrent connector syncs. Default: 1. */
  concurrency: number
  /** Default delay between pages. Default: 600ms. */
  pageDelayMs: number
  /** Retry backoff sequence in ms. */
  retryBackoffMs: number[]
  /**
   * Max time for a single scheduled sync run in minutes.
   * Only applies to scheduler-initiated syncs.
   * 0 = unlimited (used by CLI full sync). Default: 10.
   */
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
