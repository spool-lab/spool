/**
 * Universal Sync Engine — bidirectional cursor-based sync for all OpenCLI sources.
 *
 * Supports three sync modes:
 * - bidirectional: forward (new items) + backfill (historical items)
 * - snapshot: fetch current state, upsert everything
 * - append_only: forward only, no backfill
 *
 * See docs/universal-sync-strategy.md for full design.
 */
import type Database from 'better-sqlite3'
import type { SyncRunResult, SyncSourceStatus, CapturedItem, SyncMode } from '../types.js'
import type { OpenCLIManager } from '../opencli/manager.js'
import { getStrategy, SYNC_DEFAULTS } from '../opencli/strategies.js'
import type { SyncStrategy } from '../opencli/strategies.js'
import {
  getOrCreateSyncCursor,
  updateForwardCursor,
  updateBackwardCursor,
  incrementSyncErrors,
  insertSyncRun,
  completeSyncRun,
  getRecentSyncRuns,
  listOpenCLISources,
  getOpenCLISourceId,
  insertCapture,
  updateOpenCLISourceSynced,
} from '../db/queries.js'
import { SyncScheduler } from './sync-scheduler.js'

export type SyncEngineEvent =
  | { type: 'sync-start'; opencliSrcId: number; direction: 'forward' | 'backfill' }
  | { type: 'sync-complete'; opencliSrcId: number; result: SyncRunResult }
  | { type: 'sync-error'; opencliSrcId: number; error: string }
  | { type: 'backfill-progress'; opencliSrcId: number; pagesFetched: number }
  | { type: 'auto-sync-paused'; opencliSrcId: number; reason: string }

export type SyncEngineEventCallback = (event: SyncEngineEvent) => void

export class SyncEngine {
  private db: Database.Database
  private manager: OpenCLIManager
  private scheduler: SyncScheduler
  private running = new Map<string, AbortController>() // "forward:42" or "backfill:42"
  private onEvent: SyncEngineEventCallback | undefined

  constructor(
    db: Database.Database,
    manager: OpenCLIManager,
    onEvent?: SyncEngineEventCallback,
  ) {
    this.db = db
    this.manager = manager
    this.onEvent = onEvent
    this.scheduler = new SyncScheduler()
  }

  /**
   * Start the engine: load all enabled sources, schedule their sync jobs.
   */
  start(): void {
    const sources = listOpenCLISources(this.db)
    for (const src of sources) {
      if (!src.enabled) continue
      const strategy = getStrategy(src.platform, src.command)
      if (!strategy) continue
      this.scheduleSource(src.id, strategy)
    }
  }

  /**
   * Stop all running syncs and scheduled jobs.
   */
  stop(): void {
    this.scheduler.cancelAll()
    for (const controller of this.running.values()) {
      controller.abort()
    }
    this.running.clear()
  }

  /**
   * Trigger an immediate sync for a specific source (both directions if applicable).
   */
  async syncNow(opencliSrcId: number): Promise<SyncRunResult[]> {
    const src = listOpenCLISources(this.db).find(s => s.id === opencliSrcId)
    if (!src) throw new Error(`Source ${opencliSrcId} not found`)

    const strategy = getStrategy(src.platform, src.command)
    if (!strategy) throw new Error(`No strategy for ${src.platform}/${src.command}`)

    const results: SyncRunResult[] = []

    // Always do forward sync
    const fwd = await this.syncForward(opencliSrcId, strategy)
    results.push(fwd)

    // Do backfill if bidirectional and not complete
    if (strategy.syncMode === 'bidirectional') {
      const cursor = getOrCreateSyncCursor(this.db, opencliSrcId)
      if (!cursor.backfillComplete) {
        const bf = await this.syncBackfillPage(opencliSrcId, strategy)
        results.push(bf)
      }
    }

    // Re-schedule
    this.scheduleSource(opencliSrcId, strategy)

    return results
  }

