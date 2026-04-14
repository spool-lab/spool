import type { SyncErrorCode } from './errors.js'
import type { CapturedItem } from './captured-item.js'

// ── Prerequisites ─────────────────────────────────────────────────────────────

export type PrerequisiteKind = 'cli' | 'browser-extension' | 'site-session'

export interface Prerequisite {
  id: string
  name: string
  kind: PrerequisiteKind
  requires?: string[]
  detect: Detect
  install: Install
  minVersion?: string
  docsUrl?: string
}

export interface Detect {
  type: 'exec'
  command: string
  args: string[]
  versionRegex?: string
  matchStdout?: string
  timeoutMs?: number
}

export type Install =
  | {
      kind: 'cli'
      command: Partial<Record<'darwin' | 'linux' | 'win32', string>>
      requiresManual?: boolean
    }
  | {
      kind: 'browser-extension'
      webstoreUrl?: string
      manual?: ManualInstall
    }
  | {
      kind: 'site-session'
      openUrl: string
    }

/**
 * Steps for manual extension install. By convention:
 * - steps[0]: download step (rendered with a "Download" button wired to downloadUrl)
 * - steps[1]: unzip step (user action, no button)
 * - steps[2]: open chrome://extensions step (rendered with an "Open" button)
 * - steps[3+]: any additional user actions
 */
export interface ManualInstall {
  downloadUrl: string
  steps: string[]
}

export type SetupStatus = 'ok' | 'missing' | 'outdated' | 'error' | 'pending'

export interface SetupStep {
  id: string
  label: string
  kind: PrerequisiteKind
  status: SetupStatus
  hint?: string
  detectedVersion?: string
  minVersion?: string
  install?: Install
  docsUrl?: string
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthStatus {
  ok: boolean
  error?: SyncErrorCode
  message?: string
  /** Actionable guidance for the user. */
  hint?: string
  setup?: SetupStep[]
}

// ── Page result ──────────────────────────────────────────────────────────────

export interface PageResult {
  items: CapturedItem[]
  /** Cursor for the next page. null = no more data. */
  nextCursor: string | null
}

// ── Fetch context ────────────────────────────────────────────────────────────

export interface FetchContext {
  /** Pagination cursor. null = start from the newest page. */
  cursor: string | null
  /** Platform ID of the newest known item (head anchor). null = no anchor. */
  sinceItemId: string | null
  /** Which sync phase is requesting this page. */
  phase: 'forward' | 'backfill'
  /**
   * AbortSignal that fires when the sync engine wants to stop this sync.
   * Connectors should pass it through to their fetch calls and respect it
   * in retry/backoff loops (use `abortableSleep(ms, signal)`).
   *
   * Ignoring this signal is valid — the engine still interrupts at its own
   * layer — but cancellation response time will be slower.
   *
   * Optional until Task 5 wires the engine to always provide it.
   */
  signal?: AbortSignal
}

// ── checkAuthViaPrerequisites helper ─────────────────────────────────────────

import type { ConnectorCapabilities } from './capabilities.js'

export async function checkAuthViaPrerequisites(caps: ConnectorCapabilities): Promise<AuthStatus> {
  if (!caps.prerequisites) {
    return {
      ok: false,
      message: 'Prerequisites capability not wired',
    }
  }
  const setup = await caps.prerequisites.check()
  return { ok: setup.every(s => s.status === 'ok'), setup }
}

// ── Connector interface ──────────────────────────────────────────────────────

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
