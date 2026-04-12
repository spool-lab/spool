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

// ── Bundle ──────────────────────────────────────────────────────────────────

/**
 * The full set of capabilities passed to a connector's constructor.
 * v1.0: 3 capabilities. Future versions may add more via additive, non-breaking
 * extension — connectors only receive what they declared in spool.capabilities.
 */
export interface ConnectorCapabilities {
  fetch: FetchCapability
  cookies: CookiesCapability
  log: LogCapability
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
] as const

export type KnownCapabilityV1 = typeof KNOWN_CAPABILITIES_V1[number]
