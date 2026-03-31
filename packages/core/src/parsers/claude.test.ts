import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseClaudeSession } from './claude.js'

function writeTmpSession(lines: Record<string, unknown>[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'spool-test-'))
  const fp = join(dir, 'session.jsonl')
  writeFileSync(fp, lines.map(l => JSON.stringify(l)).join('\n'))
  return fp
}

const baseRecord = (overrides: Record<string, unknown>) => ({
  sessionId: 'test-uuid',
  cwd: '/tmp',
  timestamp: '2026-01-01T00:00:00Z',
  ...overrides,
})

describe('parseClaudeSession', () => {
  it('uses first user message as title by default', () => {
    const fp = writeTmpSession([
      baseRecord({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'Help me fix the login bug' } }),
      baseRecord({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: 'Sure', model: 'claude-opus-4-6' } }),
    ])
    const result = parseClaudeSession(fp)
    expect(result?.title).toBe('Help me fix the login bug')
  })

  it('uses custom-title when present', () => {
    const fp = writeTmpSession([
      baseRecord({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'Help me fix the login bug' } }),
      baseRecord({ type: 'custom-title', customTitle: 'login-bugfix' }),
      baseRecord({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: 'Sure', model: 'claude-opus-4-6' } }),
    ])
    const result = parseClaudeSession(fp)
    expect(result?.title).toBe('login-bugfix')
  })

  it('uses last custom-title when renamed multiple times', () => {
    const fp = writeTmpSession([
      baseRecord({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'Help me' } }),
      baseRecord({ type: 'custom-title', customTitle: 'first-name' }),
      baseRecord({ type: 'custom-title', customTitle: 'final-name' }),
      baseRecord({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: 'Ok', model: 'claude-opus-4-6' } }),
    ])
    const result = parseClaudeSession(fp)
    expect(result?.title).toBe('final-name')
  })
})
