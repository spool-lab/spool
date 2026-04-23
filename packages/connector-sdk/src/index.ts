// Public plugin contract types
export type {
  Connector,
  AuthStatus,
  PageResult,
  FetchContext,
  Prerequisite,
  PrerequisiteKind,
  Detect,
  Install,
  ManualInstall,
  SetupStep,
  SetupStatus,
} from './connector.js'
export { checkAuthViaPrerequisites } from './connector.js'
export type { CapturedItem } from './captured-item.js'
export type { SyncState } from './sync-state.js'

// Error types
export { SyncError, SyncErrorCode, SYNC_ERROR_HINTS, isSyncError } from './errors.js'

// Capabilities
export type {
  FetchCapability,
  CookiesCapability,
  Cookie,
  CookieQuery,
  LogCapability,
  LogFields,
  SqliteCapability,
  SqliteDatabase,
  SqliteStatement,
  SqliteBindValue,
  ConnectorCapabilities,
  KnownCapabilityV1,
  ExecCapability,
  ExecResult,
  PrerequisitesCapability,
} from './capabilities.js'
export { KNOWN_CAPABILITIES_V1 } from './capabilities.js'

// Utilities
export { abortableSleep } from './utils.js'

// CLI parsing helper
export { parseCliJsonOutput } from './cli-parser.js'
