// ── Fetch ───────────────────────────────────────────────────────────────────

/**
 * Proxy-aware HTTP fetch. Shape-compatible with the standard `fetch` global.
 * Connector authors can use it exactly like `fetch(url, init)`.
 *
 * Convention (not type-enforced): use only `status`, `ok`, `headers`,
 * `text()`, `json()`, `arrayBuffer()` on the Response. Streaming APIs
 * (`body` as ReadableStream, FormData bodies) are not guaranteed to work
 * across all injected implementations.
 */
export type FetchCapability = typeof globalThis.fetch

// ── Cookies ─────────────────────────────────────────────────────────────────

export interface CookiesCapability {
  /** Returns decrypted cookies matching the query. */
  get(query: CookieQuery): Promise<Cookie[]>
}

export interface CookieQuery {
  /** v1 only supports 'chrome'. Future versions may add 'safari' | 'firefox'. */
  browser: 'chrome'
  /** Chrome profile directory name; defaults to 'Default'. */
  profile?: string
  /** Filter cookies by URL (host + path matching). */
  url: string
}

export interface Cookie {
  name: string
  /** Already-decrypted plaintext value. */
  value: string
  domain: string
  path: string
  /** Unix timestamp (seconds); null = session cookie. */
  expires: number | null
  secure: boolean
  httpOnly: boolean
}

// ── Log ─────────────────────────────────────────────────────────────────────

export interface LogCapability {
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void

  /**
   * Run an async block inside a tracing span. The span is automatically
   * closed when the promise settles (including on exception). Span duration
   * and attributes are forwarded to the framework's OpenTelemetry exporter
   * when one is configured.
   */
  span<T>(
    name: string,
    fn: () => Promise<T>,
    opts?: { attributes?: LogFields }
  ): Promise<T>
}

export type LogFields = Record<string, string | number | boolean | null>

// ── SQLite ──────────────────────────────────────────────────────────────────

/** Values accepted as bind parameters in SQLite queries. */
export type SqliteBindValue = string | number | bigint | Buffer | null

/**
 * A prepared statement bound to a specific SQL query.
 * Generic parameter `T` is the expected row shape — declared at the
 * `prepare<T>()` call site, same pattern as `better-sqlite3`.
 */
export interface SqliteStatement<T = unknown> {
  /** Execute the query and return all matching rows. */
  all(...params: SqliteBindValue[]): T[]
  /** Execute the query and return the first matching row, or undefined. */
  get(...params: SqliteBindValue[]): T | undefined
}

/**
 * A readonly handle to a SQLite database file.
 * Connectors receive this from `caps.sqlite.openReadonly()`.
 */
export interface SqliteDatabase {
  /** Prepare a SQL statement. `T` is the expected row type. */
  prepare<T = unknown>(sql: string): SqliteStatement<T>
  /** Close the database connection. Must be called when done. */
  close(): void
}

/**
 * Capability for reading local SQLite database files.
 * The app injects a `better-sqlite3`-backed implementation; connectors
 * see only these interfaces and carry no native dependency.
 */
export interface SqliteCapability {
  /**
   * Open a database file in readonly mode.
   * Throws if the file does not exist or is not a valid SQLite database.
   */
  openReadonly(path: string): SqliteDatabase
}

// ── Exec ───────────────────────────────────────────────────────────────────

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface ExecCapability {
  run(bin: string, args: string[], opts?: { timeout?: number }): Promise<ExecResult>
  // TODO: timeout contract is undefined — callers currently sniff the error
  // message string for "timeout". A future version should throw a recognizable
  // error: either an AbortError (err.name === 'AbortError') or attach a
  // structured flag ({ timedOut: true }) so callers can reliably distinguish
  // timeout from ENOENT/EACCES without message parsing.
}

// ── Prerequisites ─────────────────────────────────────────────────────────────

export interface PrerequisitesCapability {
  check(): Promise<import('./connector.js').SetupStep[]>
}

// ── Bundle ──────────────────────────────────────────────────────────────────

/**
 * The full set of capabilities passed to a connector's constructor.
 * v1.0: 4 capabilities. Future versions may add more via additive, non-breaking
 * extension — connectors only receive what they declared in spool.capabilities.
 */
export interface ConnectorCapabilities {
  fetch: FetchCapability
  cookies: CookiesCapability
  log: LogCapability
  sqlite: SqliteCapability
  exec: ExecCapability
  prerequisites?: PrerequisitesCapability
}

// ── Manifest allowed values ────────────────────────────────────────────────

/**
 * The complete set of capability strings allowed in a connector's
 * `spool.capabilities` manifest field as of SDK v1. Future versions add to
 * this set (additive, non-breaking).
 */
export const KNOWN_CAPABILITIES_V1 = [
  'fetch',
  'cookies:chrome',
  'log',
  'sqlite',
  'exec',
  'prerequisites',
] as const

export type KnownCapabilityV1 = typeof KNOWN_CAPABILITIES_V1[number]
