import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type {
  Connector,
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
      enabled: true,
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
      (source_id, opencli_src_id, capture_uuid, url, title, content_text,
       author, platform, platform_id, content_type, thumbnail_url,
       metadata, captured_at, raw_json)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  // Reuse the 'opencli' source for now — captures table needs a source_id FK.
  // All connector items share this source_id; the connector_id in metadata
  // and connector_sync_state table distinguish them.
  const row = db.prepare("SELECT id FROM sources WHERE name = 'opencli'").get() as
    | { id: number }
    | undefined
  if (!row) throw new Error("Source 'opencli' not found in DB")
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

  private async syncPersistent(
    connector: Connector,
    state: SyncState,
    opts: SyncOptions,
    startedAt: number,
  ): Promise<ConnectorSyncResult> {
    const direction = opts.direction ?? 'both'
    const delayMs = opts.delayMs ?? 600
    const maxMinutes = opts.maxMinutes ?? 5
    const stalePageLimit = opts.stalePageLimit ?? 3
    const sourceId = getSourceId(this.db)

    let totalAdded = 0
    let totalPages = 0
    let stopReason = 'complete'

    // ── Phase 1: Forward sync ───────────────────────────────────────
    if (direction === 'forward' || direction === 'both') {
      const forwardMax = opts.forwardMaxPages ?? 50
      let cursor: string | null = null // start from newest
      let stalePages = 0

      for (let page = 0; page < forwardMax; page++) {
        if (this.isTimedOut(startedAt, maxMinutes)) {
          stopReason = 'timeout'
          break
        }
        if (opts.signal?.aborted) {
          stopReason = 'cancelled'
          break
        }

        let result
        try {
          result = await connector.fetchPage(cursor)
        } catch (err) {
          console.error(`[sync-engine] ${connector.id} forward page ${page + 1} fetch error:`, err)
          throw err
        }
        totalPages++
        console.log(`[sync-engine] ${connector.id} forward page ${page + 1}: ${result.items.length} items, cursor=${result.nextCursor ? 'yes' : 'no'}`)

        if (result.items.length === 0 && !result.nextCursor) {
          stopReason = 'end_of_data'
          break
        }

        // Tag items with connectorId in metadata
        for (const item of result.items) {
          (item.metadata as Record<string, unknown>)['connectorId'] = connector.id
        }

        const { newCount } = this.db.transaction(() =>
          upsertItems(this.db, sourceId, result.items),
        )()
        totalAdded += newCount

        // Update head to track the newest item we've seen
        const firstItem = result.items[0]
        if (firstItem && firstItem.platformId) {
          state.headItemId = firstItem.platformId
        }

        opts.onProgress?.({
          connectorId: connector.id,
          phase: 'forward',
          page: page + 1,
          fetched: result.items.length,
          added: totalAdded,
          running: true,
        })

        // Stop conditions
        if (newCount === 0) stalePages++
        else stalePages = 0

        if (stalePages >= stalePageLimit) {
          stopReason = 'caught_up'
          break
        }
        if (!result.nextCursor) {
          stopReason = 'end_of_data'
          break
        }

        cursor = result.nextCursor

        // After forward phase, record tail cursor so backfill continues from here
        state.tailCursor = cursor

        if (page < forwardMax - 1) await this.delay(delayMs)
      }

      state.lastForwardSyncAt = new Date().toISOString()
    }

    // ── Phase 2: Backfill ───────────────────────────────────────────
    if (!state.tailComplete && (direction === 'backfill' || direction === 'both')) {
      const backfillMax = opts.backfillMaxPages ?? 10
      let cursor = state.tailCursor

      for (let page = 0; page < backfillMax; page++) {
        if (this.isTimedOut(startedAt, maxMinutes)) {
          stopReason = 'timeout'
          break
        }
        if (opts.signal?.aborted) {
          stopReason = 'cancelled'
          break
        }

        const result = await connector.fetchPage(cursor)
        totalPages++

        if (result.items.length === 0 && !result.nextCursor) {
          state.tailComplete = true
          stopReason = 'backfill_complete'
          break
        }

        for (const item of result.items) {
          (item.metadata as Record<string, unknown>)['connectorId'] = connector.id
        }

        const { newCount } = this.db.transaction(() =>
          upsertItems(this.db, sourceId, result.items),
        )()
        totalAdded += newCount

        opts.onProgress?.({
          connectorId: connector.id,
          phase: 'backfill',
          page: page + 1,
          fetched: result.items.length,
          added: totalAdded,
          running: true,
        })

        if (!result.nextCursor) {
          state.tailComplete = true
          stopReason = 'backfill_complete'
          break
        }

        state.tailCursor = result.nextCursor
        cursor = result.nextCursor

        // Checkpoint state every page during backfill (crash safety)
        saveSyncState(this.db, state)

        if (page < backfillMax - 1) await this.delay(delayMs)
      }

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

    return {
      connectorId: connector.id,
      added: totalAdded,
      total: state.totalSynced,
      pages: totalPages,
      direction,
      stopReason,
    }
  }

  private async syncEphemeral(
    connector: Connector,
    state: SyncState,
    opts: SyncOptions,
    startedAt: number,
  ): Promise<ConnectorSyncResult> {
    const maxPages = opts.forwardMaxPages ?? 5
    const delayMs = opts.delayMs ?? 600
    const maxMinutes = opts.maxMinutes ?? 5
    const sourceId = getSourceId(this.db)

    // Ephemeral: delete old items and fetch fresh
    this.db.transaction(() => deleteConnectorItems(this.db, connector.id))()

    let cursor: string | null = null
    let totalAdded = 0
    let totalPages = 0
    let stopReason = 'complete'

    for (let page = 0; page < maxPages; page++) {
      if (this.isTimedOut(startedAt, maxMinutes)) {
        stopReason = 'timeout'
        break
      }
      if (opts.signal?.aborted) {
        stopReason = 'cancelled'
        break
      }

      const result = await connector.fetchPage(cursor)
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
      if (page < maxPages - 1) await this.delay(delayMs)
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
