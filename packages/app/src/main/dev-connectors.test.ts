import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readlinkSync, lstatSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readBundledList, ensureSymlink, linkDevConnectors } from './dev-connectors.js'

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dev-connectors-test-'))
}

const tempDirs: string[] = []
afterEach(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true })
  tempDirs.length = 0
})

function tmp(): string {
  const d = makeTempDir()
  tempDirs.push(d)
  return d
}

// ── readBundledList ──────────────────────────────────────────────────────────

describe('readBundledList', () => {
  it('parses single plugin', () => {
    const dir = tmp()
    const script = join(dir, 'build.sh')
    writeFileSync(script, `
FIRST_PARTY_PLUGINS=(
  "@spool-lab/connector-twitter-bookmarks"
)
`)
    expect(readBundledList(script)).toEqual(new Set(['@spool-lab/connector-twitter-bookmarks']))
  })

  it('parses multiple plugins', () => {
    const dir = tmp()
    const script = join(dir, 'build.sh')
    writeFileSync(script, `
FIRST_PARTY_PLUGINS=(
  "@spool-lab/connector-twitter-bookmarks"
  "@spool-lab/connector-hackernews-hot"
)
`)
    expect(readBundledList(script)).toEqual(new Set([
      '@spool-lab/connector-twitter-bookmarks',
      '@spool-lab/connector-hackernews-hot',
    ]))
  })

  it('returns empty set for missing file', () => {
    expect(readBundledList('/nonexistent/path')).toEqual(new Set())
  })

  it('returns empty set for script without FIRST_PARTY_PLUGINS', () => {
    const dir = tmp()
    const script = join(dir, 'build.sh')
    writeFileSync(script, 'echo hello')
    expect(readBundledList(script)).toEqual(new Set())
  })
})

// ── ensureSymlink ────────────────────────────────────────────────────────────

describe('ensureSymlink', () => {
  it('creates a symlink', () => {
    const dir = tmp()
    const target = join(dir, 'target')
    mkdirSync(target)
    const link = join(dir, 'link')

    ensureSymlink(target, link)

    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(target)
  })

  it('is idempotent when target matches', () => {
    const dir = tmp()
    const target = join(dir, 'target')
    mkdirSync(target)
    const link = join(dir, 'link')

    ensureSymlink(target, link)
    ensureSymlink(target, link)

    expect(readlinkSync(link)).toBe(target)
  })

  it('replaces symlink when target differs', () => {
    const dir = tmp()
    const oldTarget = join(dir, 'old')
    const newTarget = join(dir, 'new')
    mkdirSync(oldTarget)
    mkdirSync(newTarget)
    const link = join(dir, 'link')

    symlinkSync(oldTarget, link)
    ensureSymlink(newTarget, link)

    expect(readlinkSync(link)).toBe(newTarget)
  })

  it('replaces regular directory with symlink', () => {
    const dir = tmp()
    const target = join(dir, 'target')
    mkdirSync(target)
    const link = join(dir, 'link')
    mkdirSync(link)

    ensureSymlink(target, link)

    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(target)
  })
})

// ── linkDevConnectors ────────────────────────────────────────────────────────

describe('linkDevConnectors', () => {
  function setupWorkspace(dir: string, connectors: Array<{ name: string; id: string }>) {
    // scripts/build-bundled-connectors.sh
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    const pluginList = connectors
      .filter(c => c.name === '@spool-lab/connector-twitter-bookmarks')
      .map(c => `  "${c.name}"`)
      .join('\n')
    writeFileSync(join(dir, 'scripts', 'build-bundled-connectors.sh'), `
FIRST_PARTY_PLUGINS=(
${pluginList}
)
`)

    // packages/connector-sdk
    mkdirSync(join(dir, 'packages', 'connector-sdk'), { recursive: true })
    writeFileSync(join(dir, 'packages', 'connector-sdk', 'package.json'), '{"name":"@spool/connector-sdk"}')

    // packages/connectors/<name>
    for (const c of connectors) {
      const shortName = c.name.replace('@spool-lab/connector-', '')
      const connDir = join(dir, 'packages', 'connectors', shortName)
      mkdirSync(connDir, { recursive: true })
      writeFileSync(join(connDir, 'package.json'), JSON.stringify({
        name: c.name,
        spool: { type: 'connector', id: c.id },
      }))
    }
  }

  it('only links bundled connectors', () => {
    const workspace = tmp()
    const spoolDir = tmp()

    setupWorkspace(workspace, [
      { name: '@spool-lab/connector-twitter-bookmarks', id: 'twitter-bookmarks' },
      { name: '@spool-lab/connector-hackernews-hot', id: 'hackernews-hot' },
      { name: '@spool-lab/connector-typeless', id: 'typeless' },
    ])

    linkDevConnectors(spoolDir, workspace)

    const nm = join(spoolDir, 'connectors', 'node_modules', '@spool-lab')
    // twitter-bookmarks should be linked
    expect(lstatSync(join(nm, 'connector-twitter-bookmarks')).isSymbolicLink()).toBe(true)
    // others should NOT exist
    expect(() => lstatSync(join(nm, 'connector-hackernews-hot'))).toThrow()
    expect(() => lstatSync(join(nm, 'connector-typeless'))).toThrow()
  })

  it('symlinks connector-sdk for peer dep resolution', () => {
    const workspace = tmp()
    const spoolDir = tmp()

    setupWorkspace(workspace, [
      { name: '@spool-lab/connector-twitter-bookmarks', id: 'twitter-bookmarks' },
    ])

    linkDevConnectors(spoolDir, workspace)

    const sdkLink = join(spoolDir, 'connectors', 'node_modules', '@spool', 'connector-sdk')
    expect(lstatSync(sdkLink).isSymbolicLink()).toBe(true)
    expect(readlinkSync(sdkLink)).toBe(join(workspace, 'packages', 'connector-sdk'))
  })

  it('no-ops when workspace has no connectors dir', () => {
    const workspace = tmp()
    const spoolDir = tmp()

    // No packages/connectors dir
    linkDevConnectors(spoolDir, workspace)

    expect(() => lstatSync(join(spoolDir, 'connectors'))).toThrow()
  })
})