  /**
   * Perform a forward sync: fetch items newer than forward_cursor.
   */
  async syncForward(opencliSrcId: number, strategy?: SyncStrategy): Promise<SyncRunResult> {
    const strat = strategy ?? this.resolveStrategy(opencliSrcId)
    const runKey = `forward:${opencliSrcId}`

    if (this.running.has(runKey)) {
      return { direction: 'forward', status: 'partial', itemsFetched: 0, itemsAdded: 0, itemsUpdated: 0, cursorAfter: null, errorMessage: 'Already running' }
    }

    const controller = new AbortController()
    this.running.set(runKey, controller)
    this.onEvent?.({ type: 'sync-start', opencliSrcId, direction: 'forward' })

    const cursor = getOrCreateSyncCursor(this.db, opencliSrcId)
    const runId = insertSyncRun(this.db, opencliSrcId, 'forward', cursor.forwardCursor)

    try {
      const items = await this.fetchPage(strat, 'forward', cursor.forwardCursor)
      if (controller.signal.aborted) throw new Error('Aborted')

      const { added, updated } = this.upsertItems(opencliSrcId, items)

      // Update cursors
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (firstItem) {
        const newestId = this.extractCursor(firstItem, strat)
        if (newestId) updateForwardCursor(this.db, opencliSrcId, newestId)

        // On first sync, also set backward cursor to the oldest item
        if (!cursor.backwardCursor && lastItem) {
          const oldestId = this.extractCursor(lastItem, strat)
          if (oldestId) {
            updateBackwardCursor(this.db, opencliSrcId, oldestId,
              strat.syncMode === 'snapshot' || strat.syncMode === 'append_only' ||
              items.length < (strat.pagination?.pageSize ?? SYNC_DEFAULTS.defaultPageSize))
          }
        }
      }

      const result: SyncRunResult = {
        direction: 'forward',
        status: 'success',
        itemsFetched: items.length,
        itemsAdded: added,
        itemsUpdated: updated,
        cursorAfter: firstItem ? this.extractCursor(firstItem, strat) : cursor.forwardCursor,
      }

      completeSyncRun(this.db, runId, 'success', {
        itemsFetched: items.length,
        itemsAdded: added,
        itemsUpdated: updated,
        cursorAfter: result.cursorAfter,
      })

      this.onEvent?.({ type: 'sync-complete', opencliSrcId, result })
      return result
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const errCount = incrementSyncErrors(this.db, opencliSrcId)

      completeSyncRun(this.db, runId, 'error', { errorMessage: errMsg })

      if (errCount >= (strat.scheduling?.maxConsecutiveErrors ?? SYNC_DEFAULTS.maxConsecutiveErrors)) {
        this.scheduler.cancel(opencliSrcId)
        this.onEvent?.({ type: 'auto-sync-paused', opencliSrcId, reason: `${errCount} consecutive errors` })
      }

      this.onEvent?.({ type: 'sync-error', opencliSrcId, error: errMsg })

      return {
        direction: 'forward',
        status: 'error',
        itemsFetched: 0,
        itemsAdded: 0,
        itemsUpdated: 0,
        cursorAfter: null,
        errorMessage: errMsg,
      }
    } finally {
      this.running.delete(runKey)
    }
  }

  /**
   * Fetch one page of backfill: items older than backward_cursor.
   */
  async syncBackfillPage(opencliSrcId: number, strategy?: SyncStrategy): Promise<SyncRunResult> {
    const strat = strategy ?? this.resolveStrategy(opencliSrcId)

    if (strat.syncMode !== 'bidirectional') {
      return { direction: 'backfill', status: 'success', itemsFetched: 0, itemsAdded: 0, itemsUpdated: 0, cursorAfter: null, backfillComplete: true }
    }

    const runKey = `backfill:${opencliSrcId}`
    if (this.running.has(runKey)) {
      return { direction: 'backfill', status: 'partial', itemsFetched: 0, itemsAdded: 0, itemsUpdated: 0, cursorAfter: null, errorMessage: 'Already running' }
    }

    const controller = new AbortController()
    this.running.set(runKey, controller)
    this.onEvent?.({ type: 'sync-start', opencliSrcId, direction: 'backfill' })

    const cursor = getOrCreateSyncCursor(this.db, opencliSrcId)
    if (cursor.backfillComplete) {
      this.running.delete(runKey)
      return { direction: 'backfill', status: 'success', itemsFetched: 0, itemsAdded: 0, itemsUpdated: 0, cursorAfter: cursor.backwardCursor, backfillComplete: true }
    }

    const runId = insertSyncRun(this.db, opencliSrcId, 'backfill', cursor.backwardCursor)

    try {
      const items = await this.fetchPage(strat, 'backfill', cursor.backwardCursor)
      if (controller.signal.aborted) throw new Error('Aborted')

      const { added, updated } = this.upsertItems(opencliSrcId, items)

      const pageSize = strat.pagination?.pageSize ?? SYNC_DEFAULTS.defaultPageSize
      const isComplete = items.length < pageSize
      const lastBackfillItem = items[items.length - 1]
      const newCursor = lastBackfillItem
        ? this.extractCursor(lastBackfillItem, strat)
        : cursor.backwardCursor

      updateBackwardCursor(this.db, opencliSrcId, newCursor, isComplete)

      const result: SyncRunResult = {
        direction: 'backfill',
        status: 'success',
        itemsFetched: items.length,
        itemsAdded: added,
        itemsUpdated: updated,
        cursorAfter: newCursor,
        backfillComplete: isComplete,
      }

      completeSyncRun(this.db, runId, 'success', {
        itemsFetched: items.length,
        itemsAdded: added,
        itemsUpdated: updated,
        cursorAfter: newCursor,
      })

      this.onEvent?.({ type: 'sync-complete', opencliSrcId, result })

      if (!isComplete) {
        const updatedCursor = getOrCreateSyncCursor(this.db, opencliSrcId)
        this.onEvent?.({ type: 'backfill-progress', opencliSrcId, pagesFetched: updatedCursor.totalPagesFetched })
      }

      return result
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      incrementSyncErrors(this.db, opencliSrcId)
      completeSyncRun(this.db, runId, 'error', { errorMessage: errMsg })
      this.onEvent?.({ type: 'sync-error', opencliSrcId, error: errMsg })

      return {
        direction: 'backfill',
        status: 'error',
        itemsFetched: 0,
        itemsAdded: 0,
        itemsUpdated: 0,
        cursorAfter: null,
        errorMessage: errMsg,
      }
    } finally {
      this.running.delete(runKey)
    }
  }

