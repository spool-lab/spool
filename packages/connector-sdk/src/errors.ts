/**
 * Enumerated sync error codes.
 *
 * Every error that can occur during sync maps to one of these codes so the UI
 * can display a specific, actionable message and track failure patterns.
 */
export enum SyncErrorCode {
  // ── Auth ────────────────────────────────────────────────────────────
  AUTH_CHROME_NOT_FOUND = 'AUTH_CHROME_NOT_FOUND',
  AUTH_NOT_LOGGED_IN = 'AUTH_NOT_LOGGED_IN',
  AUTH_COOKIE_DECRYPT_FAILED = 'AUTH_COOKIE_DECRYPT_FAILED',
  AUTH_KEYCHAIN_DENIED = 'AUTH_KEYCHAIN_DENIED',
  AUTH_SESSION_EXPIRED = 'AUTH_SESSION_EXPIRED',
  AUTH_UNKNOWN = 'AUTH_UNKNOWN',

  // ── Network / API ──────────────────────────────────────────────────
  API_RATE_LIMITED = 'API_RATE_LIMITED',
  API_SERVER_ERROR = 'API_SERVER_ERROR',
  NETWORK_OFFLINE = 'NETWORK_OFFLINE',
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  API_PARSE_ERROR = 'API_PARSE_ERROR',
  API_UNEXPECTED_STATUS = 'API_UNEXPECTED_STATUS',

  // ── Sync engine ────────────────────────────────────────────────────
  SYNC_MAX_PAGES = 'SYNC_MAX_PAGES',
  SYNC_TIMEOUT = 'SYNC_TIMEOUT',
  SYNC_CANCELLED = 'SYNC_CANCELLED',

  // ── Storage ────────────────────────────────────────────────────────
  DB_WRITE_ERROR = 'DB_WRITE_ERROR',

  // ── Connector ──────────────────────────────────────────────────────
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
 * Error thrown by connectors and the sync engine. Tagged with a machine-readable
 * SyncErrorCode so the framework and UI can classify and respond.
 *
 * This is a plain class, not `Data.TaggedError` — the SDK cannot depend on
 * `effect`. `@spool/core` wraps this in an `Effect.Cause` boundary internally.
 */
export class SyncError extends Error {
  readonly _tag = 'SyncError' as const
  readonly code: SyncErrorCode
  override readonly cause?: unknown

  constructor(code: SyncErrorCode, message?: string, cause?: unknown) {
    super(message ?? SYNC_ERROR_HINTS[code])
    this.name = 'SyncError'
    this.code = code
    this.cause = cause
  }

  static from(e: unknown): SyncError {
    if (e instanceof SyncError) return e
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
