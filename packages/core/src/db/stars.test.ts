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

describe('stars (unified)', () => {
  it('star + isStarred + unstar roundtrip for sessions', async () => {
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

  it('star + isStarred + unstar roundtrip for captures', async () => {
    const mod = await load()
    const { db, seedCapture } = mod
    const uuid = 'cap-1'
    seedCapture(uuid, 'https://x.com/1', 'Tweet', 'twitter')

    expect(mod.isStarred(db, 'capture', uuid)).toBe(false)
    mod.starItem(db, 'capture', uuid)
    expect(mod.isStarred(db, 'capture', uuid)).toBe(true)

    mod.unstarItem(db, 'capture', uuid)
    expect(mod.isStarred(db, 'capture', uuid)).toBe(false)
  })

  it('session and capture with same uuid string are independent', async () => {
    const mod = await load()
    const { db } = mod
    mod.starItem(db, 'session', 'same-uuid')
    expect(mod.isStarred(db, 'session', 'same-uuid')).toBe(true)
    expect(mod.isStarred(db, 'capture', 'same-uuid')).toBe(false)
    mod.starItem(db, 'capture', 'same-uuid')
    expect(mod.isStarred(db, 'capture', 'same-uuid')).toBe(true)
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

  it('CHECK constraint rejects unknown item_type', async () => {
    const mod = await load()
    const { db } = mod
    expect(() =>
      db.prepare('INSERT INTO stars (item_type, item_uuid) VALUES (?, ?)').run('bogus', 'x'),
    ).toThrow()
  })

  it('listStarredItems returns mixed sessions + captures by starred_at DESC', async () => {
    const mod = await load()
    const { db, seedSession, seedCapture } = mod
    seedSession('s1', 'P', 'Session one')
    seedCapture('c1', 'https://u/1', 'Cap one', 'twitter')
    seedSession('s2', 'P', 'Session two')

    // Explicit timestamps so order is deterministic.
    db.prepare("INSERT INTO stars (item_type, item_uuid, starred_at) VALUES ('session', 's1', '2026-01-01 00:00:00')").run()
    db.prepare("INSERT INTO stars (item_type, item_uuid, starred_at) VALUES ('capture', 'c1', '2026-02-01 00:00:00')").run()
    db.prepare("INSERT INTO stars (item_type, item_uuid, starred_at) VALUES ('session', 's2', '2026-03-01 00:00:00')").run()

    const items = mod.listStarredItems(db)
    expect(items.map(i => i.kind === 'session' ? i.session.sessionUuid : i.capture.captureUuid))
      .toEqual(['s2', 'c1', 's1'])
    expect(items[1]!.kind).toBe('capture')
  })

  it('listStarredItems filters orphans (starred referent missing)', async () => {
    const mod = await load()
    const { db, seedSession } = mod
    seedSession('alive', 'P', 'A')
    mod.starItem(db, 'session', 'alive')
    mod.starItem(db, 'session', 'ghost-session')
    mod.starItem(db, 'capture', 'ghost-capture')

    const items = mod.listStarredItems(db)
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('session')
    if (items[0]!.kind === 'session') {
      expect(items[0]!.session.sessionUuid).toBe('alive')
    }
  })

  it('getStarredUuidsByType splits session + capture uuids', async () => {
    const mod = await load()
    const { db } = mod
    mod.starItem(db, 'session', 's1')
    mod.starItem(db, 'session', 's2')
    mod.starItem(db, 'capture', 'c1')

    const { session, capture } = mod.getStarredUuidsByType(db)
    expect(new Set(session)).toEqual(new Set(['s1', 's2']))
    expect(new Set(capture)).toEqual(new Set(['c1']))
  })

  it('unstarItem on non-starred uuid is a no-op', async () => {
    const mod = await load()
    const { db } = mod
    expect(() => mod.unstarItem(db, 'session', 'nobody')).not.toThrow()
    expect(() => mod.unstarItem(db, 'capture', 'nobody')).not.toThrow()
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

  function seedCapture(captureUuid: string, url: string, title: string, platform: string): void {
    const connectorSource = db.prepare("SELECT id FROM sources WHERE name='connector'").get() as { id: number }
    db.prepare(`
      INSERT INTO captures
        (source_id, capture_uuid, url, title, content_text, author, platform, platform_id, content_type, thumbnail_url, metadata, captured_at, raw_json)
      VALUES (?, ?, ?, ?, '', NULL, ?, NULL, 'page', NULL, '{}', '2026-01-01T00:00:00Z', NULL)
    `).run(connectorSource.id, captureUuid, url, title, platform)
  }

  return {
    db,
    starItem: queryModule.starItem,
    unstarItem: queryModule.unstarItem,
    isStarred: queryModule.isStarred,
    listStarredItems: queryModule.listStarredItems,
    getStarredUuidsByType: queryModule.getStarredUuidsByType,
    seedSession,
    seedCapture,
  }
}
