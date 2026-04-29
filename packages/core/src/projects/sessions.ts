import type Database from 'better-sqlite3'
import type { Session, SessionSource } from '../types.js'
import { SESSION_SELECT, rowToSession } from '../db/queries.js'

export type ProjectSessionSortOrder = 'recent' | 'oldest' | 'most_messages' | 'title'

export interface ListSessionsByIdentityOptions {
  sources?: SessionSource[]
  sortOrder?: ProjectSessionSortOrder
  limit?: number
  excludePinned?: boolean
}

export function listSessionsByIdentity(
  db: Database.Database,
  identityKey: string,
  options: ListSessionsByIdentityOptions = {},
): Session[] {
  const { sources, sortOrder = 'recent', limit = 500, excludePinned = false } = options

  const conditions: string[] = ['p.identity_key = ?', 's.message_count > 0']
  const params: unknown[] = [identityKey]

  if (sources && sources.length > 0) {
    const placeholders = sources.map(() => '?').join(',')
    conditions.push(`src.name IN (${placeholders})`)
    params.push(...sources)
  }

  if (excludePinned) {
    conditions.push('NOT EXISTS (SELECT 1 FROM pins WHERE pins.session_uuid = s.session_uuid)')
  }

  const orderBy = orderByClause(sortOrder)
  const sql = `
    ${SESSION_SELECT}
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT ?
  `
  params.push(limit)

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>
  return rows.map(rowToSession)
}

export function listPinnedSessionsByIdentity(
  db: Database.Database,
  identityKey: string,
): Session[] {
  const rows = db.prepare(`
    ${SESSION_SELECT}
    JOIN pins ON pins.session_uuid = s.session_uuid
    WHERE p.identity_key = ? AND s.message_count > 0
    ORDER BY pins.pinned_at DESC
  `).all(identityKey) as Array<Record<string, unknown>>
  return rows.map(rowToSession)
}

function orderByClause(sortOrder: ProjectSessionSortOrder): string {
  switch (sortOrder) {
    case 'oldest':
      return 's.started_at ASC'
    case 'most_messages':
      return 's.message_count DESC, s.started_at DESC'
    case 'title':
      return 'COALESCE(NULLIF(s.title, \'\'), \'\') ASC, s.started_at DESC'
    case 'recent':
    default:
      return 's.started_at DESC'
  }
}
