import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from './db.js'
import { getOrCreateProject, upsertSession } from './queries.js'

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

describe('upsertSession (title_source authority)', () => {
  let db: Database.Database
  let projectId: number

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    projectId = getOrCreateProject(db, 1, 'p', '/p', 'p', { identityKind: 'path', identityKey: '/p' })
  })

  function baseOpts(overrides: Partial<Parameters<typeof upsertSession>[1]> = {}) {
    return {
      projectId, sourceId: 1,
      sessionUuid: 'sess-1',
      filePath: '/fake.jsonl',
      title: 'derived title',
      startedAt: '2026-05-09', endedAt: '2026-05-09',
      messageCount: 1, hasToolUse: false,
      cwd: '/', model: 'claude',
      rawFileMtime: '2026-05-09',
      ...overrides,
    }
  }

  it('updates title on re-upsert when title_source is derived (default)', () => {
    upsertSession(db, baseOpts({ title: 'first' }))
    upsertSession(db, baseOpts({ title: 'second' }))
    const row = db.prepare('SELECT title, title_source FROM sessions WHERE session_uuid = ?').get('sess-1') as { title: string; title_source: string }
    expect(row.title).toBe('second')
    expect(row.title_source).toBe('derived')
  })

  it('preserves title on re-upsert when title_source is "spool"', () => {
    upsertSession(db, baseOpts({ title: 'spool-set' }))
    db.prepare(`UPDATE sessions SET title_source = 'spool' WHERE session_uuid = 'sess-1'`).run()

    upsertSession(db, baseOpts({ title: 'derived from sync' }))

    const row = db.prepare('SELECT title, title_source FROM sessions WHERE session_uuid = ?').get('sess-1') as { title: string; title_source: string }
    expect(row.title).toBe('spool-set')
    expect(row.title_source).toBe('spool')
  })

  it('preserves title on re-upsert when title_source is "user"', () => {
    upsertSession(db, baseOpts({ title: 'placeholder' }))
    db.prepare(`UPDATE sessions SET title = 'user-renamed', title_source = 'user' WHERE session_uuid = 'sess-1'`).run()

    upsertSession(db, baseOpts({ title: 'derived overwrite' }))

    const row = db.prepare('SELECT title, title_source FROM sessions WHERE session_uuid = ?').get('sess-1') as { title: string; title_source: string }
    expect(row.title).toBe('user-renamed')
    expect(row.title_source).toBe('user')
  })
})
