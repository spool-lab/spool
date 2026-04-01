import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Session, Message, FragmentResult, StatusInfo, CaptureResult, CapturedItem, OpenCLISource, SearchResult, Source, SyncCursor, SyncRun } from '../types.js'
import { DB_PATH, getDBSize } from './db.js'

export function getOrCreateProject(
  db: Database.Database,
  sourceId: number,
  slug: string,
  displayPath: string,
  displayName: string,
): number {
  const existing = db
    .prepare('SELECT id FROM projects WHERE source_id = ? AND slug = ?')
    .get(sourceId, slug) as { id: number } | undefined

  if (existing) return existing.id

  const result = db
    .prepare(
      'INSERT INTO projects (source_id, slug, display_path, display_name) VALUES (?, ?, ?, ?)',
    )
    .run(sourceId, slug, displayPath, displayName)

  return Number(result.lastInsertRowid)
}

export function getSourceId(db: Database.Database, name: 'claude' | 'codex'): number {
  const row = db.prepare('SELECT id FROM sources WHERE name = ?').get(name) as
    | { id: number }
    | undefined
  if (!row) throw new Error(`Source '${name}' not found in DB`)
  return row.id
}

export function getSessionMtime(db: Database.Database, filePath: string): string | null {
  const row = db
    .prepare('SELECT raw_file_mtime FROM sessions WHERE file_path = ?')
    .get(filePath) as { raw_file_mtime: string | null } | undefined
  return row?.raw_file_mtime ?? null
}

export function getAllSessionMtimes(db: Database.Database): Map<string, string> {
  const rows = db
    .prepare('SELECT file_path, raw_file_mtime FROM sessions')
    .all() as Array<{ file_path: string; raw_file_mtime: string }>
  return new Map(rows.map(r => [r.file_path, r.raw_file_mtime]))
}

export function upsertSession(
  db: Database.Database,
  opts: {
    projectId: number
    sourceId: number
    sessionUuid: string
    filePath: string
    title: string
    startedAt: string
    endedAt: string
    messageCount: number
    hasToolUse: boolean
    cwd: string
    model: string
    rawFileMtime: string
  },
): number {
  const existing = db
    .prepare('SELECT id FROM sessions WHERE session_uuid = ?')
    .get(opts.sessionUuid) as { id: number } | undefined

  if (existing) {
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(existing.id)
    db.prepare(`
      UPDATE sessions SET
        title = ?, started_at = ?, ended_at = ?, message_count = ?,
        has_tool_use = ?, cwd = ?, model = ?, raw_file_mtime = ?
      WHERE id = ?
    `).run(
      opts.title, opts.startedAt, opts.endedAt, opts.messageCount,
      opts.hasToolUse ? 1 : 0, opts.cwd, opts.model, opts.rawFileMtime,
      existing.id,
    )
    return existing.id
  }

  const result = db.prepare(`
    INSERT INTO sessions
      (project_id, source_id, session_uuid, file_path, title,
       started_at, ended_at, message_count, has_tool_use, cwd, model, raw_file_mtime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.projectId, opts.sourceId, opts.sessionUuid, opts.filePath, opts.title,
    opts.startedAt, opts.endedAt, opts.messageCount, opts.hasToolUse ? 1 : 0,
    opts.cwd, opts.model, opts.rawFileMtime,
  )

  return Number(result.lastInsertRowid)
}

export function insertMessages(
  db: Database.Database,
  sessionId: number,
  sourceId: number,
  messages: Array<{
    uuid: string
    parentUuid: string | null
    role: string
    contentText: string
    timestamp: string
    isSidechain: boolean
    toolNames: string[]
    seq: number
  }>,
): void {
  const stmt = db.prepare(`
    INSERT INTO messages
      (session_id, source_id, msg_uuid, parent_uuid, role,
       content_text, timestamp, is_sidechain, tool_names, seq)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const m of messages) {
    stmt.run(
      sessionId, sourceId, m.uuid, m.parentUuid, m.role,
      m.contentText, m.timestamp, m.isSidechain ? 1 : 0,
      JSON.stringify(m.toolNames), m.seq,
    )
  }
}

