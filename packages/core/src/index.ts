export * from './types.js'
export * from './db/db.js'
export * from './db/queries.js'
export * from './parsers/claude.js'
export * from './parsers/codex.js'
export * from './parsers/gemini.js'
export * from './sync/syncer.js'
export * from './sync/watcher.js'
export { searchFragments, searchCaptures, searchAll } from './db/queries.js'
export { resolveSystemBinary, cachedResolve, clearResolveCache } from './util/resolve-bin.js'

// ── Connector framework ─────────────────────────────────────────────────────
export { ConnectorRegistry } from './connectors/registry.js'
export { SyncEngine, loadSyncState, saveSyncState } from './connectors/sync-engine.js'
export { SyncScheduler } from './connectors/sync-scheduler.js'
export type { SchedulerEvent, SchedulerEventHandler } from './connectors/sync-scheduler.js'
export {
  SyncError,
  SyncErrorCode,
  SYNC_ERROR_HINTS,
  DEFAULT_SCHEDULE,
} from './connectors/types.js'
export type {
  Connector,
  AuthStatus,
  FetchContext,
  PageResult,
  SyncState,
  SyncOptions,
  ConnectorSyncResult,
  SyncProgress,
  SyncJob,
  ScheduleConfig,
  ConnectorStatus,
  SchedulerStatus,
} from './connectors/types.js'

// ── Plugin loader ──────────────────────────────────────────────────────────
export { loadConnectors } from './connectors/loader.js'
export type { LoadDeps, LoadReport, LoadResult, CapabilityImpls } from './connectors/loader.js'
export { TrustStore } from './connectors/trust-store.js'
export {
  makeFetchCapability,
  makeChromeCookiesCapability,
  makeLogCapabilityFor,
} from './connectors/capabilities/index.js'
