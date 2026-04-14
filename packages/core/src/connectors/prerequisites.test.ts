import { describe, it, expect, vi } from 'vitest'
import { PrerequisiteChecker } from './prerequisites.js'
import { validatePrerequisites } from './loader.js'
import type { Prerequisite } from '@spool/connector-sdk'
import type { ConnectorPackage } from './types.js'

function mkPkg(id: string, prerequisites: Prerequisite[]): ConnectorPackage {
  return {
    id,
    packageName: id,
    rootDir: '/fake',
    connectors: [],
    prerequisites,
  } as unknown as ConnectorPackage
}

describe('PrerequisiteChecker', () => {
  it('marks exec-detect as ok when command succeeds', async () => {
    const exec = { run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'v1.0.0\n', stderr: '' }) }
    const checker = new PrerequisiteChecker(exec as any)
    const pkg = mkPkg('p1', [
      {
        id: 'tool',
        name: 'Tool',
        kind: 'cli',
        detect: { type: 'exec', command: 'tool', args: ['--version'] },
        install: { kind: 'cli', command: { darwin: 'brew install tool' } },
      },
    ])
    const steps = await checker.check(pkg)
    expect(steps).toHaveLength(1)
    expect(steps[0].status).toBe('ok')
  })

  it('marks missing when exec throws ENOENT', async () => {
    const exec = { run: vi.fn().mockRejectedValue(new Error('ENOENT')) }
    const checker = new PrerequisiteChecker(exec as any)
    const pkg = mkPkg('p1', [
      {
        id: 'tool',
        name: 'Tool',
        kind: 'cli',
        detect: { type: 'exec', command: 'missing', args: [] },
        install: { kind: 'cli', command: { darwin: 'brew install tool' } },
      },
    ])
    const steps = await checker.check(pkg)
    expect(steps[0].status).toBe('missing')
  })

  it('marks outdated when version is below minVersion', async () => {
    const exec = { run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'v0.2.1\n', stderr: '' }) }
    const checker = new PrerequisiteChecker(exec as any)
    const pkg = mkPkg('p1', [
      {
        id: 'tool',
        name: 'Tool',
        kind: 'cli',
        detect: { type: 'exec', command: 'tool', args: ['--version'], versionRegex: 'v?(\\d+\\.\\d+\\.\\d+)' },
        minVersion: '0.3.0',
        install: { kind: 'cli', command: { darwin: 'brew install tool' } },
      },
    ])
    const steps = await checker.check(pkg)
    expect(steps[0].status).toBe('outdated')
    expect(steps[0].detectedVersion).toBe('0.2.1')
    expect(steps[0].minVersion).toBe('0.3.0')
  })

  it('marks pending when upstream requires is not ok', async () => {
    const exec = { run: vi.fn().mockRejectedValue(new Error('ENOENT')) }
    const checker = new PrerequisiteChecker(exec as any)
    const pkg = mkPkg('p1', [
      {
        id: 'upstream',
        name: 'Upstream',
        kind: 'cli',
        detect: { type: 'exec', command: 'upstream', args: [] },
        install: { kind: 'cli', command: { darwin: 'install upstream' } },
      },
      {
        id: 'downstream',
        name: 'Downstream',
        kind: 'browser-extension',
        requires: ['upstream'],
        detect: { type: 'exec', command: 'check', args: [] },
        install: { kind: 'browser-extension', manual: { downloadUrl: 'https://x', steps: ['a'] } },
      },
    ])
    const steps = await checker.check(pkg)
    expect(steps[0].status).toBe('missing')
    expect(steps[1].status).toBe('pending')
    expect(exec.run).toHaveBeenCalledTimes(1)
  })

  it('uses matchStdout over version when both present', async () => {
    const exec = { run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '[OK] Extension connected v0.1.0', stderr: '' }) }
    const checker = new PrerequisiteChecker(exec as any)
    const pkg = mkPkg('p1', [
      {
        id: 'ext',
        name: 'Ext',
        kind: 'browser-extension',
        detect: {
          type: 'exec',
          command: 'tool',
          args: ['doctor'],
          matchStdout: '\\[OK\\].*Extension',
          versionRegex: 'v?(\\d+\\.\\d+\\.\\d+)',
        },
        minVersion: '99.0.0',
        install: { kind: 'browser-extension', manual: { downloadUrl: 'https://x', steps: ['a'] } },
      },
    ])
    const steps = await checker.check(pkg)
    expect(steps[0].status).toBe('ok')
  })

  it('marks error when detected version is not parseable as semver', async () => {
    const exec = { run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'garbage-version', stderr: '' }) }
    const checker = new PrerequisiteChecker(exec as any)
    const pkg = mkPkg('p1', [
      {
        id: 'tool',
        name: 'Tool',
        kind: 'cli',
        detect: { type: 'exec', command: 'tool', args: ['--version'], versionRegex: '(.+)' },
        minVersion: '0.3.0',
        install: { kind: 'cli', command: { darwin: 'install' } },
      },
    ])
    const steps = await checker.check(pkg)
    expect(steps[0].status).toBe('error')
    expect(steps[0].hint).toMatch(/parse/i)
  })

  it('dedupes concurrent check calls for the same package', async () => {
    const exec = {
      run: vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ exitCode: 0, stdout: 'v1.0.0', stderr: '' }), 10))),
    }
    const checker = new PrerequisiteChecker(exec as any)
    const pkg = mkPkg('p1', [
      {
        id: 'tool',
        name: 'Tool',
        kind: 'cli',
        detect: { type: 'exec', command: 'tool', args: ['--version'] },
        install: { kind: 'cli', command: { darwin: 'install' } },
      },
    ])
    await Promise.all([checker.check(pkg), checker.check(pkg), checker.check(pkg)])
    expect(exec.run).toHaveBeenCalledTimes(1)
  })
})

describe('validatePrerequisites', () => {
  it('rejects install.kind mismatch', () => {
    expect(() => validatePrerequisites(
      [{ id: 'a', name: 'A', kind: 'cli', detect: { type: 'exec', command: 'a', args: [] }, install: { kind: 'browser-extension' } }],
      'p',
    )).toThrow(/must match kind/)
  })

  it('rejects browser-extension without webstoreUrl or manual', () => {
    expect(() => validatePrerequisites(
      [{ id: 'a', name: 'A', kind: 'browser-extension', detect: { type: 'exec', command: 'a', args: [] }, install: { kind: 'browser-extension' } }],
      'p',
    )).toThrow(/webstoreUrl or manual/)
  })

  it('rejects forward-referencing requires', () => {
    expect(() => validatePrerequisites(
      [
        { id: 'a', name: 'A', kind: 'cli', requires: ['b'], detect: { type: 'exec', command: 'a', args: [] }, install: { kind: 'cli', command: {} } },
        { id: 'b', name: 'B', kind: 'cli', detect: { type: 'exec', command: 'b', args: [] }, install: { kind: 'cli', command: {} } },
      ],
      'p',
    )).toThrow(/must appear earlier/)
  })

  it('accepts valid prerequisites', () => {
    const r = validatePrerequisites(
      [
        { id: 'a', name: 'A', kind: 'cli', detect: { type: 'exec', command: 'a', args: [] }, install: { kind: 'cli', command: {} } },
        { id: 'b', name: 'B', kind: 'browser-extension', requires: ['a'], detect: { type: 'exec', command: 'b', args: [] }, install: { kind: 'browser-extension', webstoreUrl: 'https://x' } },
      ],
      'p',
    )
    expect(r).toHaveLength(2)
  })
})