export function listRecentSessions(
  db: Database.Database,
  limit = 50,
): Session[] {
  return (db.prepare(`
    SELECT
      s.id, s.project_id AS projectId, s.source_id AS sourceId,
      s.session_uuid AS sessionUuid, s.file_path AS filePath,
      s.title, s.started_at AS startedAt, s.ended_at AS endedAt,
      s.message_count AS messageCount, s.has_tool_use AS hasToolUse,
      s.cwd, s.model,
      src.name AS source,
      p.display_path AS projectDisplayPath,
      p.display_name AS projectDisplayName
    FROM sessions s
    JOIN sources src ON src.id = s.source_id
    JOIN projects p ON p.id = s.project_id
    ORDER BY s.started_at DESC
    LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>).map(rowToSession)
}

export function getSessionWithMessages(
  db: Database.Database,
  sessionUuid: string,
): { session: Session; messages: Message[] } | null {
  const sessionRow = db.prepare(`
    SELECT
      s.id, s.project_id AS projectId, s.source_id AS sourceId,
      s.session_uuid AS sessionUuid, s.file_path AS filePath,
      s.title, s.started_at AS startedAt, s.ended_at AS endedAt,
      s.message_count AS messageCount, s.has_tool_use AS hasToolUse,
      s.cwd, s.model,
      src.name AS source,
      p.display_path AS projectDisplayPath,
      p.display_name AS projectDisplayName
    FROM sessions s
    JOIN sources src ON src.id = s.source_id
    JOIN projects p ON p.id = s.project_id
    WHERE s.session_uuid = ?
  `).get(sessionUuid) as Record<string, unknown> | undefined

  if (!sessionRow) return null

  const session = rowToSession(sessionRow)
  const msgRows = db.prepare(`
    SELECT id, session_id AS sessionId, msg_uuid AS msgUuid,
           parent_uuid AS parentUuid, role, content_text AS contentText,
           timestamp, is_sidechain AS isSidechain, tool_names AS toolNames, seq
    FROM messages
    WHERE session_id = ? AND is_sidechain = 0
    ORDER BY seq
  `).all(session.id) as Array<Record<string, unknown>>

  const messages: Message[] = msgRows.map(r => ({
    id: r['id'] as number,
    sessionId: r['sessionId'] as number,
    msgUuid: r['msgUuid'] as string | null,
    parentUuid: r['parentUuid'] as string | null,
    role: r['role'] as 'user' | 'assistant' | 'system',
    contentText: r['contentText'] as string,
    timestamp: r['timestamp'] as string,
    isSidechain: Boolean(r['isSidechain']),
    toolNames: JSON.parse(r['toolNames'] as string) as string[],
    seq: r['seq'] as number,
  }))

  return { session, messages }
}

export function searchFragments(
  db: Database.Database,
  query: string,
  opts: { limit?: number; source?: 'claude' | 'codex'; since?: string } = {},
): FragmentResult[] {
  const { limit = 10, source, since } = opts

  const ftsQuery = query.includes('"') || query.includes('*') || query.includes(' OR ')
    ? query
    : `"${query.replace(/"/g, '""')}"`

  const conditions: string[] = ['messages_fts MATCH ?', 'm.is_sidechain = 0']
  const params: (string | number)[] = [ftsQuery]

  if (source) {
    conditions.push('src2.name = ?')
    params.push(source)
  }
  if (since) {
    conditions.push('m.timestamp >= ?')
    params.push(since)
  }
  params.push(limit)

  const sql = `
    SELECT
      rank,
      m.role        AS messageRole,
      m.timestamp   AS messageTimestamp,
      sess.id       AS sessionId,
      sess.session_uuid AS sessionUuid,
      sess.file_path AS filePath,
      sess.title    AS sessionTitle,
      sess.started_at AS startedAt,
      sess.cwd      AS cwd,
      p.display_path AS project,
      src2.name     AS source,
      snippet(messages_fts, -1, '<mark>', '</mark>', '…', 20) AS snippet
    FROM messages_fts
    JOIN messages m ON m.id = messages_fts.rowid
    JOIN sessions sess ON sess.id = m.session_id
    JOIN projects p ON p.id = sess.project_id
    JOIN sources src2 ON src2.id = sess.source_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY rank
    LIMIT ?
  `

  return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map(
    (row, i) => {
      const profileLabel = getProfileLabelFromFilePath(row['filePath'] as string)

      return {
        rank: i + 1,
        sessionId: row['sessionId'] as number,
        sessionUuid: row['sessionUuid'] as string,
        sessionTitle: (row['sessionTitle'] as string | null) ?? '(no title)',
        source: row['source'] as 'claude' | 'codex',
        ...(profileLabel ? { profileLabel } : {}),
        ...(row['cwd'] ? { cwd: row['cwd'] as string } : {}),
        project: row['project'] as string,
        startedAt: row['startedAt'] as string,
        snippet: row['snippet'] as string,
        messageRole: row['messageRole'] as string,
        messageTimestamp: row['messageTimestamp'] as string,
      }
    },
  )
}

