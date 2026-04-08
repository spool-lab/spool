import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseGeminiSession } from './gemini.js'

const tempDirs: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeGeminiHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spool-gemini-parser-'))
  tempDirs.push(dir)
  return dir
}

describe('parseGeminiSession', () => {
  it('parses Gemini chat sessions and resolves the project root from ownership markers', () => {
    const geminiCliHome = makeGeminiHome()
    const geminiHome = join(geminiCliHome, '.gemini')
    const projectRoot = '/tmp/gemini-project'
    const shortId = 'workspace'
    const chatsDir = join(geminiHome, 'tmp', shortId, 'chats')
    const historyDir = join(geminiHome, 'history', shortId)
    mkdirSync(chatsDir, { recursive: true })
    mkdirSync(historyDir, { recursive: true })
    writeFileSync(join(historyDir, '.project_root'), projectRoot)

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
          toolCalls: [{ name: 'read_file', displayName: 'ReadFile' }],
        },
      ],
    }))

    const parsed = parseGeminiSession(filePath)
    expect(parsed?.source).toBe('gemini')
    expect(parsed?.title).toBe('Debug the OAuth callback bug')
    expect(parsed?.cwd).toBe(projectRoot)
    expect(parsed?.model).toBe('gemini-2.5-pro')
    expect(parsed?.messages).toHaveLength(2)
    expect(parsed?.messages[1]?.toolNames).toEqual(['ReadFile'])
  })

  it('filters subagent sessions from indexing', () => {
    const geminiCliHome = makeGeminiHome()
    const geminiHome = join(geminiCliHome, '.gemini')
    const chatsDir = join(geminiHome, 'tmp', 'workspace', 'chats')
    mkdirSync(chatsDir, { recursive: true })
    vi.stubEnv('GEMINI_CLI_HOME', geminiCliHome)

    const filePath = join(chatsDir, 'session-2026-04-08T00-00-subagent.json')
    writeFileSync(filePath, JSON.stringify({
      sessionId: 'subagent-session',
      kind: 'subagent',
      messages: [
        {
          id: 'a1',
          timestamp: '2026-04-08T00:00:00Z',
          type: 'gemini',
          content: 'Internal helper session',
        },
      ],
    }))

    expect(parseGeminiSession(filePath)).toBeNull()
  })
})
