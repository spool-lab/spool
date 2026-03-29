import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectSessionSource, getSessionRoots } from './source-paths.js'

const tempDirs: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('getSessionRoots', () => {
  test('should normalize configured profile roots to their session directories', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'spool-source-paths-'))
    tempDirs.push(baseDir)

    const workProfile = join(baseDir, 'work')
    const personalProjects = join(baseDir, 'personal', 'projects')
    mkdirSync(join(workProfile, 'projects'), { recursive: true })
    mkdirSync(personalProjects, { recursive: true })

    vi.stubEnv('SPOOL_CLAUDE_DIR', `${workProfile}\n${personalProjects}`)

    expect(getSessionRoots('claude')).toEqual([
      join(workProfile, 'projects'),
      personalProjects,
    ])
  })
})

describe('detectSessionSource', () => {
  test('should classify profile-backed Claude and Codex session files correctly', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'spool-source-detect-'))
    tempDirs.push(baseDir)

    const claudeRoot = join(baseDir, 'claude-work', 'projects')
    const codexRoot = join(baseDir, 'codex-personal', 'sessions')
    mkdirSync(join(claudeRoot, 'project-a'), { recursive: true })
    mkdirSync(join(codexRoot, '2026', '03', '29'), { recursive: true })

    const sourceRoots = {
      claude: [claudeRoot],
      codex: [codexRoot],
    } as const

    expect(detectSessionSource(join(claudeRoot, 'project-a', 'session.jsonl'), sourceRoots)).toBe('claude')
    expect(detectSessionSource(join(codexRoot, '2026', '03', '29', 'rollout.jsonl'), sourceRoots)).toBe('codex')
    expect(detectSessionSource(join(baseDir, 'other', 'session.jsonl'), sourceRoots)).toBeUndefined()
  })
})