export function getStatus(db: Database.Database): StatusInfo {
  const counts = db.prepare(`
    SELECT src.name, COUNT(*) AS cnt
    FROM sessions s JOIN sources src ON src.id = s.source_id
    GROUP BY src.name
  `).all() as Array<{ name: string; cnt: number }>

  const lastSync = db.prepare(`
    SELECT MAX(synced_at) AS last FROM sync_log WHERE status = 'ok'
  `).get() as { last: string | null }

  const totalSessions = counts.reduce((sum, r) => sum + r.cnt, 0)
  const claudeRow = counts.find(r => r.name === 'claude')
  const codexRow = counts.find(r => r.name === 'codex')

  return {
    dbPath: DB_PATH,
    totalSessions,
    claudeSessions: claudeRow?.cnt ?? 0,
    codexSessions: codexRow?.cnt ?? 0,
    lastSyncedAt: lastSync?.last ?? null,
    dbSizeBytes: getDBSize(),
  }
}

function rowToSession(r: Record<string, unknown>): Session {
  return {
    id: r['id'] as number,
    projectId: r['projectId'] as number,
    sourceId: r['sourceId'] as number,
    sessionUuid: r['sessionUuid'] as string,
    filePath: r['filePath'] as string,
    title: r['title'] as string | null,
    startedAt: r['startedAt'] as string,
    endedAt: r['endedAt'] as string,
    messageCount: r['messageCount'] as number,
    hasToolUse: Boolean(r['hasToolUse']),
    cwd: r['cwd'] as string | null,
    model: r['model'] as string | null,
    source: r['source'] as 'claude' | 'codex',
    projectDisplayPath: r['projectDisplayPath'] as string,
    projectDisplayName: r['projectDisplayName'] as string,
  }
}

