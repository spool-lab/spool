import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { Clock, Deferred, Duration, Effect, Scope } from 'effect'
import type {
  Connector,
  FetchContext,
  SyncState,
  SyncOptions,
  ConnectorSyncResult,
  SyncProgress,
} from './types.js'
import { SyncError, SyncErrorCode, DEFAULT_SCHEDULE } from './types.js'
import type { CapturedItem } from './types.js'

/**
 * The internal "please stop" signal. Resolved once → the loop returns
 * gracefully with stopReason='cancelled' on its next iteration, and any
 * in-flight sleep is interrupted via Effect.race below. Driven by
 * `opts.signal` (via `bridgeAbortSignal` at the top of `syncEffect`) or
 * by direct resolution in tests.
 */
type CancelSignal = Deferred.Deferred<void>

/**
 * Bridge an optional AbortSignal into a CancelSignal registered in the
 * ambient Scope. The listener is cleaned up by the scope's finalizer.
 */
function bridgeAbortSignal(
  signal: AbortSignal | undefined,
  cancel: CancelSignal,
): Effect.Effect<void, never, Scope.Scope> {
  if (!signal) return Effect.void
  if (signal.aborted) return Deferred.succeed(cancel, undefined).pipe(Effect.asVoid)
  return Effect.acquireRelease(
    Effect.sync(() => {
      const handler = () => {
        Deferred.unsafeDone(cancel, Effect.void)
      }
      signal.addEventListener('abort', handler, { once: true })
      return handler
    }),
    (handler) => Effect.sync(() => signal.removeEventListener('abort', handler)),
  ).pipe(Effect.asVoid)
}

/**
 * Sleep `ms` milliseconds but wake immediately if the cancel signal fires.
 * The loop top still polls the cancel signal for a graceful
 * `stopReason='cancelled'` return; this racer just cuts the sleep short.
 */
function interruptibleSleep(ms: number, cancel: CancelSignal): Effect.Effect<void> {
  return Effect.race(
    Effect.sleep(Duration.millis(ms)),
    Deferred.await(cancel),
  ).pipe(Effect.asVoid)
}

function tagConnectorId(items: CapturedItem[], connectorId: string): void {
  for (const item of items) {
    (item.metadata as Record<string, unknown>)['connectorId'] = connectorId
  }
}

const nowIso: Effect.Effect<string> = Effect.map(
  Clock.currentTimeMillis,
  (ms) => new Date(ms).toISOString(),
)

// ── Sync State Persistence ──────────────────────────────────────────────────

export function loadSyncState(db: Database.Database, connectorId: string): SyncState {
  const row = db.prepare('SELECT * FROM connector_sync_state WHERE connector_id = ?')
    .get(connectorId) as Record<string, unknown> | undefined

  if (!row) {
    return {
      connectorId,
      headCursor: null,
      headItemId: null,
      tailCursor: null,
      tailComplete: false,
      lastForwardSyncAt: null,
      lastBackfillSyncAt: null,
      totalSynced: 0,
      consecutiveErrors: 0,
      enabled: false,
      configJson: {},
      lastErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    }
  }

  let configJson: Record<string, unknown> = {}
  try { configJson = JSON.parse(row['config_json'] as string) } catch {}

  return {
    connectorId,
    headCursor: row['head_cursor'] as string | null,
    headItemId: row['head_item_id'] as string | null,
    tailCursor: row['tail_cursor'] as string | null,
    tailComplete: Boolean(row['tail_complete']),
    lastForwardSyncAt: row['last_forward_sync_at'] as string | null,
    lastBackfillSyncAt: row['last_backfill_sync_at'] as string | null,
    totalSynced: row['total_synced'] as number,
    consecutiveErrors: row['consecutive_errors'] as number,
    enabled: Boolean(row['enabled']),
    configJson,
    lastErrorAt: row['last_error_at'] as string | null,
    lastErrorCode: row['last_error_code'] as SyncErrorCode | null,
    lastErrorMessage: row['last_error_message'] as string | null,
  }
}

