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

describe('share_drafts schema (v11)', () => {
  it('creates the table with expected columns and indexes', async () => {
    const { db } = await load()

    const columns = db
      .prepare('PRAGMA table_info(share_drafts)')
      .all() as Array<{ name: string; type: string; notnull: number; pk: number }>

    const byName = new Map(columns.map((c) => [c.name, c]))
    expect(byName.get('draft_id')?.pk).toBe(1)
    expect(byName.get('source_kind')?.notnull).toBe(1)
    expect(byName.get('source_origin')?.notnull).toBe(0)
    expect(byName.get('title')?.notnull).toBe(1)
    expect(byName.get('snapshot_json')?.notnull).toBe(1)
    expect(byName.get('created_at')?.notnull).toBe(1)
    expect(byName.get('updated_at')?.notnull).toBe(1)

    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='share_drafts'`)
      .all() as Array<{ name: string }>
    const names = indexes.map((i) => i.name)
    expect(names).toContain('idx_share_drafts_updated_at')
    expect(names).toContain('idx_share_drafts_source_origin')
  })

  it('accepts inserts with each valid source_kind', async () => {
    const { db } = await load()
    const kinds = ['spool-session', 'pasted-url', 'imported-file', 'imported-jsonl']
    for (const k of kinds) {
      db.prepare(
        `INSERT INTO share_drafts (draft_id, source_kind, snapshot_json) VALUES (?, ?, ?)`,
      ).run(`d-${k}`, k, '{}')
    }
    const count = (
      db.prepare('SELECT COUNT(*) AS n FROM share_drafts').get() as { n: number }
    ).n
    expect(count).toBe(4)
  })

  it('rejects an unknown source_kind via CHECK constraint', async () => {
    const { db } = await load()
    expect(() =>
      db
        .prepare(`INSERT INTO share_drafts (draft_id, source_kind, snapshot_json) VALUES (?, ?, ?)`)
        .run('bad', 'not-a-kind', '{}'),
    ).toThrow(/CHECK constraint/)
  })

  it('defaults title to empty string and stamps timestamps', async () => {
    const { db } = await load()
    db.prepare(
      `INSERT INTO share_drafts (draft_id, source_kind, snapshot_json) VALUES (?, ?, ?)`,
    ).run('d1', 'spool-session', '{}')
    const row = db
      .prepare('SELECT title, created_at, updated_at FROM share_drafts WHERE draft_id=?')
      .get('d1') as { title: string; created_at: string; updated_at: string }
    expect(row.title).toBe('')
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('user_version reaches 11 after migration', async () => {
    const { db } = await load()
    const v = (db.pragma('user_version') as Array<{ user_version: number }>)[0]?.user_version
    expect(v).toBe(11)
  })

  it('migration is idempotent across re-open', async () => {
    const spoolDir = makeTempDir('spool-share-drafts-reopen-')
    vi.stubEnv('SPOOL_DATA_DIR', spoolDir)

    const first = await loadInto(spoolDir)
    first.db.prepare(
      `INSERT INTO share_drafts (draft_id, source_kind, title, snapshot_json) VALUES (?, ?, ?, ?)`,
    ).run('keep-me', 'pasted-url', 'persisted draft', '{"v":1}')
    first.db.close()
    openDbs.length = 0

    vi.resetModules()
    const second = await loadInto(spoolDir)
    const row = second.db
      .prepare('SELECT title FROM share_drafts WHERE draft_id=?')
      .get('keep-me') as { title: string }
    expect(row.title).toBe('persisted draft')
  })
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function load() {
  const spoolDir = makeTempDir('spool-share-drafts-')
  vi.stubEnv('SPOOL_DATA_DIR', spoolDir)
  return loadInto(spoolDir)
}

async function loadInto(_spoolDir: string) {
  vi.resetModules()
  const dbModule = await import('./db.js')
  const db = dbModule.getDB()
  openDbs.push(db)
  return { db }
}