function getProfileLabelFromFilePath(filePath: string): string | undefined {
  const match = filePath.match(/\/\.(?:claude|codex)-profiles\/([^/]+)\//)
  return match?.[1]
}

// ── OpenCLI / Captures ──────────────────────────────────────────────────────

export function getOpenCLISourceId(db: Database.Database): number {
  const row = db.prepare('SELECT id FROM sources WHERE name = ?').get('opencli') as
    | { id: number }
    | undefined
  if (!row) throw new Error("Source 'opencli' not found in DB")
  return row.id
}

export function insertCapture(
  db: Database.Database,
  sourceId: number,
  opencliSrcId: number | null,
  item: CapturedItem,
): number {
  const captureUuid = randomUUID()

  // Dedup by platform_id if provided
  if (item.platformId) {
    const existing = db
      .prepare('SELECT id FROM captures WHERE platform = ? AND platform_id = ?')
      .get(item.platform, item.platformId) as { id: number } | undefined
    if (existing) {
      db.prepare(`
        UPDATE captures SET
          title = ?, content_text = ?, author = ?, metadata = ?,
          captured_at = ?, raw_json = ?
        WHERE id = ?
      `).run(
        item.title, item.contentText, item.author,
        JSON.stringify(item.metadata), item.capturedAt, item.rawJson,
        existing.id,
      )
      return existing.id
    }
  }

  // Dedup by URL for one-off captures
  if (!item.platformId) {
    const existing = db
      .prepare('SELECT id FROM captures WHERE url = ? AND opencli_src_id IS NULL')
      .get(item.url) as { id: number } | undefined
    if (existing) {
      db.prepare(`
        UPDATE captures SET
          title = ?, content_text = ?, author = ?, metadata = ?,
          captured_at = ?, raw_json = ?
        WHERE id = ?
      `).run(
        item.title, item.contentText, item.author,
        JSON.stringify(item.metadata), item.capturedAt, item.rawJson,
        existing.id,
      )
      return existing.id
    }
  }

  const result = db.prepare(`
    INSERT INTO captures
      (source_id, opencli_src_id, capture_uuid, url, title, content_text,
       author, platform, platform_id, content_type, thumbnail_url,
       metadata, captured_at, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sourceId, opencliSrcId, captureUuid, item.url, item.title, item.contentText,
    item.author, item.platform, item.platformId, item.contentType, item.thumbnailUrl,
    JSON.stringify(item.metadata), item.capturedAt, item.rawJson,
  )

  return Number(result.lastInsertRowid)
}

export function searchCaptures(
  db: Database.Database,
  query: string,
  opts: { limit?: number; platform?: string; since?: string } = {},
): CaptureResult[] {
  const { limit = 10, platform, since } = opts

  const ftsQuery = query.includes('"') || query.includes('*') || query.includes(' OR ')
    ? query
    : `"${query.replace(/"/g, '""')}"`

  const conditions: string[] = ['captures_fts MATCH ?']
  const params: (string | number)[] = [ftsQuery]

  if (platform) {
    conditions.push('c.platform = ?')
    params.push(platform)
  }
  if (since) {
    conditions.push('c.captured_at >= ?')
    params.push(since)
  }
  params.push(limit)

  const sql = `
    SELECT
      rank,
      c.id            AS captureId,
      c.capture_uuid  AS captureUuid,
      c.url,
      c.title,
      c.author,
      c.platform,
      c.content_type  AS contentType,
      c.captured_at   AS capturedAt,
      snippet(captures_fts, -1, '<mark>', '</mark>', '…', 20) AS snippet
    FROM captures_fts
    JOIN captures c ON c.id = captures_fts.rowid
    WHERE ${conditions.join(' AND ')}
    ORDER BY rank
    LIMIT ?
  `

  return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map(
    (row, i) => ({
      rank: i + 1,
      captureId: row['captureId'] as number,
      captureUuid: row['captureUuid'] as string,
      url: row['url'] as string,
      title: (row['title'] as string) || '(no title)',
      snippet: row['snippet'] as string,
      platform: row['platform'] as string,
      contentType: row['contentType'] as string,
      author: (row['author'] as string | null) ?? null,
      capturedAt: row['capturedAt'] as string,
    }),
  )
}

export function searchAll(
  db: Database.Database,
  query: string,
  opts: { limit?: number; source?: Source; since?: string } = {},
): SearchResult[] {
  const { limit = 20, source, since } = opts

  const fragOpts: { limit: number; source?: 'claude' | 'codex'; since?: string } = { limit }
  if (source === 'claude' || source === 'codex') fragOpts.source = source
  if (since) fragOpts.since = since

  const fragments = searchFragments(db, query, fragOpts)
    .map(f => ({ ...f, kind: 'fragment' as const }))

  const capOpts: { limit: number; since?: string } = { limit }
  if (since) capOpts.since = since

  const captures = (source && source !== 'opencli' ? [] : searchCaptures(db, query, capOpts))
    .map(c => ({ ...c, kind: 'capture' as const }))

  return [...fragments, ...captures]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
}

export function listOpenCLISources(db: Database.Database): OpenCLISource[] {
  const rows = db.prepare(`
    SELECT
      os.id, os.source_id AS sourceId, os.platform, os.command,
      os.enabled, os.last_synced AS lastSynced, os.sync_count AS syncCount
    FROM opencli_sources os
    ORDER BY os.created_at
  `).all() as Array<Record<string, unknown>>

  return rows.map(r => ({
    id: r['id'] as number,
    sourceId: r['sourceId'] as number,
    platform: r['platform'] as string,
    command: r['command'] as string,
    enabled: Boolean(r['enabled']),
    lastSynced: (r['lastSynced'] as string | null) ?? null,
    syncCount: r['syncCount'] as number,
  }))
}

