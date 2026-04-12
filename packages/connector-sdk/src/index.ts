// Public plugin contract types
export type { Connector, AuthStatus, PageResult, FetchContext } from './connector.js'
export type { CapturedItem } from './captured-item.js'
export type { SyncState } from './sync-state.js'

// Error types
export { SyncError, SyncErrorCode, SYNC_ERROR_HINTS } from './errors.js'

// Capabilities
export type {
  FetchCapability,
  CookiesCapability,
  Cookie,
  CookieQuery,
  LogCapability,
  LogFields,
  ConnectorCapabilities,
  KnownCapabilityV1,
} from './capabilities.js'
export { KNOWN_CAPABILITIES_V1 } from './capabilities.js'
