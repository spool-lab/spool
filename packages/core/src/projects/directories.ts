import type Database from 'better-sqlite3'
import type { DirectoryGroup, Session, SessionSource } from '../types.js'
import { rowToSession } from '../db/queries.js'
import type { ProjectSessionSortOrder } from './sessions.js'

export function listDirectoryGroups(db: Database.Database): DirectoryGroup[] {
  const rows = db.prepare(`
    SELECT
      p.display_path,
      p.slug,
      GROUP_CONCAT(DISTINCT s.name) AS sources_csv,
      COUNT(sess.id)                AS session_count,
      MAX(sess.started_at)          AS last_session_at
    FROM projects p
    JOIN sources s ON s.id = p.source_id
    LEFT JOIN sessions sess ON sess.project_id = p.id AND sess.message_count > 0
    GROUP BY p.id
    HAVING session_count > 0
    ORDER BY last_session_at IS NULL, last_session_at DESC
  `).all() as Array<{
    display_path: string
    slug: string
    sources_csv: string | null
    session_count: number
    last_session_at: string | null
  }>

  return rows.map(r => ({
    displayPath: r.display_path,
    slug: r.slug,
    sources: (r.sources_csv ?? '').split(',').filter(Boolean) as SessionSource[],
    sessionCount: r.session_count,
    lastSessionAt: r.last_session_at,
  }))
}

export function listSessionsBySlug(
  db: Database.Database,
  slug: string,
  options: { sortOrder?: ProjectSessionSortOrder; limit?: number } = {},
): Session[] {
  const { sortOrder = 'recent', limit = 500 } = options
  const orderBy = sortOrderToClause(sortOrder)
  const rows = db.prepare(`
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
    WHERE p.slug = ? AND s.message_count > 0
    ORDER BY ${orderBy}
    LIMIT ?
  `).all(slug, limit) as Array<Record<string, unknown>>
  return rows.map(rowToSession)
}

function sortOrderToClause(order: ProjectSessionSortOrder): string {
  switch (order) {
    case 'oldest': return 's.started_at ASC'
    case 'most_messages': return 's.message_count DESC, s.started_at DESC'
    case 'title': return "COALESCE(NULLIF(s.title, ''), '') ASC, s.started_at DESC"
    default: return 's.started_at DESC'
  }
}
