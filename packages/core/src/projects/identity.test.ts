import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { computeIdentity, normalizeGitRemote } from './identity.js'
import type { WorktreeUpstreamResolver } from './worktree-resolvers.js'

const noFs = {
  exists: () => false,
  readText: () => null,
  spawn: () => ({ stdout: '', exitCode: 1 }),
}

// Empty resolver chain so unit tests don't reach into a dev machine's real
// ~/.superset/local.db. Tests for resolver behavior pass an explicit chain.
const noResolvers: WorktreeUpstreamResolver[] = []

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
    const id = computeIdentity(null, noFs, noResolvers)
    expect(id.kind).toBe('loose')
    expect(id.key).toBe('loose')
  })

  it('returns loose for home dir', () => {
    const home = homedir()
    expect(computeIdentity(home, noFs, noResolvers).kind).toBe('loose')
    expect(computeIdentity(`${home}/Desktop`, noFs, noResolvers).kind).toBe('loose')
    expect(computeIdentity(`${home}/Downloads`, noFs, noResolvers).kind).toBe('loose')
    expect(computeIdentity('/tmp', noFs, noResolvers).kind).toBe('loose')
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
    const id = computeIdentity('/Users/chen/Code/spool', fs, noResolvers)
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
    const id = computeIdentity('/Users/chen/local-only', fs, noResolvers)
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
    const id = computeIdentity('/Users/chen/proj/src', fs, noResolvers)
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
    const id = computeIdentity('/Users/chen/scratch/notes', fs, noResolvers)
    expect(id.kind).toBe('path')
    expect(id.key).toBe('/Users/chen/scratch/notes')
    expect(id.displayName).toBe('notes')
  })

  it('uses worktree resolver to recover identity when cwd is dead', () => {
    // Simulates: worktree at /wt/proj/branch was deleted before sync. The
    // resolver knows the upstream main repo lives at /repos/proj. Recursing
    // into computeIdentity on that path finds .git + remote and returns
    // git_remote — same identity as a session in the live main repo.
    const fs = {
      exists: (p: string) => p === '/repos/proj' || p === '/repos/proj/.git',
      readText: () => null,
      spawn: (_cmd: string, args: string[], opts: { cwd: string }) => {
        if (opts.cwd === '/repos/proj' && args.includes('remote.origin.url')) {
          return { stdout: 'git@github.com:foo/proj.git\n', exitCode: 0 }
        }
        return { stdout: '', exitCode: 1 }
      },
    }
    const resolver: WorktreeUpstreamResolver = {
      name: 'fake',
      resolve: (cwd) => cwd === '/wt/proj/branch' ? '/repos/proj' : null,
    }
    const id = computeIdentity('/wt/proj/branch', fs, [resolver])
    expect(id.kind).toBe('git_remote')
    expect(id.key).toBe('github.com/foo/proj')
  })

  it('falls through to path when resolver returns null', () => {
    const resolver: WorktreeUpstreamResolver = { name: 'fake', resolve: () => null }
    const id = computeIdentity('/wt/proj/branch', noFs, [resolver])
    expect(id.kind).toBe('path')
    expect(id.key).toBe('/wt/proj/branch')
  })

  it('falls through to path when resolver returns a non-existent upstream', () => {
    const resolver: WorktreeUpstreamResolver = {
      name: 'fake',
      resolve: () => '/repos/missing',
    }
    const id = computeIdentity('/wt/proj/branch', noFs, [resolver])
    expect(id.kind).toBe('path')
  })

  it('does not invoke resolvers when cwd is alive', () => {
    // cwd has .git → git_remote returns immediately; resolver must not run
    // (would otherwise risk overriding a healthy local probe).
    const fs = {
      exists: (p: string) => p.endsWith('/.git') || p === '/Users/me/repo',
      readText: () => null,
      spawn: (_cmd: string, args: string[]) => {
        if (args.includes('remote.origin.url'))
          return { stdout: 'https://github.com/foo/repo\n', exitCode: 0 }
        return { stdout: '', exitCode: 1 }
      },
    }
    let resolverCalled = false
    const resolver: WorktreeUpstreamResolver = {
      name: 'fake',
      resolve: () => { resolverCalled = true; return '/elsewhere' },
    }
    const id = computeIdentity('/Users/me/repo', fs, [resolver])
    expect(id.kind).toBe('git_remote')
    expect(resolverCalled).toBe(false)
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
    const id = computeIdentity('/Users/chen/Code/spool-wt', fs, noResolvers)
    expect(id.kind).toBe('git_common_dir')
    expect(id.key).toBe('/Users/chen/Code/shared.git')   // resolved up one level
  })
})
