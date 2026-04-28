import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from './db.js'

describe('migration v6', () => {
  let db: Database.Database
  beforeEach(() => { db = new Database(':memory:') })
  afterEach(() => db.close())

  it('adds identity_kind / identity_key columns to projects', () => {
    runMigrations(db)
    const cols = db.prepare(`PRAGMA table_info(projects)`).all() as { name: string }[]
    expect(cols.map(c => c.name)).toEqual(
      expect.arrayContaining(['identity_kind', 'identity_key'])
    )
    const v = db.pragma('user_version') as Array<{ user_version: number }>
    expect(v[0].user_version).toBe(6)
  })

  it('creates project_groups_v view', () => {
    runMigrations(db)
    const v = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='view' AND name='project_groups_v'`
    ).get()
    expect(v).toBeDefined()
  })

  it('view groups rows with same identity across sources', () => {
    runMigrations(db)
    db.exec(`
      INSERT INTO projects (source_id, slug, display_path, display_name, identity_kind, identity_key)
        VALUES
          (1, 'spool-c', '/Users/chen/Code/spool', 'spool', 'git_remote', 'github.com/spool-lab/spool'),
          (2, 'spool-x', '/Users/chen/Code/spool', 'spool', 'git_remote', 'github.com/spool-lab/spool');
    `)
    const groups = db.prepare(`SELECT * FROM project_groups_v`).all() as Array<{ identity_key: string }>
    expect(groups).toHaveLength(1)
    expect(groups[0].identity_key).toBe('github.com/spool-lab/spool')
  })
})
