import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'

const tempDirs: string[] = []
const openDbs: Array<{ close: () => void }> = []

afterEach(() => {
  while (openDbs.length > 0) {
    openDbs.pop()?.close()
  }
  vi.unstubAllEnvs()
  vi.resetModules()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('Syncer', () => {
  it('keeps an existing Gemini session indexed when the session file becomes unreadable', async () => {
    const baseDir = makeTempDir('spool-syncer-gemini-')
    const geminiCliHome = join(baseDir, 'gemini-home')
    const chatsDir = join(geminiCliHome, '.gemini', 'tmp', 'workspace', 'chats')
    const historyDir = join(geminiCliHome, '.gemini', 'history', 'workspace')
    const spoolDataDir = join(baseDir, 'spool-data')
    mkdirSync(chatsDir, { recursive: true })
    mkdirSync(historyDir, { recursive: true })
    writeFileSync(join(historyDir, '.project_root'), '/tmp/gemini-project')

    vi.stubEnv('SPOOL_DATA_DIR', spoolDataDir)
    vi.stubEnv('GEMINI_CLI_HOME', geminiCliHome)

    const filePath = join(chatsDir, 'session-2026-04-08T00-00-deadbeef.json')
    writeFileSync(filePath, JSON.stringify({
      sessionId: 'deadbeef-1234-5678-90ab-cdef12345678',
      startTime: '2026-04-08T00:00:00Z',
      lastUpdated: '2026-04-08T00:01:00Z',
      kind: 'main',
      summary: 'Debug the OAuth callback bug',
      messages: [
        {
          id: 'u1',
          timestamp: '2026-04-08T00:00:00Z',
          type: 'user',
          content: [{ text: 'Help me debug the OAuth callback bug' }],
        },
        {
          id: 'a1',
          timestamp: '2026-04-08T00:00:30Z',
          type: 'gemini',
          content: 'I will inspect the auth flow and callback handlers.',
          model: 'gemini-2.5-pro',
        },
      ],
    }))

    const { getDB, Syncer, getStatus, searchFragments } = await loadCoreModules()
    const db = getDB()
    openDbs.push(db)
    const syncer = new Syncer(db)

    expect(syncer.syncFile(filePath, 'gemini')).toBe('added')
    expect(getStatus(db).totalSessions).toBe(1)

    writeFileSync(filePath, '{"sessionId":')
    touchFile(filePath)

    expect(syncer.syncFile(filePath, 'gemini')).toBe('error')
    expect(getStatus(db).totalSessions).toBe(1)
    expect(searchFragments(db, 'OAuth callback', { limit: 5 })).toHaveLength(1)
  })

  it('indexes long session text without truncating the tail of the transcript', async () => {
    const baseDir = makeTempDir('spool-syncer-claude-')
    const claudeDir = join(baseDir, 'claude', 'projects')
    const spoolDataDir = join(baseDir, 'spool-data')
    const sessionDir = join(claudeDir, 'test-project')
    mkdirSync(sessionDir, { recursive: true })

    vi.stubEnv('SPOOL_DATA_DIR', spoolDataDir)

    const tailKeyword = 'UNIQUE_NEEDLE_987654'
    const filePath = join(sessionDir, 'session.jsonl')
    writeFileSync(filePath, [
      JSON.stringify({
        type: 'user',
        sessionId: 'claude-session-1',
        cwd: '/tmp/test-project',
        uuid: 'u1',
        timestamp: '2026-04-08T00:00:00Z',
        message: {
          role: 'user',
          content: `${'a'.repeat(70000)} ${tailKeyword}`,
        },
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-04-08T00:00:05Z',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4',
          content: 'Acknowledged.',
        },
      }),
    ].join('\n'))

    const { getDB, Syncer, searchFragments } = await loadCoreModules()
    const db = getDB()
    openDbs.push(db)
    const syncer = new Syncer(db)

    expect(syncer.syncFile(filePath, 'claude')).toBe('added')

    const results = searchFragments(db, tailKeyword, { limit: 5 })
    expect(results).toHaveLength(1)
    expect(results[0]?.snippet).toContain(tailKeyword)
  })
})

async function loadCoreModules() {
  vi.resetModules()
  const dbModule = await import('../db/db.js')
  const syncerModule = await import('./syncer.js')
  const queryModule = await import('../db/queries.js')
  return {
    getDB: dbModule.getDB,
    Syncer: syncerModule.Syncer,
    getStatus: queryModule.getStatus,
    searchFragments: queryModule.searchFragments,
  }
}

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function touchFile(filePath: string): void {
  const nextTime = new Date(Date.now() + 1000)
  utimesSync(filePath, nextTime, nextTime)
}
