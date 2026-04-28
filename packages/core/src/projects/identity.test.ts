import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { computeIdentity, normalizeGitRemote } from './identity.js'

const noFs = {
  exists: () => false,
  readText: () => null,
  spawn: () => ({ stdout: '', exitCode: 1 }),
}

describe('normalizeGitRemote', () => {
  it('strips .git and lowercases host', () => {
    expect(normalizeGitRemote('git@github.com:Foo/Bar.git'))
      .toBe('github.com/foo/bar')
    expect(normalizeGitRemote('https://GitHub.com/foo/bar'))
      .toBe('github.com/foo/bar')
    expect(normalizeGitRemote('https://user:pass@github.com/foo/bar.git'))
      .toBe('github.com/foo/bar')
  })
  it('returns null for unparseable input', () => {
    expect(normalizeGitRemote('')).toBeNull()
    expect(normalizeGitRemote('not-a-url')).toBeNull()
  })
})

describe('computeIdentity', () => {
  it('returns loose for null cwd', () => {
    const id = computeIdentity(null, noFs)
    expect(id.kind).toBe('loose')
    expect(id.key).toBe('loose')
  })

  it('returns loose for home dir', () => {
    const home = homedir()
    expect(computeIdentity(home, noFs).kind).toBe('loose')
    expect(computeIdentity(`${home}/Desktop`, noFs).kind).toBe('loose')
    expect(computeIdentity(`${home}/Downloads`, noFs).kind).toBe('loose')
    expect(computeIdentity('/tmp', noFs).kind).toBe('loose')
  })

  it('uses git remote when available', () => {
    const fs = {
      exists: (p: string) => p.endsWith('/.git'),
      readText: () => null,
      spawn: (cmd: string, args: string[]) => {
        if (args.includes('remote.origin.url'))
          return { stdout: 'git@github.com:spool-lab/spool.git\n', exitCode: 0 }
        if (args.includes('--git-common-dir'))
          return { stdout: '/Users/chen/Code/spool/.git\n', exitCode: 0 }
        return { stdout: '', exitCode: 1 }
      },
    }
    const id = computeIdentity('/Users/chen/Code/spool', fs)
    expect(id.kind).toBe('git_remote')
    expect(id.key).toBe('github.com/spool-lab/spool')
  })

  it('falls back to git common-dir when no remote', () => {
    const fs = {
      exists: (p: string) => p.endsWith('/.git'),
      readText: () => null,
      spawn: (cmd: string, args: string[]) => {
        if (args.includes('remote.origin.url'))
          return { stdout: '', exitCode: 1 }
        if (args.includes('--git-common-dir'))
          return { stdout: '/Users/chen/local-only/.git\n', exitCode: 0 }
        return { stdout: '', exitCode: 1 }
      },
    }
    const id = computeIdentity('/Users/chen/local-only', fs)
    expect(id.kind).toBe('git_common_dir')
    expect(id.key).toBe('/Users/chen/local-only/.git')
  })

  it('falls back to manifest dir when no git', () => {
    const fs = {
      exists: (p: string) => p === '/Users/chen/proj/package.json',
      readText: (p: string) =>
        p.endsWith('package.json') ? '{"name":"my-proj"}' : null,
      spawn: () => ({ stdout: '', exitCode: 1 }),
    }
    const id = computeIdentity('/Users/chen/proj/src', fs)
    expect(id.kind).toBe('manifest_path')
    expect(id.key).toBe('/Users/chen/proj')
    expect(id.displayName).toBe('my-proj')
  })

  it('uses bare path as last resort', () => {
    const fs = {
      exists: () => false,
      readText: () => null,
      spawn: () => ({ stdout: '', exitCode: 1 }),
    }
    const id = computeIdentity('/Users/chen/scratch/notes', fs)
    expect(id.kind).toBe('path')
    expect(id.key).toBe('/Users/chen/scratch/notes')
    expect(id.displayName).toBe('notes')
  })

  it('absolutizes a relative git_common_dir against gitRoot', () => {
    const fs = {
      exists: (p: string) => p.endsWith('/.git'),
      readText: () => null,
      spawn: (cmd: string, args: string[]) => {
        if (args.includes('remote.origin.url'))
          return { stdout: '', exitCode: 1 }
        if (args.includes('--git-common-dir'))
          return { stdout: '../shared.git\n', exitCode: 0 }   // relative
        return { stdout: '', exitCode: 1 }
      },
    }
    const id = computeIdentity('/Users/chen/Code/spool-wt', fs)
    expect(id.kind).toBe('git_common_dir')
    expect(id.key).toBe('/Users/chen/Code/shared.git')   // resolved up one level
  })
})
