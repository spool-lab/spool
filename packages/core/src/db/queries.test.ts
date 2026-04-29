import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from './db.js'
import { getOrCreateProject } from './queries.js'

describe('getOrCreateProject (with identity)', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    // sources are seeded by runMigrations; do not re-insert
  })

  it('persists identity_kind and identity_key', () => {
    getOrCreateProject(db, 1, 'spool-c', '/Users/chen/Code/spool', 'spool', {
      identityKind: 'git_remote',
      identityKey: 'github.com/spool-lab/spool',
    })
    const row = db.prepare(`SELECT identity_kind, identity_key FROM projects WHERE slug = ?`)
      .get('spool-c') as { identity_kind: string; identity_key: string }
    expect(row.identity_kind).toBe('git_remote')
    expect(row.identity_key).toBe('github.com/spool-lab/spool')
  })

  it('does not duplicate on second call (same source_id, slug)', () => {
    const id1 = getOrCreateProject(db, 1, 'spool-c', '/Users/chen/Code/spool', 'spool', {
      identityKind: 'git_remote', identityKey: 'github.com/spool-lab/spool',
    })
    const id2 = getOrCreateProject(db, 1, 'spool-c', '/Users/chen/Code/spool', 'spool', {
      identityKind: 'git_remote', identityKey: 'github.com/spool-lab/spool',
    })
    expect(id1).toBe(id2)
  })
})
