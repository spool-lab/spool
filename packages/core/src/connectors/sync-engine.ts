import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type {
  Connector,
  FetchContext,
  SyncState,
  SyncOptions,
  ConnectorSyncResult,
  SyncProgress,
  SyncErrorCode,
} from './types.js'
import { SyncError } from './types.js'
import type { CapturedItem } from '../types.js'

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
    lastErrorCode: row['last_error_code'] as SyncErrorCode | null,
    lastErrorMessage: row['last_error_message'] as string | null,
  }
}

export function saveSyncState(db: Database.Database, state: SyncState): void {
  db.prepare(`
    INSERT INTO connector_sync_state
      (connector_id, head_cursor, head_item_id, tail_cursor, tail_complete,
       last_forward_sync_at, last_backfill_sync_at, total_synced,
       consecutive_errors, enabled, config_json, last_error_code, last_error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    state.lastErrorCode, state.lastErrorMessage,
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

  async sync(connector: Connector, opts: SyncOptions = {}): Promise<ConnectorSyncResult> {
    const state = loadSyncState(this.db, connector.id)
    const startedAt = Date.now()

    try {
      const result = connector.ephemeral
        ? await this.syncEphemeral(connector, state, opts, startedAt)
        : await this.syncPersistent(connector, state, opts, startedAt)

      // Success: clear error state
      state.consecutiveErrors = 0
      state.lastErrorCode = null
      state.lastErrorMessage = null
      saveSyncState(this.db, state)

      return result
    } catch (err) {
      const syncErr = err instanceof SyncError
        ? err
        : new SyncError(
            'CONNECTOR_ERROR' as SyncErrorCode,
            err instanceof Error ? err.message : String(err),
            err,
          )

      state.consecutiveErrors += 1
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
   * Fetch pages in a loop until a stop condition is met.
   * Handles errors gracefully: saves progress and returns instead of throwing.
   */
  private async fetchLoop(
    connector: Connector,
    state: SyncState,
    opts: SyncOptions & { phase: 'forward' | 'backfill' },
    sourceId: number,
    startCursor: string | null,
    startedAt: number,
  ): Promise<{ added: number; pages: number; stopReason: string; error?: { code: string; message: string } }> {
    const delayMs = opts.delayMs ?? 1200
    const maxMinutes = opts.maxMinutes ?? 0
    const stalePageLimit = opts.stalePageLimit ?? 3
    const checkpointEvery = 25

    // Initial sync handoff: forward writes tailCursor ONLY on the very first sync
    // (tailCursor still null, no prior forward interrupted = headCursor null).
    // This lets backfill pick up where forward left off. On subsequent cycles,
    // forward must NOT touch tailCursor — otherwise it overwrites backfill's
    // deep progress with a shallow position near the newest end.
    const isInitialSync = opts.phase === 'forward'
      && state.tailCursor === null
      && state.headCursor === null

    // Capture the since-anchor at loop entry, before page-0 may update
    // headItemId (A.1.3). This is the stop signal for forward early-exit:
    // "stop when you reach this item — everything at or beyond it is already indexed."
    const sinceItemId = opts.phase === 'forward' ? state.headItemId : null

    let cursor = startCursor
    let added = 0
    let pages = 0
    let stalePages = 0

    for (let page = 0; ; page++) {
      if (maxMinutes > 0 && this.isTimedOut(startedAt, maxMinutes)) {
        return { added, pages, stopReason: 'timeout' }
      }
      if (opts.signal?.aborted) {
        return { added, pages, stopReason: 'cancelled' }
      }

      let result
      try {
        const fetchCtx: FetchContext = { cursor, sinceItemId, phase: opts.phase }
        result = await connector.fetchPage(fetchCtx)
      } catch (err) {
        // Save progress before returning — don't throw, don't lose work
        console.error(`[sync-engine] ${connector.id} ${opts.phase} page ${page + 1} error:`, err instanceof Error ? err.message : err)
        saveSyncState(this.db, state)
        return {
          added, pages,
          stopReason: `error: ${err instanceof SyncError ? err.code : 'CONNECTOR_ERROR'}`,
          error: {
            code: err instanceof SyncError ? err.code : 'CONNECTOR_ERROR',
            message: err instanceof Error ? err.message : String(err),
          },
        }
      }
      pages++

      if (result.items.length === 0 && !result.nextCursor) {
        if (opts.phase === 'forward') state.headCursor = null
        if (opts.phase === 'backfill') state.tailComplete = true
        return { added, pages, stopReason: opts.phase === 'backfill' ? 'backfill_complete' : 'end_of_data' }
      }

      // Tag items with connectorId
      for (const item of result.items) {
        (item.metadata as Record<string, unknown>)['connectorId'] = connector.id
      }

      const { newCount } = this.db.transaction(() =>
        upsertItems(this.db, sourceId, result.items),
      )()
      added += newCount

      // Update headItemId: the platform ID of the newest item we've ever seen.
      // Only on forward, only on the first page (page 0), and only when NOT
      // resuming from headCursor — a resumed forward is catching up to the
      // existing anchor, not establishing a new one.
      // Monotonic-forward check: only overwrite if we don't already have one,
      // or if the new value is genuinely newer (i.e. different from current).
      // On platforms with cursor-walking (no server-side since), the first page
      // of a fresh forward always starts at the newest end, so page-0's first
      // item is guaranteed to be >= the current headItemId.
      if (opts.phase === 'forward' && page === 0 && startCursor === null) {
        const firstItem = result.items[0]
        if (firstItem?.platformId && firstItem.platformId !== state.headItemId) {
          state.headItemId = firstItem.platformId
        }
      }

      opts.onProgress?.({
        connectorId: connector.id,
        phase: opts.phase,
        page: page + 1,
        fetched: result.items.length,
        added,
        running: true,
      })

      // Early-exit: forward stops when it reaches the since-anchor (headItemId).
      // This means we've caught up to the point where the last forward left off.
      // Much more efficient than stale-page detection for small incremental syncs
      // (e.g. 2 new bookmarks → 1 page instead of 3+ stale pages).
      // Note: sinceItemId was already captured into headItemId before page 0's
      // update (A.1.3 only updates headItemId on page 0 of a fresh forward),
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
        return { added, pages, stopReason: opts.phase === 'forward' ? 'caught_up' : 'backfill_complete' }
      }

      if (!result.nextCursor) {
        if (opts.phase === 'forward') state.headCursor = null
        if (opts.phase === 'backfill') state.tailComplete = true
        return { added, pages, stopReason: opts.phase === 'backfill' ? 'backfill_complete' : 'end_of_data' }
      }

      cursor = result.nextCursor

      // Update cursors in state for resume.
      if (opts.phase === 'forward') {
        // Save forward progress so an interrupted cycle can resume here
        // instead of re-fetching from the newest end.
        state.headCursor = cursor
        // Only write tailCursor during initial sync (handoff to backfill).
        if (isInitialSync) state.tailCursor = cursor
      } else {
        // Backfill always tracks its own progress.
        state.tailCursor = cursor
      }

      // Checkpoint periodically (crash safety)
      if (pages % checkpointEvery === 0) {
        saveSyncState(this.db, state)
      }

      await this.delay(delayMs)
    }
  }

  private async syncPersistent(
    connector: Connector,
    state: SyncState,
    opts: SyncOptions,
    startedAt: number,
  ): Promise<ConnectorSyncResult> {
    const direction = opts.direction ?? 'both'
    const sourceId = getSourceId(this.db)

    let totalAdded = 0
    let totalPages = 0
    let stopReason = 'complete'
    let lastError: { code: string; message: string } | undefined

    // ── Phase 1: Forward sync ───────────────────────────────────────
    // Resume from headCursor if a previous forward was interrupted (timeout,
    // cancel, error). Otherwise start from null (platform's newest end).
    if (direction === 'forward' || direction === 'both') {
      const hadAnchor = state.headItemId !== null
      const fwd = await this.fetchLoop(connector, state, { ...opts, phase: 'forward' }, sourceId, state.headCursor ?? null, startedAt)
      totalAdded += fwd.added
      totalPages += fwd.pages
      stopReason = fwd.stopReason
      if (fwd.error) lastError = fwd.error
      state.lastForwardSyncAt = new Date().toISOString()

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

    // ── Phase 2: Backfill — runs until complete ─────────────────────
    // Only run backfill if forward didn't error out
    if (!lastError && !state.tailComplete && (direction === 'backfill' || direction === 'both')) {
      const bf = await this.fetchLoop(connector, state, { ...opts, phase: 'backfill' }, sourceId, state.tailCursor, startedAt)
      totalAdded += bf.added
      totalPages += bf.pages
      stopReason = bf.stopReason
      if (bf.error) lastError = bf.error
      state.lastBackfillSyncAt = new Date().toISOString()
    }

    state.totalSynced += totalAdded
    saveSyncState(this.db, state)

    console.log(`[sync-engine] ${connector.id} done: added=${totalAdded} pages=${totalPages} reason=${stopReason}`)

    opts.onProgress?.({
      connectorId: connector.id,
      phase: 'forward',
      page: totalPages,
      fetched: 0,
      added: totalAdded,
      running: false,
    })

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
  }

  private async syncEphemeral(
    connector: Connector,
    state: SyncState,
    opts: SyncOptions,
    startedAt: number,
  ): Promise<ConnectorSyncResult> {
    const delayMs = opts.delayMs ?? 600
    const maxMinutes = opts.maxMinutes ?? 0
    const sourceId = getSourceId(this.db)

    // Ephemeral: delete old items and fetch fresh
    this.db.transaction(() => deleteConnectorItems(this.db, connector.id))()

    let cursor: string | null = null
    let totalAdded = 0
    let totalPages = 0
    let stopReason = 'complete'

    for (let page = 0; ; page++) {
      if (maxMinutes > 0 && this.isTimedOut(startedAt, maxMinutes)) {
        stopReason = 'timeout'
        break
      }
      if (opts.signal?.aborted) {
        stopReason = 'cancelled'
        break
      }

      const result = await connector.fetchPage({ cursor, sinceItemId: null, phase: 'forward' })
      totalPages++

      for (const item of result.items) {
        (item.metadata as Record<string, unknown>)['connectorId'] = connector.id
      }

      this.db.transaction(() => {
        const { newCount } = upsertItems(this.db, sourceId, result.items)
        totalAdded += newCount
      })()

      if (!result.nextCursor) break
      cursor = result.nextCursor
      await this.delay(delayMs)
    }

    state.totalSynced = totalAdded
    state.lastForwardSyncAt = new Date().toISOString()
    saveSyncState(this.db, state)

    return {
      connectorId: connector.id,
      added: totalAdded,
      total: totalAdded,
      pages: totalPages,
      direction: 'forward',
      stopReason,
    }
  }

  private isTimedOut(startedAt: number, maxMinutes: number): boolean {
    return Date.now() - startedAt > maxMinutes * 60_000
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
