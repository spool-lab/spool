import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readlinkSync, lstatSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureSymlink, linkDevConnectors, pruneBrokenConnectorLinks } from './dev-connectors.js'

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
    // packages/connector-sdk
    mkdirSync(join(dir, 'packages', 'connector-sdk'), { recursive: true })
    writeFileSync(join(dir, 'packages', 'connector-sdk', 'package.json'), '{"name":"@spool-lab/connector-sdk"}')

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

  it('links all workspace connectors', () => {
    const workspace = tmp()
    const spoolDir = tmp()

    setupWorkspace(workspace, [
      { name: '@spool-lab/connector-twitter-bookmarks', id: 'twitter-bookmarks' },
      { name: '@spool-lab/connector-hackernews-hot', id: 'hackernews-hot' },
      { name: '@spool-lab/connector-typeless', id: 'typeless' },
    ])

    linkDevConnectors(spoolDir, workspace)

    const nm = join(spoolDir, 'connectors', 'node_modules', '@spool-lab')
    expect(lstatSync(join(nm, 'connector-twitter-bookmarks')).isSymbolicLink()).toBe(true)
    expect(lstatSync(join(nm, 'connector-hackernews-hot')).isSymbolicLink()).toBe(true)
    expect(lstatSync(join(nm, 'connector-typeless')).isSymbolicLink()).toBe(true)
  })

  it('symlinks connector-sdk for peer dep resolution', () => {
    const workspace = tmp()
    const spoolDir = tmp()

    setupWorkspace(workspace, [
      { name: '@spool-lab/connector-twitter-bookmarks', id: 'twitter-bookmarks' },
    ])

    linkDevConnectors(spoolDir, workspace)

    const sdkLink = join(spoolDir, 'connectors', 'node_modules', '@spool-lab', 'connector-sdk')
    expect(lstatSync(sdkLink).isSymbolicLink()).toBe(true)
    expect(readlinkSync(sdkLink)).toBe(join(workspace, 'packages', 'connector-sdk'))
  })

  it('no-ops when workspace has no connectors dir', () => {
    const workspace = tmp()
    const spoolDir = tmp()

    linkDevConnectors(spoolDir, workspace)

    expect(() => lstatSync(join(spoolDir, 'connectors'))).toThrow()
  })
})

// ── pruneBrokenConnectorLinks ────────────────────────────────────────────────

describe('pruneBrokenConnectorLinks', () => {
  function connectorsNm(spoolDir: string): string {
    const p = join(spoolDir, 'connectors', 'node_modules')
    mkdirSync(p, { recursive: true })
    return p
  }

  it('removes broken symlinks in scoped dirs', () => {
    const spoolDir = tmp()
    const nm = connectorsNm(spoolDir)
    mkdirSync(join(nm, '@spool-lab'))

    const brokenLink = join(nm, '@spool-lab', 'connector-x')
    symlinkSync('/nonexistent/path/does-not-exist', brokenLink)

    pruneBrokenConnectorLinks(spoolDir)

    expect(() => lstatSync(brokenLink)).toThrow()
  })

  it('preserves valid symlinks', () => {
    const spoolDir = tmp()
    const target = join(tmp(), 'real-target')
    mkdirSync(target)
    const nm = connectorsNm(spoolDir)
    mkdirSync(join(nm, '@spool-lab'))

    const goodLink = join(nm, '@spool-lab', 'connector-x')
    symlinkSync(target, goodLink)

    pruneBrokenConnectorLinks(spoolDir)

    expect(lstatSync(goodLink).isSymbolicLink()).toBe(true)
    expect(readlinkSync(goodLink)).toBe(target)
  })

  it('preserves regular (npm-installed) directories', () => {
    const spoolDir = tmp()
    const nm = connectorsNm(spoolDir)
    const installedDir = join(nm, '@graydawnc', 'connector-y')
    mkdirSync(installedDir, { recursive: true })
    writeFileSync(join(installedDir, 'package.json'), '{"name":"@graydawnc/connector-y"}')

    pruneBrokenConnectorLinks(spoolDir)

    expect(lstatSync(installedDir).isDirectory()).toBe(true)
  })

  it('handles broken unscoped symlinks at top level', () => {
    const spoolDir = tmp()
    const nm = connectorsNm(spoolDir)

    const brokenLink = join(nm, 'connector-z')
    symlinkSync('/nonexistent/target', brokenLink)

    pruneBrokenConnectorLinks(spoolDir)

    expect(() => lstatSync(brokenLink)).toThrow()
  })

  it('no-ops when node_modules does not exist', () => {
    const spoolDir = tmp()
    expect(() => pruneBrokenConnectorLinks(spoolDir)).not.toThrow()
  })
})