export function addOpenCLISource(
  db: Database.Database,
  sourceId: number,
  platform: string,
  command: string,
): number {
  const result = db.prepare(`
    INSERT OR IGNORE INTO opencli_sources (source_id, platform, command)
    VALUES (?, ?, ?)
  `).run(sourceId, platform, command)

  if (result.changes === 0) {
    const existing = db
      .prepare('SELECT id FROM opencli_sources WHERE platform = ? AND command = ?')
      .get(platform, command) as { id: number }
    return existing.id
  }

  return Number(result.lastInsertRowid)
}

export function removeOpenCLISource(db: Database.Database, id: number): void {
  db.transaction(() => {
    db.prepare('DELETE FROM captures WHERE opencli_src_id = ?').run(id)
    db.prepare('DELETE FROM opencli_sources WHERE id = ?').run(id)
  })()
}

export function updateOpenCLISourceSynced(
  db: Database.Database,
  id: number,
  count: number,
): void {
  db.prepare(`
    UPDATE opencli_sources
    SET last_synced = datetime('now'), sync_count = sync_count + ?
    WHERE id = ?
  `).run(count, id)
}

export function getCaptureCount(db: Database.Database, platform?: string): number {
  if (platform) {
    const row = db.prepare('SELECT COUNT(*) AS cnt FROM captures WHERE platform = ?').get(platform) as { cnt: number }
    return row.cnt
  }
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM captures').get() as { cnt: number }
  return row.cnt
}

