export * from './types.js'
export * from './db/db.js'
export * from './db/queries.js'
export * from './parsers/claude.js'
export * from './parsers/codex.js'
export * from './sync/syncer.js'
export * from './sync/watcher.js'
export { searchFragments, searchCaptures, searchAll } from './db/queries.js'
export { OpenCLIManager } from './opencli/manager.js'
export { detectPlatform, parseOpenCLIOutput, parseOpenCLIItem } from './opencli/parser.js'
export { SYNC_STRATEGIES, getStrategy, getStrategiesForPlatform, getStrategyPlatforms } from './opencli/strategies.js'
export type { SyncStrategy } from './opencli/strategies.js'
export { resolveSystemBinary, cachedResolve, clearResolveCache } from './util/resolve-bin.js'

// ── Connector framework ─────────────────────────────────────────────────────
export { ConnectorRegistry } from './connectors/registry.js'
export { SyncEngine, loadSyncState, saveSyncState } from './connectors/sync-engine.js'
export { SyncScheduler } from './connectors/sync-scheduler.js'
export type { SchedulerEvent, SchedulerEventHandler } from './connectors/sync-scheduler.js'
export { TwitterBookmarksConnector } from './connectors/twitter-bookmarks/index.js'
export {
  SyncError,
  SyncErrorCode,
  SYNC_ERROR_HINTS,
  DEFAULT_SCHEDULE,
} from './connectors/types.js'
export type {
  Connector,
  AuthStatus,
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