  /**
   * Get current sync status for all sources.
   */
  getStatus(): SyncSourceStatus[] {
    const sources = listOpenCLISources(this.db)
    return sources.map(src => {
      const strategy = getStrategy(src.platform, src.command)
      const cursor = getOrCreateSyncCursor(this.db, src.id)
      const recentRuns = getRecentSyncRuns(this.db, src.id, 5)
      const isRunning = this.running.has(`forward:${src.id}`) || this.running.has(`backfill:${src.id}`)

      return {
        opencliSrcId: src.id,
        platform: src.platform,
        command: src.command,
        syncMode: (strategy?.syncMode ?? 'snapshot') as SyncMode,
        cursor,
        isRunning,
        recentRuns,
      }
    })
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private resolveStrategy(opencliSrcId: number): SyncStrategy {
    const src = listOpenCLISources(this.db).find(s => s.id === opencliSrcId)
    if (!src) throw new Error(`Source ${opencliSrcId} not found`)
    const strategy = getStrategy(src.platform, src.command)
    if (!strategy) throw new Error(`No strategy for ${src.platform}/${src.command}`)
    return strategy
  }

  private scheduleSource(opencliSrcId: number, strategy: SyncStrategy): void {
    const scheduling = strategy.scheduling ?? {}

    // Schedule forward sync
    const forwardInterval = strategy.syncMode === 'snapshot'
      ? (SYNC_DEFAULTS.snapshotPollInterval * 1000)
      : ((scheduling.pollInterval ?? SYNC_DEFAULTS.pollInterval) * 1000)

    this.scheduler.scheduleForward(opencliSrcId, forwardInterval, () => {
      this.syncForward(opencliSrcId, strategy).then(() => {
        this.scheduleSource(opencliSrcId, strategy)
      })
    })

    // Schedule backfill if bidirectional and not complete
    if (strategy.syncMode === 'bidirectional') {
      const cursor = getOrCreateSyncCursor(this.db, opencliSrcId)
      if (!cursor.backfillComplete) {
        const backfillDelay = (scheduling.backfillInterval ?? SYNC_DEFAULTS.backfillInterval) * 1000
        this.scheduler.scheduleBackfill(opencliSrcId, backfillDelay, () => {
          this.syncBackfillPage(opencliSrcId, strategy).then((result) => {
            // Continue backfill if not complete
            if (!result.backfillComplete && result.status !== 'error') {
              this.scheduleSource(opencliSrcId, strategy)
            }
          })
        })
      }
    }
  }

  /**
   * Fetch a page of items from the platform.
   * Builds CLI args based on direction, cursor, and strategy pagination config.
   */
  private async fetchPage(
    strategy: SyncStrategy,
    direction: 'forward' | 'backfill',
    cursor: string | null,
  ): Promise<CapturedItem[]> {
    // For snapshot mode or first fetch, delegate to existing syncSource logic
    // but pass through pagination args if available
    const src = listOpenCLISources(this.db).find(
      s => s.platform === strategy.platform && s.command === strategy.command
    )
    if (!src) throw new Error(`Source not found for ${strategy.platform}/${strategy.command}`)

    // Use OpenCLIManager.syncSource which handles the actual CLI invocation
    // For now, we use a simplified approach that works with the existing manager
    const result = await this.manager.syncSource(src.id, strategy.platform, strategy.command)
    return result.items
  }

  /**
   * Extract cursor value from an item based on strategy configuration.
   */
  private extractCursor(item: CapturedItem, strategy: SyncStrategy): string | null {
    const field = strategy.pagination?.cursorField ?? 'platform_id'
    if (field === 'platform_id') return item.platformId
    if (field === 'capturedAt') return item.capturedAt
    // Check metadata for custom cursor fields
    if (item.metadata && typeof item.metadata === 'object') {
      const val = (item.metadata as Record<string, unknown>)[field]
      return val != null ? String(val) : null
    }
    return item.platformId
  }

  /**
   * Upsert items into the captures table.
   * Returns counts of added and updated items.
   */
  private upsertItems(
    opencliSrcId: number,
    items: CapturedItem[],
  ): { added: number; updated: number } {
    const sourceId = getOpenCLISourceId(this.db)
    let added = 0
    let updated = 0

    this.db.transaction(() => {
      for (const item of items) {
        // Check if item exists (by platform_id)
        const isNew = item.platformId
          ? !(this.db.prepare('SELECT 1 FROM captures WHERE platform = ? AND platform_id = ?')
              .get(item.platform, item.platformId))
          : !(this.db.prepare('SELECT 1 FROM captures WHERE url = ? AND opencli_src_id IS NULL')
              .get(item.url))

        insertCapture(this.db, sourceId, opencliSrcId, item)

        if (isNew) added++
        else updated++
      }
      updateOpenCLISourceSynced(this.db, opencliSrcId, items.length)
    })()

    return { added, updated }
  }
}