export function getSetupValue(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM opencli_setup WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetupValue(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO opencli_setup (key, value) VALUES (?, ?)').run(key, value)
}

// ── Sync Cursor CRUD ────────────────────────────────────────────────────────

export function getOrCreateSyncCursor(db: Database.Database, opencliSrcId: number): SyncCursor {
  const existing = db.prepare(`
    SELECT id, opencli_src_id AS opencliSrcId,
           forward_cursor AS forwardCursor, backward_cursor AS backwardCursor,
           backfill_complete AS backfillComplete,
           last_forward_sync AS lastForwardSync, last_backfill_sync AS lastBackfillSync,
           consecutive_errors AS consecutiveErrors, total_pages_fetched AS totalPagesFetched
    FROM sync_cursors WHERE opencli_src_id = ?
  `).get(opencliSrcId) as Record<string, unknown> | undefined

  if (existing) {
    return {
      id: existing['id'] as number,
      opencliSrcId: existing['opencliSrcId'] as number,
      forwardCursor: existing['forwardCursor'] as string | null,
      backwardCursor: existing['backwardCursor'] as string | null,
      backfillComplete: Boolean(existing['backfillComplete']),
      lastForwardSync: existing['lastForwardSync'] as string | null,
      lastBackfillSync: existing['lastBackfillSync'] as string | null,
      consecutiveErrors: existing['consecutiveErrors'] as number,
      totalPagesFetched: existing['totalPagesFetched'] as number,
    }
  }

  const result = db.prepare(`
    INSERT INTO sync_cursors (opencli_src_id) VALUES (?)
  `).run(opencliSrcId)

  return {
    id: Number(result.lastInsertRowid),
    opencliSrcId,
    forwardCursor: null,
    backwardCursor: null,
    backfillComplete: false,
    lastForwardSync: null,
    lastBackfillSync: null,
    consecutiveErrors: 0,
    totalPagesFetched: 0,
  }
}

export function updateForwardCursor(
  db: Database.Database,
  opencliSrcId: number,
  cursor: string,
): void {
  db.prepare(`
    UPDATE sync_cursors
    SET forward_cursor = ?, last_forward_sync = datetime('now'),
        consecutive_errors = 0, updated_at = datetime('now')
    WHERE opencli_src_id = ?
  `).run(cursor, opencliSrcId)
}

export function updateBackwardCursor(
  db: Database.Database,
  opencliSrcId: number,
  cursor: string | null,
  complete: boolean,
): void {
  db.prepare(`
    UPDATE sync_cursors
    SET backward_cursor = ?, backfill_complete = ?, last_backfill_sync = datetime('now'),
        total_pages_fetched = total_pages_fetched + 1, updated_at = datetime('now')
    WHERE opencli_src_id = ?
  `).run(cursor, complete ? 1 : 0, opencliSrcId)
}

export function incrementSyncErrors(db: Database.Database, opencliSrcId: number): number {
  db.prepare(`
    UPDATE sync_cursors
    SET consecutive_errors = consecutive_errors + 1, updated_at = datetime('now')
    WHERE opencli_src_id = ?
  `).run(opencliSrcId)

  const row = db.prepare(`
    SELECT consecutive_errors FROM sync_cursors WHERE opencli_src_id = ?
  `).get(opencliSrcId) as { consecutive_errors: number } | undefined
  return row?.consecutive_errors ?? 0
}

export function resetSyncCursor(db: Database.Database, opencliSrcId: number): void {
  db.prepare(`
    UPDATE sync_cursors
    SET forward_cursor = NULL, backward_cursor = NULL, backfill_complete = 0,
        consecutive_errors = 0, total_pages_fetched = 0, updated_at = datetime('now')
    WHERE opencli_src_id = ?
  `).run(opencliSrcId)
}

// ── Sync Run Logging ────────────────────────────────────────────────────────

export function insertSyncRun(
  db: Database.Database,
  opencliSrcId: number,
  direction: 'forward' | 'backfill',
  cursorBefore: string | null,
): number {
  const result = db.prepare(`
    INSERT INTO sync_runs (opencli_src_id, direction, status, cursor_before)
    VALUES (?, ?, 'running', ?)
  `).run(opencliSrcId, direction, cursorBefore)
  return Number(result.lastInsertRowid)
}

export function completeSyncRun(
  db: Database.Database,
  runId: number,
  status: 'success' | 'error' | 'partial',
  opts: {
    itemsFetched?: number
    itemsAdded?: number
    itemsUpdated?: number
    cursorAfter?: string | null
    errorMessage?: string | null
  },
): void {
  db.prepare(`
    UPDATE sync_runs
    SET status = ?, items_fetched = ?, items_added = ?, items_updated = ?,
        cursor_after = ?, error_message = ?, finished_at = datetime('now')
    WHERE id = ?
  `).run(
    status,
    opts.itemsFetched ?? 0,
    opts.itemsAdded ?? 0,
    opts.itemsUpdated ?? 0,
    opts.cursorAfter ?? null,
    opts.errorMessage ?? null,
    runId,
  )
}

export function getRecentSyncRuns(
  db: Database.Database,
  opencliSrcId: number,
  limit = 10,
): SyncRun[] {
  const rows = db.prepare(`
    SELECT id, opencli_src_id AS opencliSrcId, direction, status,
           items_fetched AS itemsFetched, items_added AS itemsAdded,
           items_updated AS itemsUpdated, cursor_before AS cursorBefore,
           cursor_after AS cursorAfter, error_message AS errorMessage,
           started_at AS startedAt, finished_at AS finishedAt
    FROM sync_runs
    WHERE opencli_src_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(opencliSrcId, limit) as Array<Record<string, unknown>>

  return rows.map(r => ({
    id: r['id'] as number,
    opencliSrcId: r['opencliSrcId'] as number,
    direction: r['direction'] as 'forward' | 'backfill',
    status: r['status'] as 'running' | 'success' | 'error' | 'partial',
    itemsFetched: r['itemsFetched'] as number,
    itemsAdded: r['itemsAdded'] as number,
    itemsUpdated: r['itemsUpdated'] as number,
    cursorBefore: r['cursorBefore'] as string | null,
    cursorAfter: r['cursorAfter'] as string | null,
    errorMessage: r['errorMessage'] as string | null,
    startedAt: r['startedAt'] as string,
    finishedAt: r['finishedAt'] as string | null,
  }))
}
