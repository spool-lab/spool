import type Database from 'better-sqlite3'
import type { Session, Message, FragmentResult, StatusInfo, SearchMatchType, SessionSource, StarKind, StarredItem } from '../types.js'
import { DB_PATH, getDBSize } from './db.js'
import { buildSearchPlan, canUseSessionSearchFts, getNaturalSearchPhrase, getNaturalSearchTerms, selectFtsTableKind, shouldUseSessionFallback } from './search-query.js'

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

export function getSourceId(db: Database.Database, name: SessionSource): number {
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

export function deleteSessionByFilePath(db: Database.Database, filePath: string): boolean {
  const result = db.prepare('DELETE FROM sessions WHERE file_path = ?').run(filePath)
  return result.changes > 0
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

export function upsertSessionSearch(
  db: Database.Database,
  opts: {
    sessionId: number
    title: string
    userText: string
    assistantText: string
  },
): void {
  db.prepare(`
    INSERT INTO session_search (session_id, title, user_text, assistant_text, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(session_id) DO UPDATE SET
      title = excluded.title,
      user_text = excluded.user_text,
      assistant_text = excluded.assistant_text,
      updated_at = datetime('now')
  `).run(
    opts.sessionId,
    opts.title,
    opts.userText,
    opts.assistantText,
  )
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

const SESSION_SELECT = `
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
  JOIN projects p ON p.id = s.project_id`

export function listRecentSessions(
  db: Database.Database,
  limit = 50,
): Session[] {
  return (db.prepare(`
    ${SESSION_SELECT}
    ORDER BY s.started_at DESC
    LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>).map(rowToSession)
}

export function getSessionWithMessages(
  db: Database.Database,
  sessionUuid: string,
): { session: Session; messages: Message[] } | null {
  const sessionRow = db.prepare(`
    ${SESSION_SELECT}
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
  opts: { limit?: number; source?: SessionSource; since?: string; onlyStarred?: boolean } = {},
): FragmentResult[] {
  const { limit = 10, source, since, onlyStarred } = opts

  const rowLimit = Math.max(limit * 10, 50)
  const naturalTerms = getNaturalSearchTerms(query)
  const naturalPhrase = getNaturalSearchPhrase(query)
  const canUseSessionFts = canUseSessionSearchFts(query)

  if (naturalTerms.length === 1) {
    return searchFragmentSessionFallback(db, naturalTerms, naturalPhrase, rowLimit, 'fts', {
      ...(source ? { source } : {}),
      ...(since ? { since } : {}),
      ...(onlyStarred ? { onlyStarred } : {}),
    }).slice(0, limit)
  }

  const groups = buildSearchPlan(query).map(step => {
    if (naturalTerms.length > 1 && (step.matchType === 'phrase' || step.matchType === 'all_terms')) {
      return searchFragmentSessionFallback(db, naturalTerms, naturalPhrase, rowLimit, step.matchType, {
        ...(source ? { source } : {}),
        ...(since ? { since } : {}),
        ...(onlyStarred ? { onlyStarred } : {}),
      })
    }

    const ftsTable = selectFtsTableKind(query) === 'trigram' ? 'messages_fts_trigram' : 'messages_fts'
    const rows = searchFragmentRows(db, ftsTable, step.query, rowLimit, {
      ...(source ? { source } : {}),
      ...(since ? { since } : {}),
      ...(onlyStarred ? { onlyStarred } : {}),
    })
    return collapseFragmentRows(rows, step.matchType)
  })

  return mergeFragmentGroups(groups, limit)
}

export function searchSessionPreview(
  db: Database.Database,
  query: string,
  opts: { limit?: number; source?: SessionSource; since?: string } = {},
): FragmentResult[] {
  const { limit = 5, source, since } = opts
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return []

  const terms = getNaturalSearchTerms(query)
  const previewTerms = terms.length > 0 ? terms : [normalizedQuery]
  const rows = searchPreviewRows(db, previewTerms, limit, {
    ...(source ? { source } : {}),
    ...(since ? { since } : {}),
  })
  const snippetRows = selectBestSessionSnippets(
    db,
    rows.map(row => row['sessionId'] as number),
    previewTerms,
  )

  return rows.map((row, index) => {
    const sessionId = row['sessionId'] as number
    const snippetRow = snippetRows.get(sessionId)
    const snippetSource = snippetRow?.contentText ?? String(row['sessionTitle'] ?? '')
    const profileLabel = getProfileLabelFromFilePath(row['filePath'] as string)

    return {
      rank: index + 1,
      sessionId,
      sessionUuid: row['sessionUuid'] as string,
      sessionTitle: (row['sessionTitle'] as string | null) ?? '(no title)',
      matchCount: snippetRow?.matchingMessageCount ?? 1,
      matchType: 'all_terms',
      source: row['source'] as SessionSource,
      ...(profileLabel ? { profileLabel } : {}),
      ...(row['cwd'] ? { cwd: row['cwd'] as string } : {}),
      project: row['project'] as string,
      startedAt: row['startedAt'] as string,
      snippet: buildLikeSnippet(snippetSource, previewTerms),
      messageId: snippetRow?.messageId ?? 0,
      messageRole: snippetRow?.messageRole ?? 'system',
      messageTimestamp: snippetRow?.messageTimestamp ?? (row['startedAt'] as string),
    }
  })
}

function searchFragmentRows(
  db: Database.Database,
  ftsTable: 'messages_fts' | 'messages_fts_trigram',
  ftsQuery: string,
  limit: number,
  opts: { source?: SessionSource; since?: string; onlyStarred?: boolean } = {},
): Array<Record<string, unknown>> {
  const { source, since, onlyStarred } = opts
  const conditions: string[] = [`${ftsTable} MATCH ?`, 'm.is_sidechain = 0']
  const params: (string | number)[] = [ftsQuery]

  if (source) {
    conditions.push('src2.name = ?')
    params.push(source)
  }
  if (since) {
    conditions.push('m.timestamp >= ?')
    params.push(since)
  }
  if (onlyStarred) {
    conditions.push("EXISTS (SELECT 1 FROM stars WHERE stars.item_type = 'session' AND stars.item_uuid = sess.session_uuid)")
  }
  params.push(limit)

  const sql = `
    SELECT
      rank,
      m.id          AS messageId,
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
      snippet(${ftsTable}, -1, '<mark>', '</mark>', '…', 20) AS snippet
    FROM ${ftsTable}
    JOIN messages m ON m.id = ${ftsTable}.rowid
    JOIN sessions sess ON sess.id = m.session_id
    JOIN projects p ON p.id = sess.project_id
    JOIN sources src2 ON src2.id = sess.source_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY rank
    LIMIT ?
  `

  return db.prepare(sql).all(...params) as Array<Record<string, unknown>>
}

function searchPreviewRows(
  db: Database.Database,
  terms: string[],
  limit: number,
  opts: { source?: SessionSource; since?: string } = {},
): Array<Record<string, unknown>> {
  const { source, since } = opts
  const scoreParts: string[] = []
  const scoreParams: string[] = []
  const whereClauses: string[] = []
  const whereParams: string[] = []

  for (const term of terms) {
    const containsPattern = toLikePattern(term)
    const prefixPattern = `${escapeLike(term)}%`
    scoreParts.push(`CASE WHEN ss.title LIKE ? ESCAPE '\\' THEN 20 ELSE 0 END`)
    scoreParams.push(prefixPattern)
    scoreParts.push(`CASE WHEN ss.title LIKE ? ESCAPE '\\' THEN 8 ELSE 0 END`)
    scoreParams.push(containsPattern)
    scoreParts.push(`CASE WHEN ss.user_text LIKE ? ESCAPE '\\' THEN 4 ELSE 0 END`)
    scoreParams.push(containsPattern)
    scoreParts.push(`CASE WHEN ss.assistant_text LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END`)
    scoreParams.push(containsPattern)

    whereClauses.push(`(
      ss.title LIKE ? ESCAPE '\\'
      OR ss.user_text LIKE ? ESCAPE '\\'
      OR ss.assistant_text LIKE ? ESCAPE '\\'
    )`)
    whereParams.push(containsPattern, containsPattern, containsPattern)
  }

  const conditions = [...whereClauses]
  const params: Array<string | number> = [...scoreParams, ...whereParams]

  if (source) {
    conditions.push('src2.name = ?')
    params.push(source)
  }
  if (since) {
    conditions.push('sess.started_at >= ?')
    params.push(since)
  }
  params.push(limit)

  const previewScoreExpr = scoreParts.join(' + ')
  const sql = `
    SELECT
      sess.id AS sessionId,
      sess.session_uuid AS sessionUuid,
      sess.file_path AS filePath,
      sess.title AS sessionTitle,
      sess.started_at AS startedAt,
      sess.cwd AS cwd,
      p.display_path AS project,
      src2.name AS source,
      ${previewScoreExpr} AS previewScore
    FROM sessions sess
    JOIN session_search ss ON ss.session_id = sess.id
    JOIN projects p ON p.id = sess.project_id
    JOIN sources src2 ON src2.id = sess.source_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY previewScore DESC, sess.started_at DESC
    LIMIT ?
  `

  return db.prepare(sql).all(...params) as Array<Record<string, unknown>>
}

function collapseFragmentRows(rows: Array<Record<string, unknown>>, matchType: SearchMatchType): FragmentResult[] {
  const seen = new Map<string, FragmentResult>()
  const ordered: FragmentResult[] = []

  for (const row of rows) {
    const sessionUuid = row['sessionUuid'] as string
    const existing = seen.get(sessionUuid)

    if (existing) {
      existing.matchCount += 1
      continue
    }

    const profileLabel = getProfileLabelFromFilePath(row['filePath'] as string)
    const fragment: FragmentResult = {
      rank: ordered.length + 1,
      sessionId: row['sessionId'] as number,
      sessionUuid,
      sessionTitle: (row['sessionTitle'] as string | null) ?? '(no title)',
      matchCount: 1,
      matchType,
      source: row['source'] as SessionSource,
      ...(profileLabel ? { profileLabel } : {}),
      ...(row['cwd'] ? { cwd: row['cwd'] as string } : {}),
      project: row['project'] as string,
      startedAt: row['startedAt'] as string,
      snippet: row['snippet'] as string,
      messageId: row['messageId'] as number,
      messageRole: row['messageRole'] as string,
      messageTimestamp: row['messageTimestamp'] as string,
    }

    seen.set(sessionUuid, fragment)
    ordered.push(fragment)
  }

  return ordered
}

function mergeFragmentGroups(groups: FragmentResult[][], limit: number): FragmentResult[] {
  const merged: FragmentResult[] = []
  const seen = new Map<string, FragmentResult>()

  for (const group of groups) {
    for (const fragment of group) {
      const existing = seen.get(fragment.sessionUuid)
      if (existing) {
        existing.matchCount = Math.max(existing.matchCount, fragment.matchCount)
        continue
      }
      if (merged.length >= limit) continue

      const next = {
        ...fragment,
        rank: merged.length + 1,
      }
      merged.push(next)
      seen.set(next.sessionUuid, next)
    }
  }

  return merged
}

function searchFragmentSessionFallback(
  db: Database.Database,
  terms: string[],
  phrase: string,
  limit: number,
  matchType: SearchMatchType,
  opts: { source?: SessionSource; since?: string; onlyStarred?: boolean } = {},
): FragmentResult[] {
  if (terms.length < 1) return []

  const rows = searchSessionRowsByTerms(db, terms, phrase, limit, matchType, opts)
  const snippetRows = selectBestSessionSnippets(
    db,
    rows.map(row => row['sessionId'] as number),
    terms,
  )
  type RankedFallbackRow = Omit<FragmentResult, 'rank'> & {
    _titleMatchScore: number
    _userMatchScore: number
    _assistantMatchScore: number
    _sameMessageCoverage: number
  }
  const ranked = rows.map((row) => {
    const snippetRow = snippetRows.get(row['sessionId'] as number)
    const snippetSource = snippetRow?.contentText ?? String(row['sessionTitle'] ?? '')
    const profileLabel = getProfileLabelFromFilePath(row['filePath'] as string)

    return {
      sessionId: row['sessionId'] as number,
      sessionUuid: row['sessionUuid'] as string,
      sessionTitle: (row['sessionTitle'] as string | null) ?? '(no title)',
      matchCount: snippetRow?.matchingMessageCount ?? 1,
      matchType,
      source: row['source'] as SessionSource,
      ...(profileLabel ? { profileLabel } : {}),
      ...(row['cwd'] ? { cwd: row['cwd'] as string } : {}),
      project: row['project'] as string,
      startedAt: row['startedAt'] as string,
      snippet: buildLikeSnippet(snippetSource, terms),
      messageId: snippetRow?.messageId ?? 0,
      messageRole: snippetRow?.messageRole ?? 'system',
      messageTimestamp: snippetRow?.messageTimestamp ?? (row['startedAt'] as string),
      _titleMatchScore: row['titleMatchScore'] as number,
      _userMatchScore: row['userMatchScore'] as number,
      _assistantMatchScore: row['assistantMatchScore'] as number,
      _sameMessageCoverage: snippetRow?.termCoverage ?? 0,
    } satisfies RankedFallbackRow
  })

  ranked.sort((a, b) => {
    if (b._sameMessageCoverage !== a._sameMessageCoverage) {
      return b._sameMessageCoverage - a._sameMessageCoverage
    }
    if (b._titleMatchScore !== a._titleMatchScore) {
      return b._titleMatchScore - a._titleMatchScore
    }
    if (b._userMatchScore !== a._userMatchScore) {
      return b._userMatchScore - a._userMatchScore
    }
    if (b._assistantMatchScore !== a._assistantMatchScore) {
      return b._assistantMatchScore - a._assistantMatchScore
    }
    return String(b.startedAt).localeCompare(String(a.startedAt))
  })

  return ranked.map((row, index) => ({
    rank: index + 1,
    sessionId: row.sessionId,
    sessionUuid: row.sessionUuid,
    sessionTitle: row.sessionTitle,
    matchCount: row.matchCount,
    matchType: row.matchType,
    source: row.source,
    ...(row.profileLabel ? { profileLabel: row.profileLabel } : {}),
    ...(row.cwd ? { cwd: row.cwd } : {}),
    project: row.project,
    startedAt: row.startedAt,
    snippet: row.snippet,
    messageId: row.messageId,
    messageRole: row.messageRole,
    messageTimestamp: row.messageTimestamp,
  }))
}

function searchSessionRowsByTerms(
  db: Database.Database,
  terms: string[],
  phrase: string,
  limit: number,
  matchType: SearchMatchType,
  opts: { source?: SessionSource; since?: string; onlyStarred?: boolean } = {},
): Array<Record<string, unknown>> {
  if (canUseSessionSearchFts(phrase)) {
    return searchSessionRowsByFts(db, terms, phrase, limit, matchType, opts)
  }

  return searchSessionRowsByLike(db, terms, limit, opts)
}

function searchSessionRowsByLike(
  db: Database.Database,
  terms: string[],
  limit: number,
  opts: { source?: SessionSource; since?: string; onlyStarred?: boolean } = {},
): Array<Record<string, unknown>> {
  const { source, since, onlyStarred } = opts
  const titleScoreParts: string[] = []
  const whereClauses: string[] = []
  const scoreParams: string[] = []
  const whereParams: string[] = []

  for (const term of terms) {
    const pattern = toLikePattern(term)
    titleScoreParts.push(`CASE WHEN ss.title LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END`)
    scoreParams.push(pattern)
    titleScoreParts.push(`CASE WHEN ss.user_text LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END`)
    scoreParams.push(pattern)
    titleScoreParts.push(`CASE WHEN ss.assistant_text LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END`)
    scoreParams.push(pattern)
    whereClauses.push(`(
      ss.title LIKE ? ESCAPE '\\'
      OR ss.user_text LIKE ? ESCAPE '\\'
      OR ss.assistant_text LIKE ? ESCAPE '\\'
    )`)
    whereParams.push(pattern, pattern, pattern)
  }

  const conditions = [...whereClauses]
  const params: Array<string | number> = [...scoreParams, ...whereParams]

  if (source) {
    conditions.push('src2.name = ?')
    params.push(source)
  }
  if (since) {
    conditions.push('sess.started_at >= ?')
    params.push(since)
  }
  if (onlyStarred) {
    conditions.push("EXISTS (SELECT 1 FROM stars WHERE stars.item_type = 'session' AND stars.item_uuid = sess.session_uuid)")
  }
  params.push(limit)

  const titleScoreExpr = titleScoreParts.filter((_, index) => index % 3 === 0).join(' + ')
  const userScoreExpr = titleScoreParts.filter((_, index) => index % 3 === 1).join(' + ')
  const assistantScoreExpr = titleScoreParts.filter((_, index) => index % 3 === 2).join(' + ')
  const sql = `
    SELECT
      sess.id AS sessionId,
      sess.session_uuid AS sessionUuid,
      sess.file_path AS filePath,
      sess.title AS sessionTitle,
      sess.started_at AS startedAt,
      sess.cwd AS cwd,
      p.display_path AS project,
      src2.name AS source,
      ${titleScoreExpr} AS titleMatchScore,
      ${userScoreExpr} AS userMatchScore,
      ${assistantScoreExpr} AS assistantMatchScore
    FROM sessions sess
    JOIN session_search ss ON ss.session_id = sess.id
    JOIN projects p ON p.id = sess.project_id
    JOIN sources src2 ON src2.id = sess.source_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY titleMatchScore DESC, userMatchScore DESC, assistantMatchScore DESC, sess.started_at DESC
    LIMIT ?
  `

  return db.prepare(sql).all(...params) as Array<Record<string, unknown>>
}

function searchSessionRowsByFts(
  db: Database.Database,
  terms: string[],
  phrase: string,
  limit: number,
  matchType: SearchMatchType,
  opts: { source?: SessionSource; since?: string; onlyStarred?: boolean } = {},
): Array<Record<string, unknown>> {
  const { source, since, onlyStarred } = opts
  const ftsTable = selectFtsTableKind(phrase) === 'trigram' ? 'session_search_fts_trigram' : 'session_search_fts'
  const ftsQuery = matchType === 'phrase'
    ? `"${phrase.replace(/"/g, '""')}"`
    : terms.map(term => `"${term.replace(/"/g, '""')}"`).join(' AND ')

  const titleScoreParts: string[] = []
  const scoreParams: string[] = []
  const likeParams: string[] = []

  for (const term of terms) {
    const pattern = toLikePattern(term)
    titleScoreParts.push(`CASE WHEN ss.title LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END`)
    scoreParams.push(pattern)
    titleScoreParts.push(`CASE WHEN ss.user_text LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END`)
    scoreParams.push(pattern)
    titleScoreParts.push(`CASE WHEN ss.assistant_text LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END`)
    scoreParams.push(pattern)
  }

  const conditions = [`${ftsTable} MATCH ?`]
  const params: Array<string | number> = [...scoreParams, ftsQuery]

  if (source) {
    conditions.push('src2.name = ?')
    params.push(source)
  }
  if (since) {
    conditions.push('sess.started_at >= ?')
    params.push(since)
  }
  if (onlyStarred) {
    conditions.push("EXISTS (SELECT 1 FROM stars WHERE stars.item_type = 'session' AND stars.item_uuid = sess.session_uuid)")
  }
  params.push(limit)

  const titleScoreExpr = titleScoreParts.filter((_, index) => index % 3 === 0).join(' + ')
  const userScoreExpr = titleScoreParts.filter((_, index) => index % 3 === 1).join(' + ')
  const assistantScoreExpr = titleScoreParts.filter((_, index) => index % 3 === 2).join(' + ')
  const sql = `
    SELECT
      sess.id AS sessionId,
      sess.session_uuid AS sessionUuid,
      sess.file_path AS filePath,
      sess.title AS sessionTitle,
      sess.started_at AS startedAt,
      sess.cwd AS cwd,
      p.display_path AS project,
      src2.name AS source,
      bm25(${ftsTable}, 5.0, 1.5, 0.8) AS ftsScore,
      ${titleScoreExpr} AS titleMatchScore,
      ${userScoreExpr} AS userMatchScore,
      ${assistantScoreExpr} AS assistantMatchScore
    FROM ${ftsTable}
    JOIN session_search ss ON ss.session_id = ${ftsTable}.rowid
    JOIN sessions sess ON sess.id = ss.session_id
    JOIN projects p ON p.id = sess.project_id
    JOIN sources src2 ON src2.id = sess.source_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY titleMatchScore DESC, userMatchScore DESC, assistantMatchScore DESC, ftsScore ASC, sess.started_at DESC
    LIMIT ?
  `

  return db.prepare(sql).all(...params) as Array<Record<string, unknown>>
}

function selectBestSessionSnippets(
  db: Database.Database,
  sessionIds: number[],
  terms: string[],
) {
  type SessionSnippetRow = {
    sessionId: number
    messageId: number
    messageRole: string
    messageTimestamp: string
    contentText: string
    termCoverage?: number
    matchingMessageCount?: number
  }
  if (sessionIds.length === 0) return new Map<number, SessionSnippetRow>()
  const coverageExpr = terms.map(() => `CASE WHEN content_text LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END`).join(' + ')
  const anyClauses = terms.map(() => 'content_text LIKE ? ESCAPE \'\\\'').join(' OR ')
  const allPatterns = terms.map(toLikePattern)
  const anyPatterns = terms.map(toLikePattern)
  const sessionPlaceholders = sessionIds.map(() => '?').join(', ')

  const matchSql = `
    WITH raw AS (
      SELECT
        id AS messageId,
        session_id AS sessionId,
        role AS messageRole,
        timestamp AS messageTimestamp,
        content_text AS contentText,
        seq,
        ${coverageExpr} AS termCoverage
      FROM messages
      WHERE session_id IN (${sessionPlaceholders})
        AND is_sidechain = 0
        AND (${anyClauses})
    ),
    ranked AS (
      SELECT
        sessionId,
        messageId,
        messageRole,
        messageTimestamp,
        contentText,
        termCoverage,
        COUNT(*) OVER (PARTITION BY sessionId) AS matchingMessageCount,
        ROW_NUMBER() OVER (
          PARTITION BY sessionId
          ORDER BY termCoverage DESC, CASE WHEN messageRole = 'user' THEN 0 ELSE 1 END, seq
        ) AS rn
      FROM raw
    )
    SELECT
      sessionId,
      messageId,
      messageRole,
      messageTimestamp,
      contentText,
      termCoverage,
      matchingMessageCount
    FROM ranked
    WHERE rn = 1
  `

  const rows = db.prepare(matchSql).all(...allPatterns, ...sessionIds, ...anyPatterns) as SessionSnippetRow[]
  return new Map(rows.map(row => [row.sessionId, row]))
}

export function buildLikeSnippet(text: string, terms: string[]): string {
  const normalizedText = text.trim()
  if (!normalizedText) return ''

  // Case-insensitive hit search: the upstream SQL uses LIKE which is ASCII
  // case-insensitive, so the matched content may differ in case from the
  // query terms (e.g. user typed "dark fantasy", text has "Dark Fantasy").
  const lowerText = normalizedText.toLowerCase()
  const firstHit = terms
    .map(term => lowerText.indexOf(term.toLowerCase()))
    .filter(index => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0

  const start = Math.max(0, firstHit - 60)
  const end = Math.min(normalizedText.length, firstHit + 140)
  let snippet = normalizedText.slice(start, end)

  if (start > 0) snippet = `…${snippet}`
  if (end < normalizedText.length) snippet = `${snippet}…`

  // Highlight preserving original casing via case-insensitive regex.
  const uniqueTerms = Array.from(new Set(terms)).sort((a, b) => b.length - a.length)
  for (const term of uniqueTerms) {
    if (!term) continue
    const pattern = new RegExp(escapeRegex(term), 'gi')
    snippet = snippet.replace(pattern, m => `<mark>${m}</mark>`)
  }

  return snippet
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toLikePattern(term: string): string {
  return `%${escapeLike(term)}%`
}

function escapeLike(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}

// ── Stars (sessions + captures) ─────────────────────────────────────────────

export function starItem(db: Database.Database, kind: StarKind, uuid: string): void {
  db.prepare(
    'INSERT OR IGNORE INTO stars (item_type, item_uuid) VALUES (?, ?)',
  ).run(kind, uuid)
}

export function unstarItem(db: Database.Database, kind: StarKind, uuid: string): void {
  db.prepare('DELETE FROM stars WHERE item_type = ? AND item_uuid = ?').run(kind, uuid)
}

export function isStarred(db: Database.Database, kind: StarKind, uuid: string): boolean {
  const row = db
    .prepare('SELECT 1 AS hit FROM stars WHERE item_type = ? AND item_uuid = ?')
    .get(kind, uuid) as { hit: number } | undefined
  return row !== undefined
}

export function getStarredUuidsByType(
  db: Database.Database,
): { session: string[] } {
  const rows = db.prepare(`
    SELECT item_uuid AS uuid
    FROM stars
    WHERE item_type = 'session'
      AND EXISTS (SELECT 1 FROM sessions WHERE session_uuid = stars.item_uuid)
  `).all() as Array<{ uuid: string }>
  return { session: rows.map(r => r.uuid) }
}

export function listStarredItems(db: Database.Database, limit = 200): StarredItem[] {
  // Orphan-filter at the SQL level so LIMIT counts only live rows; otherwise
  // a user with 200+ orphaned stars could see an empty page.
  const rows = db.prepare(`
    SELECT item_uuid AS uuid, starred_at AS starredAt
    FROM stars
    WHERE item_type = 'session'
      AND EXISTS (SELECT 1 FROM sessions WHERE session_uuid = stars.item_uuid)
    ORDER BY starred_at DESC
    LIMIT ?
  `).all(limit) as Array<{ uuid: string; starredAt: string }>

  if (rows.length === 0) return []

  const sessionUuids = rows.map(r => r.uuid)
  const sessionMap = new Map<string, Session>()
  const placeholders = sessionUuids.map(() => '?').join(', ')
  const sessRows = db.prepare(`
    ${SESSION_SELECT}
    WHERE s.session_uuid IN (${placeholders})
  `).all(...sessionUuids) as Array<Record<string, unknown>>
  for (const row of sessRows) {
    const session = rowToSession(row)
    sessionMap.set(session.sessionUuid, session)
  }

  const items: StarredItem[] = []
  for (const r of rows) {
    const session = sessionMap.get(r.uuid)
    if (session) items.push({ kind: 'session', starredAt: r.starredAt, session })
  }
  return items
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
  const geminiRow = counts.find(r => r.name === 'gemini')

  return {
    dbPath: DB_PATH,
    totalSessions,
    claudeSessions: claudeRow?.cnt ?? 0,
    codexSessions: codexRow?.cnt ?? 0,
    geminiSessions: geminiRow?.cnt ?? 0,
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
    source: r['source'] as SessionSource,
    projectDisplayPath: r['projectDisplayPath'] as string,
    projectDisplayName: r['projectDisplayName'] as string,
  }
}

function getProfileLabelFromFilePath(filePath: string): string | undefined {
  const match = filePath.match(/\/\.(?:claude|codex)-profiles\/([^/]+)\//)
  return match?.[1]
}

