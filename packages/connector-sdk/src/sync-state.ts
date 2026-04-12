import type { SyncErrorCode } from './errors.js'

/**
 * Per-connector sync state. Persisted in SQLite by the framework.
 * Plugins do not mutate this directly — the framework manages it.
 *
 * This type is exported from the SDK for reference (docs, type imports)
 * but plugins never construct or modify SyncState instances.
 */
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
