import type Database from 'better-sqlite3'
import type { Session, SessionSource } from '../types.js'
import { SESSION_SELECT, rowToSession } from '../db/queries.js'

export type ProjectSessionSortOrder = 'recent' | 'oldest' | 'most_messages' | 'title'

export interface ListSessionsByIdentityOptions {
  sources?: SessionSource[]
  sortOrder?: ProjectSessionSortOrder
  limit?: number
}

export function listSessionsByIdentity(
  db: Database.Database,
  identityKey: string,
  options: ListSessionsByIdentityOptions = {},
): Session[] {
  const { sources, sortOrder = 'recent', limit = 500 } = options

  const conditions: string[] = ['p.identity_key = ?']
  const params: unknown[] = [identityKey]

  if (sources && sources.length > 0) {
    const placeholders = sources.map(() => '?').join(',')
    conditions.push(`src.name IN (${placeholders})`)
    params.push(...sources)
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
