import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const tempDirs: string[] = []
const openDbs: Array<{ close: () => void }> = []

afterEach(() => {
  while (openDbs.length > 0) openDbs.pop()?.close()
  vi.unstubAllEnvs()
  vi.resetModules()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('stars', () => {
  it('star + isStarred + unstar roundtrip', async () => {
    const mod = await load()
    const { db, seedSession } = mod
    const uuid = 'sess-1'
    seedSession(uuid, 'Proj', 'Title')

    expect(mod.isStarred(db, 'session', uuid)).toBe(false)
    mod.starItem(db, 'session', uuid)
    expect(mod.isStarred(db, 'session', uuid)).toBe(true)

    mod.unstarItem(db, 'session', uuid)
    expect(mod.isStarred(db, 'session', uuid)).toBe(false)
  })

  it('starItem is idempotent and preserves original starred_at', async () => {
    const mod = await load()
    const { db, seedSession } = mod
    seedSession('x', 'P', 'T')
    mod.starItem(db, 'session', 'x')
    const first = db.prepare('SELECT starred_at FROM stars WHERE item_type=? AND item_uuid=?').get('session', 'x') as { starred_at: string }
    mod.starItem(db, 'session', 'x')
    const second = db.prepare('SELECT starred_at FROM stars WHERE item_type=? AND item_uuid=?').get('session', 'x') as { starred_at: string }
    expect(second.starred_at).toBe(first.starred_at)
  })

  it('CHECK constraint rejects non-session item_type', async () => {
    const mod = await load()
    const { db } = mod
    expect(() =>
      db.prepare('INSERT INTO stars (item_type, item_uuid) VALUES (?, ?)').run('capture', 'x'),
    ).toThrow()
    expect(() =>
      db.prepare('INSERT INTO stars (item_type, item_uuid) VALUES (?, ?)').run('bogus', 'x'),
    ).toThrow()
  })

  it('listStarredItems returns sessions ordered by starred_at DESC', async () => {
    const mod = await load()
    const { db, seedSession } = mod
    seedSession('s1', 'P', 'Session one')
    seedSession('s2', 'P', 'Session two')
    seedSession('s3', 'P', 'Session three')

    db.prepare("INSERT INTO stars (item_type, item_uuid, starred_at) VALUES ('session', 's1', '2026-01-01 00:00:00')").run()
    db.prepare("INSERT INTO stars (item_type, item_uuid, starred_at) VALUES ('session', 's2', '2026-02-01 00:00:00')").run()
    db.prepare("INSERT INTO stars (item_type, item_uuid, starred_at) VALUES ('session', 's3', '2026-03-01 00:00:00')").run()

    const items = mod.listStarredItems(db)
    expect(items.map(i => i.session.sessionUuid)).toEqual(['s3', 's2', 's1'])
  })

  it('listStarredItems filters orphans (session referent missing)', async () => {
    const mod = await load()
    const { db, seedSession } = mod
    seedSession('alive', 'P', 'A')
    mod.starItem(db, 'session', 'alive')
    mod.starItem(db, 'session', 'ghost-session')

    const items = mod.listStarredItems(db)
    expect(items).toHaveLength(1)
    expect(items[0]!.session.sessionUuid).toBe('alive')
  })

  it('getStarredUuidsByType returns session uuids', async () => {
    const mod = await load()
    const { db, seedSession } = mod
    seedSession('s1', 'P', 'T')
    seedSession('s2', 'P', 'T')
    mod.starItem(db, 'session', 's1')
    mod.starItem(db, 'session', 's2')

    const { session } = mod.getStarredUuidsByType(db)
    expect(new Set(session)).toEqual(new Set(['s1', 's2']))
  })

  it('getStarredUuidsByType filters orphans', async () => {
    const mod = await load()
    const { db, seedSession } = mod
    seedSession('alive', 'P', 'T')
    mod.starItem(db, 'session', 'alive')
    mod.starItem(db, 'session', 'ghost-session')

    const { session } = mod.getStarredUuidsByType(db)
    expect(session).toEqual(['alive'])
  })

  it('unstarItem on non-starred uuid is a no-op', async () => {
    const mod = await load()
    const { db } = mod
    expect(() => mod.unstarItem(db, 'session', 'nobody')).not.toThrow()
  })

  it('preserves session orphans across re-open (transient-absence design)', async () => {
    const spoolDir = makeTempDir('spool-stars-sweep-')
    vi.stubEnv('SPOOL_DATA_DIR', spoolDir)

    const first = await loadInto(spoolDir)
    first.db.prepare("INSERT INTO stars (item_type, item_uuid) VALUES ('session', 'ghost-sess')").run()
    first.db.close()
    openDbs.length = 0

    vi.resetModules()
    const second = await loadInto(spoolDir)
    const rows = second.db.prepare('SELECT item_type, item_uuid FROM stars').all()
    expect(rows).toEqual([{ item_type: 'session', item_uuid: 'ghost-sess' }])
  })

  it('persists across a fresh getDB()', async () => {
    const spoolDir = makeTempDir('spool-stars-persist-')
    vi.stubEnv('SPOOL_DATA_DIR', spoolDir)

    const first = await loadInto(spoolDir)
    first.seedSession('persist-uuid', 'P', 'T')
    first.starItem(first.db, 'session', 'persist-uuid')
    first.db.close()
    openDbs.length = 0

    vi.resetModules()
    const second = await loadInto(spoolDir)
    expect(second.isStarred(second.db, 'session', 'persist-uuid')).toBe(true)
  })
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function load() {
  const spoolDir = makeTempDir('spool-stars-')
  vi.stubEnv('SPOOL_DATA_DIR', spoolDir)
  return loadInto(spoolDir)
}

async function loadInto(_spoolDir: string) {
  vi.resetModules()
  const dbModule = await import('./db.js')
  const queryModule = await import('./queries.js')
  const db = dbModule.getDB()
  openDbs.push(db)

  function seedSession(sessionUuid: string, projectDisplay: string, title: string): void {
    const sourceId = queryModule.getSourceId(db, 'claude')
    const projectId = queryModule.getOrCreateProject(
      db,
      sourceId,
      projectDisplay.toLowerCase().replace(/\s+/g, '-'),
      `/fake/${projectDisplay}`,
      projectDisplay,
    )
    queryModule.upsertSession(db, {
      projectId,
      sourceId,
      sessionUuid,
      filePath: `/fake/${sessionUuid}.jsonl`,
      title,
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T00:10:00Z',
      messageCount: 2,
      hasToolUse: false,
      cwd: '/fake',
      model: 'claude-opus-4-7',
      rawFileMtime: '2026-01-01T00:10:00Z',
    })
  }

  return {
    db,
    starItem: queryModule.starItem,
    unstarItem: queryModule.unstarItem,
    isStarred: queryModule.isStarred,
    listStarredItems: queryModule.listStarredItems,
    getStarredUuidsByType: queryModule.getStarredUuidsByType,
    seedSession,
  }
}
