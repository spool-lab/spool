import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/db.js'
import { listSessionsByIdentity } from './sessions.js'

describe('listSessionsByIdentity', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    db.exec(`
      INSERT INTO projects (source_id, slug, display_path, display_name, identity_kind, identity_key)
      VALUES
        (1,'spool-c','/Users/chen/Code/spool','spool','git_remote','github.com/spool-lab/spool'),
        (2,'spool-x','/Users/chen/Code/spool','spool','git_remote','github.com/spool-lab/spool'),
        (1,'other','/Users/chen/Code/other','other','path','/Users/chen/Code/other');
      INSERT INTO sessions (project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count, has_tool_use, raw_file_mtime)
      VALUES
        (1,1,'u1','/p1','beta',  '2026-04-28T10:00:00Z','2026-04-28T10:30:00Z', 5, 0,'2026-04-28T10:30:00Z'),
        (1,1,'u2','/p2','alpha', '2026-04-27T10:00:00Z','2026-04-27T10:30:00Z',10, 0,'2026-04-27T10:30:00Z'),
        (2,2,'u3','/p3','gamma', '2026-04-26T10:00:00Z','2026-04-26T10:30:00Z', 3, 0,'2026-04-26T10:30:00Z'),
        (3,1,'u4','/p4','other-a','2026-04-29T10:00:00Z','2026-04-29T10:30:00Z', 1, 0,'2026-04-29T10:30:00Z');
    `)
  })

  it('only returns sessions matching identity_key', () => {
    const sessions = listSessionsByIdentity(db, 'github.com/spool-lab/spool')
    expect(sessions).toHaveLength(3)
    expect(sessions.map(s => s.sessionUuid).sort()).toEqual(['u1', 'u2', 'u3'])
  })

  it('default sort is started_at DESC', () => {
    const sessions = listSessionsByIdentity(db, 'github.com/spool-lab/spool')
    expect(sessions.map(s => s.sessionUuid)).toEqual(['u1', 'u2', 'u3'])
  })

  it('sortOrder oldest', () => {
    const sessions = listSessionsByIdentity(db, 'github.com/spool-lab/spool', { sortOrder: 'oldest' })
    expect(sessions.map(s => s.sessionUuid)).toEqual(['u3', 'u2', 'u1'])
  })

  it('sortOrder most_messages', () => {
    const sessions = listSessionsByIdentity(db, 'github.com/spool-lab/spool', { sortOrder: 'most_messages' })
    expect(sessions.map(s => s.sessionUuid)).toEqual(['u2', 'u1', 'u3'])
  })

  it('sortOrder title (alphabetical)', () => {
    const sessions = listSessionsByIdentity(db, 'github.com/spool-lab/spool', { sortOrder: 'title' })
    expect(sessions.map(s => s.title)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('source filter narrows to matching sources', () => {
    const sessions = listSessionsByIdentity(db, 'github.com/spool-lab/spool', { sources: ['claude'] })
    expect(sessions.map(s => s.sessionUuid).sort()).toEqual(['u1', 'u2'])
  })

  it('returns empty array when identity_key has no sessions', () => {
    expect(listSessionsByIdentity(db, 'no-such-key')).toEqual([])
  })

  it('respects limit', () => {
    const sessions = listSessionsByIdentity(db, 'github.com/spool-lab/spool', { limit: 2 })
    expect(sessions).toHaveLength(2)
  })
})
