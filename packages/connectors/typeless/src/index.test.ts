import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ConnectorCapabilities, FetchContext, SqliteCapability, SqliteDatabase, SqliteStatement } from '@spool-lab/connector-sdk'
import TypelessConnector from './index.js'

// ── Mock capabilities ─────────────────────────────────────────────────────────

function makeMockSqlite(): SqliteCapability {
  return {
    openReadonly(path: string): SqliteDatabase {
      const db = new Database(path, { readonly: true, fileMustExist: true })
      return {
        prepare<T = unknown>(sql: string): SqliteStatement<T> {
          const stmt = db.prepare(sql)
          return {
            all: (...params) => stmt.all(...params) as T[],
            get: (...params) => stmt.get(...params) as T | undefined,
          }
        },
        close: () => { db.close() },
      }
    },
  }
}

const noop = () => {}
const mockCaps: ConnectorCapabilities = {
  fetch: (() => { throw new Error('fetch not available') }) as any,
  cookies: { get: async () => [] },
  sqlite: makeMockSqlite(),
  log: {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    span: async <T>(_name: string, fn: () => Promise<T>) => fn(),
  },
}

function makeCtx(cursor: string | null = null): FetchContext {
  return { cursor, sinceItemId: null, phase: 'backfill' }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDb(): { dbPath: string; db: Database.Database; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'spool-typeless-test-'))
  const dbPath = join(dir, 'typeless.db')
  const db = new Database(dbPath)

  db.exec(`
    CREATE TABLE history (
      id TEXT PRIMARY KEY NOT NULL,
      refined_text TEXT,
      edited_text TEXT,
      status TEXT NOT NULL DEFAULT 'transcript',
      mode TEXT DEFAULT 'voice_transcript',
      duration REAL,
      detected_language TEXT,
      audio_local_path TEXT,
      focused_app_name TEXT,
      focused_app_bundle_id TEXT,
      focused_app_window_title TEXT,
      focused_app_window_web_url TEXT,
      focused_app_window_web_domain TEXT,
      focused_app_window_web_title TEXT,
      created_at TEXT NOT NULL
    )
  `)

  return {
    dbPath,
    db,
    cleanup: () => {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

const insertRow = (
  db: Database.Database,
  overrides: Partial<{
    id: string
    refined_text: string | null
    edited_text: string | null
    status: string
    mode: string
    duration: number
    detected_language: string
    audio_local_path: string | null
    focused_app_name: string
    focused_app_bundle_id: string
    focused_app_window_title: string
    focused_app_window_web_url: string | null
    focused_app_window_web_domain: string | null
    focused_app_window_web_title: string | null
    created_at: string
  }> = {},
) => {
  const row = {
    id: 'test-id-1',
    refined_text: 'Hello world',
    edited_text: null,
    status: 'transcript',
    mode: 'voice_transcript',
    duration: 2.5,
    detected_language: 'en',
    audio_local_path: '/tmp/test.ogg',
    focused_app_name: 'iTerm2',
    focused_app_bundle_id: 'com.googlecode.iterm2',
    focused_app_window_title: 'spool dev',
    focused_app_window_web_url: null,
    focused_app_window_web_domain: null,
    focused_app_window_web_title: null,
    created_at: '2026-01-01T10:00:00.000Z',
    ...overrides,
  }
  db.prepare(`
    INSERT INTO history (
      id, refined_text, edited_text, status, mode, duration, detected_language,
      audio_local_path, focused_app_name, focused_app_bundle_id, focused_app_window_title,
      focused_app_window_web_url, focused_app_window_web_domain, focused_app_window_web_title,
      created_at
    ) VALUES (
      @id, @refined_text, @edited_text, @status, @mode, @duration, @detected_language,
      @audio_local_path, @focused_app_name, @focused_app_bundle_id, @focused_app_window_title,
      @focused_app_window_web_url, @focused_app_window_web_domain, @focused_app_window_web_title,
      @created_at
    )
  `).run(row)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TypelessConnector.checkAuth', () => {
  it('returns ok:true when db exists and is readable', async () => {
    const { dbPath, cleanup } = makeTmpDb()
    try {
      const connector = new TypelessConnector(mockCaps, { dbPath })
      const result = await connector.checkAuth()
      expect(result.ok).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('returns ok:false with a hint when db is missing', async () => {
    const connector = new TypelessConnector(mockCaps, { dbPath: '/nonexistent/path/typeless.db' })
    const result = await connector.checkAuth()
    expect(result.ok).toBe(false)
    expect(result.hint).toContain('typeless.com')
  })
})

describe('TypelessConnector.fetchPage', () => {
  let dbPath: string
  let db: Database.Database
  let cleanup: () => void

  beforeEach(() => {
    const tmp = makeTmpDb()
    dbPath = tmp.dbPath
    db = tmp.db
    cleanup = tmp.cleanup
  })

  afterEach(() => {
    cleanup()
  })

  it('returns empty page when no transcripts exist', async () => {
    const connector = new TypelessConnector(mockCaps, { dbPath })
    const result = await connector.fetchPage(makeCtx())
    expect(result.items).toHaveLength(0)
    expect(result.nextCursor).toBeNull()
  })

  it('returns a CapturedItem with correct shape', async () => {
    insertRow(db, {
      id: 'abc-123',
      refined_text: 'Let me check the build status',
      focused_app_name: 'iTerm2',
      focused_app_window_title: 'spool dev',
    })

    const connector = new TypelessConnector(mockCaps, { dbPath })
    const { items } = await connector.fetchPage(makeCtx())

    expect(items).toHaveLength(1)
    const item = items[0]!

    expect(item.platformId).toBe('abc-123')
    expect(item.platform).toBe('typeless')
    expect(item.contentType).toBe('voice_transcript')
    expect(item.author).toBeNull()
    expect(item.url).toBe('file:///tmp/test.ogg')
    expect(item.capturedAt).toBe('2026-01-01T10:00:00.000Z')
  })

  it('uses edited_text over refined_text when both are present', async () => {
    insertRow(db, {
      refined_text: 'AI polished version',
      edited_text: 'User corrected version',
    })
    const connector = new TypelessConnector(mockCaps, { dbPath })
    const { items } = await connector.fetchPage(makeCtx())
    expect(items[0]!.contentText).toContain('User corrected version')
    expect(items[0]!.contentText).not.toContain('AI polished version')
  })

  it('includes context in contentText', async () => {
    insertRow(db, {
      refined_text: 'Ship it',
      focused_app_name: 'Chrome',
      focused_app_window_web_domain: 'remotion.dev',
      focused_app_window_title: 'Remotion docs',
    })
    const connector = new TypelessConnector(mockCaps, { dbPath })
    const { items } = await connector.fetchPage(makeCtx())
    const text = items[0]!.contentText
    expect(text).toContain('Ship it')
    expect(text).toContain('Chrome')
    expect(text).toContain('remotion.dev')
  })

  it('truncates title at 80 characters', async () => {
    const long = 'a'.repeat(100)
    insertRow(db, { refined_text: long })
    const connector = new TypelessConnector(mockCaps, { dbPath })
    const { items } = await connector.fetchPage(makeCtx())
    expect(items[0]!.title.length).toBeLessThanOrEqual(82)
    expect(items[0]!.title).toContain('…')
  })

  it('falls back to typeless:// URL when audio_local_path is null', async () => {
    insertRow(db, { id: 'no-audio', audio_local_path: null })
    const connector = new TypelessConnector(mockCaps, { dbPath })
    const { items } = await connector.fetchPage(makeCtx())
    expect(items[0]!.url).toBe('typeless://transcript/no-audio')
  })

  it('filters out dismissed and error rows', async () => {
    insertRow(db, { id: 'dismissed-1', status: 'dismissed', refined_text: 'bye' })
    insertRow(db, { id: 'error-1', status: 'error', refined_text: 'oops' })
    insertRow(db, { id: 'good-1', status: 'transcript', refined_text: 'hello' })

    const connector = new TypelessConnector(mockCaps, { dbPath })
    const { items } = await connector.fetchPage(makeCtx())
    expect(items).toHaveLength(1)
    expect(items[0]!.platformId).toBe('good-1')
  })

  it('filters out rows with empty refined_text', async () => {
    insertRow(db, { id: 'empty-1', refined_text: '' })
    insertRow(db, { id: 'null-1', refined_text: null })
    insertRow(db, { id: 'real-1', refined_text: 'real content' })

    const connector = new TypelessConnector(mockCaps, { dbPath })
    const { items } = await connector.fetchPage(makeCtx())
    expect(items).toHaveLength(1)
    expect(items[0]!.platformId).toBe('real-1')
  })

  it('paginates using cursor (created_at)', async () => {
    insertRow(db, { id: 'row-c', created_at: '2026-01-03T00:00:00.000Z', refined_text: 'third' })
    insertRow(db, { id: 'row-b', created_at: '2026-01-02T00:00:00.000Z', refined_text: 'second' })
    insertRow(db, { id: 'row-a', created_at: '2026-01-01T00:00:00.000Z', refined_text: 'first' })

    const connector = new TypelessConnector(mockCaps, { dbPath })

    const page2 = await connector.fetchPage(makeCtx('2026-01-02T00:00:00.000Z'))
    expect(page2.items).toHaveLength(1)
    expect(page2.items[0]!.platformId).toBe('row-a')
    expect(page2.nextCursor).toBeNull()
  })

  it('returns nextCursor when a full page is returned', async () => {
    for (let i = 0; i < 26; i++) {
      const ts = new Date(2026, 0, i + 1).toISOString()
      insertRow(db, {
        id: `row-${i}`,
        refined_text: `transcript ${i}`,
        created_at: ts,
      })
    }

    const connector = new TypelessConnector(mockCaps, { dbPath })
    const { items, nextCursor } = await connector.fetchPage(makeCtx())
    expect(items).toHaveLength(25)
    expect(nextCursor).not.toBeNull()
    expect(nextCursor).toBe(items[24]!.capturedAt)
  })

  it('stores context fields in metadata', async () => {
    insertRow(db, {
      focused_app_name: 'Notion',
      focused_app_window_web_url: 'https://notion.so/my-page',
      focused_app_window_web_domain: 'notion.so',
      duration: 5.2,
      detected_language: 'zh',
    })
    const connector = new TypelessConnector(mockCaps, { dbPath })
    const { items } = await connector.fetchPage(makeCtx())
    const meta = items[0]!.metadata
    expect(meta['focused_app']).toBe('Notion')
    expect(meta['focused_app_window_web_url']).toBe('https://notion.so/my-page')
    expect(meta['duration']).toBe(5.2)
    expect(meta['detected_language']).toBe('zh')
  })
})
