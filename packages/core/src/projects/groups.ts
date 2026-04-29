import type Database from 'better-sqlite3'
import type { ProjectGroup, ProjectIdentityKind, SessionSource } from '../types.js'

export function listProjectGroups(db: Database.Database): ProjectGroup[] {
  const rows = db.prepare(`
    SELECT identity_kind, identity_key, display_name, sources_csv,
           session_count, last_session_at
    FROM project_groups_v
    ORDER BY
      CASE identity_kind WHEN 'loose' THEN 1 ELSE 0 END,
      last_session_at IS NULL,
      last_session_at DESC
  `).all() as Array<{
    identity_kind: ProjectIdentityKind
    identity_key: string
    display_name: string
    sources_csv: string | null
    session_count: number
    last_session_at: string | null
  }>
  return rows.map(r => ({
    identityKind: r.identity_kind,
    identityKey: r.identity_key,
    displayName: r.display_name,
    sources: (r.sources_csv ?? '').split(',').filter(Boolean) as SessionSource[],
    sessionCount: r.session_count,
    lastSessionAt: r.last_session_at,
  }))
}