export function saveSyncState(db: Database.Database, state: SyncState): void {
  db.prepare(`
    INSERT INTO connector_sync_state
      (connector_id, head_cursor, head_item_id, tail_cursor, tail_complete,
       last_forward_sync_at, last_backfill_sync_at, total_synced,
       consecutive_errors, enabled, config_json,
       last_error_at, last_error_code, last_error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(connector_id) DO UPDATE SET
      head_cursor = excluded.head_cursor,
      head_item_id = excluded.head_item_id,
      tail_cursor = excluded.tail_cursor,
      tail_complete = excluded.tail_complete,
      last_forward_sync_at = excluded.last_forward_sync_at,
      last_backfill_sync_at = excluded.last_backfill_sync_at,
      total_synced = excluded.total_synced,
      consecutive_errors = excluded.consecutive_errors,
      enabled = excluded.enabled,
      config_json = excluded.config_json,
      last_error_at = excluded.last_error_at,
      last_error_code = excluded.last_error_code,
      last_error_message = excluded.last_error_message
  `).run(
    state.connectorId,
    state.headCursor, state.headItemId,
    state.tailCursor, state.tailComplete ? 1 : 0,
    state.lastForwardSyncAt, state.lastBackfillSyncAt,
    state.totalSynced, state.consecutiveErrors,
    state.enabled ? 1 : 0,
    JSON.stringify(state.configJson),
    state.lastErrorAt, state.lastErrorCode, state.lastErrorMessage,
  )
}

// ── Item Upsert ─────────────────────────────────────────────────────────────

interface UpsertResult {
  newCount: number
  updatedCount: number
}

function upsertItems(
  db: Database.Database,
  sourceId: number,
  items: CapturedItem[],
): UpsertResult {
  let newCount = 0
  let updatedCount = 0

  const checkStmt = db.prepare(
    'SELECT id FROM captures WHERE platform = ? AND platform_id = ?',
  )
  const updateStmt = db.prepare(`
    UPDATE captures SET
      title = ?, content_text = ?, author = ?, metadata = ?,
      captured_at = ?, raw_json = ?, thumbnail_url = ?
    WHERE id = ?
  `)
  const insertStmt = db.prepare(`
    INSERT INTO captures
      (source_id, capture_uuid, url, title, content_text,
       author, platform, platform_id, content_type, thumbnail_url,
       metadata, captured_at, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const item of items) {
    if (item.platformId) {
      const existing = checkStmt.get(item.platform, item.platformId) as
        | { id: number }
        | undefined
      if (existing) {
        updateStmt.run(
          item.title, item.contentText, item.author,
          JSON.stringify(item.metadata), item.capturedAt, item.rawJson,
          item.thumbnailUrl, existing.id,
        )
        updatedCount++
        continue
      }
    }

    insertStmt.run(
      sourceId, randomUUID(), item.url, item.title, item.contentText,
      item.author, item.platform, item.platformId, item.contentType,
      item.thumbnailUrl, JSON.stringify(item.metadata), item.capturedAt,
      item.rawJson,
    )
    newCount++
  }

  return { newCount, updatedCount }
}

function deleteConnectorItems(db: Database.Database, connectorId: string): void {
  // connectorId format is e.g. 'twitter-bookmarks', platform is 'twitter'
  // We need the connector to know which platform+content_type to delete.
  // For now, delete by matching connector_id pattern in metadata or by platform.
  // Since we store connector_id in captures metadata, let's use a convention:
  // captures from connectors have metadata.connectorId set.
  db.prepare(
    `DELETE FROM captures WHERE json_extract(metadata, '$.connectorId') = ?`,
  ).run(connectorId)
}

// ── Sync Engine ─────────────────────────────────────────────────────────────

function getSourceId(db: Database.Database): number {
  // All connector items share the 'claude' source_id for the FK constraint.
  // The connector_id in metadata and connector_sync_state table distinguish them.
  const row = db.prepare("SELECT id FROM sources WHERE name = 'claude'").get() as
    | { id: number }
    | undefined
  if (!row) throw new Error("Source 'claude' not found in DB")
  return row.id
}

function hasKnownItem(
  db: Database.Database,
  platform: string,
  items: CapturedItem[],
): boolean {
  if (items.length === 0) return false
  const stmt = db.prepare(
    'SELECT 1 FROM captures WHERE platform = ? AND platform_id = ? LIMIT 1',
  )
  for (const item of items) {
    if (item.platformId && stmt.get(platform, item.platformId)) return true
  }
  return false
}

export class SyncEngine {
  constructor(private db: Database.Database) {}

  loadState(connectorId: string): SyncState {
    return loadSyncState(this.db, connectorId)
  }

  /**
   * Effect-native entry point. Returns an Effect that, when run, executes a
   * full sync cycle (ephemeral or dual-frontier persistent) and records the
   * outcome in connector_sync_state. The Effect is `Effect<ConnectorSyncResult, never>`
   * because all SyncErrors are caught internally and encoded in `result.error`.
   *
   * Preferred by callers that already live in the Effect world (the Scheduler
   * Effect migration, tests that want to inject Logger / Tracer layers via
   * `Effect.provide`). Promise-based callers should use `sync()` instead.
   */
  syncEffect(
    connector: Connector,
    opts: SyncOptions = {},
  ): Effect.Effect<ConnectorSyncResult> {
    const db = this.db
    const self = this

    return Effect.gen(function* () {
      const state = yield* Effect.sync(() => loadSyncState(db, connector.id))
      const startedAt = yield* Clock.currentTimeMillis
      const cancel = opts.cancel ?? (yield* Deferred.make<void>())
      yield* bridgeAbortSignal(opts.signal, cancel)

      const body = connector.ephemeral
        ? self.syncEphemeralEffect(connector, state, opts, startedAt, cancel)
        : self.syncPersistentEffect(connector, state, opts, startedAt, cancel)

      const result = yield* body.pipe(
        Effect.withSpan('sync.cycle', {
          attributes: {
            'connector.id': connector.id,
            'sync.direction': opts.direction ?? 'both',
          },
        }),
      )

      if (result.error) {
        state.consecutiveErrors += 1
        state.lastErrorAt = yield* nowIso
        state.lastErrorCode = result.error.code as SyncErrorCode
        state.lastErrorMessage = result.error.message
      } else {
        state.consecutiveErrors = 0
        state.lastErrorAt = null
        state.lastErrorCode = null
        state.lastErrorMessage = null
      }
      yield* Effect.sync(() => saveSyncState(db, state))
      return result
      // Effect.scoped discharges the Scope required by bridgeAbortSignal's
      // acquireRelease, guaranteeing removeEventListener runs on every exit
      // path (success, failure, interruption).
    }).pipe(Effect.scoped)
  }

  async sync(connector: Connector, opts: SyncOptions = {}): Promise<ConnectorSyncResult> {
    // opts.signal is bridged into an internal Deferred by syncEffect —
    // NOT passed to runPromise, because runtime interruption would
    // skip state persistence and surface as an error. Cancellation must
    // be observable inside the loop (via Deferred.isDone) so the loop
    // can return gracefully with stopReason='cancelled' + partial progress.
    try {
      return await Effect.runPromise(this.syncEffect(connector, opts))
    } catch (err) {
      // Defect surfaced past the typed error channel — defensive fallback.
      const state = loadSyncState(this.db, connector.id)
      const syncErr = SyncError.from(err)
      state.consecutiveErrors += 1
      state.lastErrorAt = new Date().toISOString()
      state.lastErrorCode = syncErr.code
      state.lastErrorMessage = syncErr.message
      saveSyncState(this.db, state)
      return {
        connectorId: connector.id,
        added: 0,
        total: state.totalSynced,
        pages: 0,
        direction: opts.direction ?? 'both',
        stopReason: `error: ${syncErr.code}`,
        error: { code: syncErr.code, message: syncErr.message },
      }
    }
  }

  /**
   * Fetch pages in an Effect-based loop until a stop condition is met.
   * Errors are caught internally and returned in the result (never fails).
   */
  private fetchLoopEffect(
    connector: Connector,
    state: SyncState,
    opts: SyncOptions & { phase: 'forward' | 'backfill' },
    sourceId: number,
    startCursor: string | null,
    startedAt: number,
    cancel: CancelSignal,
  ): Effect.Effect<FetchLoopResult> {
    const db = this.db
    const delayMs = opts.delayMs ?? DEFAULT_SCHEDULE.pageDelayMs
    const maxMinutes = opts.maxMinutes ?? 0
    const stalePageLimit = opts.stalePageLimit ?? 3
    const checkpointEvery = 25
    const deadline = maxMinutes > 0 ? startedAt + maxMinutes * 60_000 : Number.POSITIVE_INFINITY

    // Initial sync handoff: forward writes tailCursor ONLY on the very first sync
    // (tailCursor still null, no prior forward interrupted = headCursor null).
    // This lets backfill pick up where forward left off. On subsequent cycles,
    // forward must NOT touch tailCursor — otherwise it overwrites backfill's
    // deep progress with a shallow position near the newest end.
    const isInitialSync = opts.phase === 'forward'
      && state.tailCursor === null
      && state.headCursor === null

    // Capture the since-anchor at loop entry, before page-0 may update
    // headItemId. This is the stop signal for forward early-exit:
    // "stop when you reach this item — everything at or beyond it is already indexed."
    const sinceItemId = opts.phase === 'forward' ? state.headItemId : null

    return Effect.gen(function* () {
      let cursor = startCursor
      let added = 0
      let pages = 0
      let stalePages = 0

      while (true) {
        const now = yield* Clock.currentTimeMillis
        if (now >= deadline) {
          return { added, pages, stopReason: 'timeout' }
        }
        if (yield* Deferred.isDone(cancel)) {
          return { added, pages, stopReason: 'cancelled' }
        }

        const fetchCtx: FetchContext = { cursor, sinceItemId, phase: opts.phase }
        const outcome = yield* Effect.either(
          Effect.tryPromise({
            try: () => connector.fetchPage(fetchCtx),
            catch: SyncError.from,
          }).pipe(
            Effect.withSpan('sync.fetchPage', {
              attributes: {
                'connector.id': connector.id,
                'sync.phase': opts.phase,
                'sync.page': pages + 1,
              },
            }),
          ),
        )

        if (outcome._tag === 'Left') {
          const err = outcome.left
          yield* Effect.logError(
            `[sync-engine] ${connector.id} ${opts.phase} page ${pages + 1} error: ${err.message}`,
          )
          yield* Effect.sync(() => saveSyncState(db, state))
          return {
            added,
            pages,
            stopReason: `error: ${err.code}`,
            error: { code: err.code, message: err.message },
          }
        }

        const result = outcome.right
        pages++

        if (result.items.length === 0 && !result.nextCursor) {
          if (opts.phase === 'forward') state.headCursor = null
          if (opts.phase === 'backfill') state.tailComplete = true
          return {
            added,
            pages,
            stopReason: opts.phase === 'backfill' ? 'backfill_complete' : 'end_of_data',
          }
        }

        tagConnectorId(result.items, connector.id)

        const { newCount } = yield* Effect.sync(() =>
          db.transaction(() => upsertItems(db, sourceId, result.items))(),
        ).pipe(
          Effect.withSpan('sync.upsert', {
            attributes: { 'items.count': result.items.length },
          }),
        )
        added += newCount

        // Update headItemId: the platform ID of the newest item we've ever seen.
        // Only on forward, only on the first page (pages === 1 after increment),
        // and only when NOT resuming from headCursor — a resumed forward is
        // catching up to the existing anchor, not establishing a new one.
        // On platforms with cursor-walking (no server-side since), the first page
        // of a fresh forward always starts at the newest end, so page-0's first
        // item is guaranteed to be >= the current headItemId.
        if (opts.phase === 'forward' && pages === 1 && startCursor === null) {
          const firstItem = result.items[0]
          if (firstItem?.platformId && firstItem.platformId !== state.headItemId) {
            state.headItemId = firstItem.platformId
          }
        }

        if (opts.onProgress) {
          const progress: SyncProgress = {
            connectorId: connector.id,
            phase: opts.phase,
            page: pages,
            fetched: result.items.length,
            added,
            running: true,
          }
          yield* Effect.sync(() => opts.onProgress!(progress))
        }

        // Early-exit: forward stops when it reaches the since-anchor (headItemId).
        // This means we've caught up to the point where the last forward left off.
        // Much more efficient than stale-page detection for small incremental syncs
        // (e.g. 2 new bookmarks → 1 page instead of 3+ stale pages).
        // Note: sinceItemId was already captured into headItemId before page 0's
        // update (headItemId is only updated on page 0 of a fresh forward),
        // so we compare against the original anchor stored at fetchLoop entry.
        if (opts.phase === 'forward' && sinceItemId) {
          const hitAnchor = result.items.some(
            item => item.platformId === sinceItemId,
          )
          if (hitAnchor) {
            state.headCursor = null
            return { added, pages, stopReason: 'reached_since' }
          }
        }

        // Stale page detection: stop when we keep seeing only known data
        if (newCount === 0) stalePages++
        else stalePages = 0
        if (stalePages >= stalePageLimit) {
          if (opts.phase === 'forward') state.headCursor = null
          if (opts.phase === 'backfill') state.tailComplete = true
          return {
            added,
            pages,
            stopReason: opts.phase === 'forward' ? 'caught_up' : 'backfill_complete',
          }
        }

        if (!result.nextCursor) {
          if (opts.phase === 'forward') state.headCursor = null
          if (opts.phase === 'backfill') state.tailComplete = true
          return {
            added,
            pages,
            stopReason: opts.phase === 'backfill' ? 'backfill_complete' : 'end_of_data',
          }
        }

        cursor = result.nextCursor

        if (opts.phase === 'forward') {
          // Save forward progress so an interrupted cycle can resume here
          // instead of re-fetching from the newest end.
          state.headCursor = cursor
          // Only write tailCursor during initial sync (handoff to backfill).
          if (isInitialSync) state.tailCursor = cursor
        } else {
          state.tailCursor = cursor
        }

        if (pages % checkpointEvery === 0) {
          yield* Effect.sync(() => saveSyncState(db, state))
        }

        // Cap the inter-page delay at the remaining deadline so maxMinutes
        // has ms-level precision instead of being gated on polling frequency.
        const nowAfter = yield* Clock.currentTimeMillis
        const remaining = deadline - nowAfter
        const actualDelay = Math.max(0, Math.min(delayMs, remaining))
        if (actualDelay > 0) {
          yield* interruptibleSleep(actualDelay, cancel)
        }
      }
    })
  }

  private syncPersistentEffect(
    connector: Connector,
    state: SyncState,
    opts: SyncOptions,
    startedAt: number,
    cancel: CancelSignal,
  ): Effect.Effect<ConnectorSyncResult> {
    const db = this.db
    const direction = opts.direction ?? 'both'
    const sourceId = getSourceId(db)
    const self = this

    return Effect.gen(function* () {
      let totalAdded = 0
      let totalPages = 0
      let stopReason = 'complete'
      let lastError: { code: string; message: string } | undefined

      if (direction === 'forward' || direction === 'both') {
        const hadAnchor = state.headItemId !== null
        const fwd = yield* self
          .fetchLoopEffect(
            connector,
            state,
            { ...opts, phase: 'forward' },
            sourceId,
            state.headCursor ?? null,
            startedAt,
            cancel,
          )
          .pipe(Effect.withSpan('sync.forward'))

        totalAdded += fwd.added
        totalPages += fwd.pages
        stopReason = fwd.stopReason
        if (fwd.error) lastError = fwd.error
        state.lastForwardSyncAt = yield* nowIso

        // Anchor invalidation recovery (Q3): if forward ran to completion
        // (not interrupted) but never hit the since-anchor, the anchor is stale
        // (e.g. user un-bookmarked that item). Clear it so next forward starts
        // fresh and re-establishes the anchor from page 0.
        const completedWithoutHit = hadAnchor
          && fwd.stopReason !== 'reached_since'
          && fwd.stopReason !== 'timeout'
          && fwd.stopReason !== 'cancelled'
          && !fwd.stopReason.startsWith('error')
        if (completedWithoutHit) {
          state.headItemId = null
        }
      }

      if (!lastError && !state.tailComplete && (direction === 'backfill' || direction === 'both')) {
        const bf = yield* self
          .fetchLoopEffect(
            connector,
            state,
            { ...opts, phase: 'backfill' },
            sourceId,
            state.tailCursor,
            startedAt,
            cancel,
          )
          .pipe(Effect.withSpan('sync.backfill'))

        totalAdded += bf.added
        totalPages += bf.pages
        stopReason = bf.stopReason
        if (bf.error) lastError = bf.error
        state.lastBackfillSyncAt = yield* nowIso
      }

      state.totalSynced += totalAdded
      yield* Effect.sync(() => saveSyncState(db, state))

      yield* Effect.logInfo(
        `[sync-engine] ${connector.id} done: added=${totalAdded} pages=${totalPages} reason=${stopReason}`,
      )

      if (opts.onProgress) {
        const progress: SyncProgress = {
          connectorId: connector.id,
          phase: 'forward',
          page: totalPages,
          fetched: 0,
          added: totalAdded,
          running: false,
        }
        yield* Effect.sync(() => opts.onProgress!(progress))
      }

      const ret: ConnectorSyncResult = {
        connectorId: connector.id,
        added: totalAdded,
        total: state.totalSynced,
        pages: totalPages,
        direction,
        stopReason,
      }
      if (lastError) {
        ret.error = { code: lastError.code as SyncErrorCode, message: lastError.message }
      }
      return ret
    })
  }

  private syncEphemeralEffect(
    connector: Connector,
    state: SyncState,
    opts: SyncOptions,
    startedAt: number,
    cancel: CancelSignal,
  ): Effect.Effect<ConnectorSyncResult> {
    const db = this.db
    const delayMs = opts.delayMs ?? DEFAULT_SCHEDULE.pageDelayMs
    const maxMinutes = opts.maxMinutes ?? 0
    const sourceId = getSourceId(db)
    const deadline = maxMinutes > 0 ? startedAt + maxMinutes * 60_000 : Number.POSITIVE_INFINITY

    return Effect.gen(function* () {
      yield* Effect.sync(() =>
        db.transaction(() => deleteConnectorItems(db, connector.id))(),
      )

      let cursor: string | null = null
      let totalAdded = 0
      let totalPages = 0
      let stopReason = 'complete'

      while (true) {
        const now = yield* Clock.currentTimeMillis
        if (now >= deadline) {
          stopReason = 'timeout'
          break
        }
        if (yield* Deferred.isDone(cancel)) {
          stopReason = 'cancelled'
          break
        }

        const outcome = yield* Effect.either(
          Effect.tryPromise({
            try: () => connector.fetchPage({ cursor, sinceItemId: null, phase: 'forward' }),
            catch: SyncError.from,
          }).pipe(
            Effect.withSpan('sync.fetchPage', {
              attributes: {
                'connector.id': connector.id,
                'sync.phase': 'forward',
                'sync.page': totalPages + 1,
              },
            }),
          ),
        )

        if (outcome._tag === 'Left') {
          const err = outcome.left
          yield* Effect.logError(
            `[sync-engine] ${connector.id} forward page ${totalPages + 1} error: ${err.message}`,
          )
          state.totalSynced = totalAdded
          state.lastForwardSyncAt = yield* nowIso
          yield* Effect.sync(() => saveSyncState(db, state))
          return {
            connectorId: connector.id,
            added: totalAdded,
            total: totalAdded,
            pages: totalPages,
            direction: 'forward',
            stopReason: `error: ${err.code}`,
            error: { code: err.code, message: err.message },
          }
        }

        const result = outcome.right
        totalPages++

        tagConnectorId(result.items, connector.id)

        const { newCount } = yield* Effect.sync(() =>
          db.transaction(() => upsertItems(db, sourceId, result.items))(),
        ).pipe(
          Effect.withSpan('sync.upsert', {
            attributes: { 'items.count': result.items.length },
          }),
        )
        totalAdded += newCount

        if (!result.nextCursor) break
        cursor = result.nextCursor

        const nowAfter = yield* Clock.currentTimeMillis
        const remaining = deadline - nowAfter
        const actualDelay = Math.max(0, Math.min(delayMs, remaining))
        if (actualDelay > 0) {
          yield* interruptibleSleep(actualDelay, cancel)
        }
      }

      state.totalSynced = totalAdded
      state.lastForwardSyncAt = yield* nowIso
      yield* Effect.sync(() => saveSyncState(db, state))

      return {
        connectorId: connector.id,
        added: totalAdded,
        total: totalAdded,
        pages: totalPages,
        direction: 'forward',
        stopReason,
      }
    })
  }
}

interface FetchLoopResult {
  added: number
  pages: number
  stopReason: string
  error?: { code: string; message: string }
}
