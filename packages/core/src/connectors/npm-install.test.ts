import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, existsSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as tar from 'tar'
import { registryUrl, checkForUpdates, downloadAndInstall } from './npm-install.js'

describe('registryUrl', () => {
  it('builds correct URL for scoped package', () => {
    expect(registryUrl('@spool-lab/connector-hackernews-hot'))
      .toBe('https://registry.npmjs.org/@spool-lab%2Fconnector-hackernews-hot/latest')
  })

  it('builds correct URL for unscoped package', () => {
    expect(registryUrl('connector-foo'))
      .toBe('https://registry.npmjs.org/connector-foo/latest')
  })
})

function mockNpmResponse(name: string, version: string): Response {
  return new Response(JSON.stringify({
    name,
    version,
    dist: { tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz` },
    spool: { type: 'connector' },
  }))
}

describe('checkForUpdates', () => {
  it('returns update when npm has a newer version', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockNpmResponse('@spool-lab/hn', '0.2.0'))
    const result = await checkForUpdates(
      [{ packageName: '@spool-lab/hn', currentVersion: '0.1.0' }],
      fetchFn as unknown as typeof fetch,
    )
    expect(result.size).toBe(1)
    expect(result.get('@spool-lab/hn')).toEqual({ current: '0.1.0', latest: '0.2.0' })
  })

  it('returns empty when versions are equal', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockNpmResponse('@spool-lab/hn', '0.1.0'))
    const result = await checkForUpdates(
      [{ packageName: '@spool-lab/hn', currentVersion: '0.1.0' }],
      fetchFn as unknown as typeof fetch,
    )
    expect(result.size).toBe(0)
  })

  it('returns empty when installed version is newer', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockNpmResponse('@spool-lab/hn', '0.1.0'))
    const result = await checkForUpdates(
      [{ packageName: '@spool-lab/hn', currentVersion: '0.2.0' }],
      fetchFn as unknown as typeof fetch,
    )
    expect(result.size).toBe(0)
  })

  it('silently skips connectors that fail to fetch', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(mockNpmResponse('@spool-lab/hn', '0.2.0'))
      .mockRejectedValueOnce(new Error('network error'))
    const result = await checkForUpdates(
      [
        { packageName: '@spool-lab/hn', currentVersion: '0.1.0' },
        { packageName: '@spool-lab/broken', currentVersion: '0.1.0' },
      ],
      fetchFn as unknown as typeof fetch,
    )
    expect(result.size).toBe(1)
    expect(result.has('@spool-lab/hn')).toBe(true)
    expect(result.has('@spool-lab/broken')).toBe(false)
  })

  it('checks multiple connectors in parallel', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(mockNpmResponse('@spool-lab/a', '0.3.0'))
      .mockResolvedValueOnce(mockNpmResponse('@spool-lab/b', '0.1.0'))
    const result = await checkForUpdates(
      [
        { packageName: '@spool-lab/a', currentVersion: '0.1.0' },
        { packageName: '@spool-lab/b', currentVersion: '0.1.0' },
      ],
      fetchFn as unknown as typeof fetch,
    )
    expect(result.size).toBe(1)
    expect(result.get('@spool-lab/a')).toEqual({ current: '0.1.0', latest: '0.3.0' })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})

describe('downloadAndInstall', () => {
  const tempDirs: string[] = []
  afterEach(() => {
    for (const d of tempDirs) rmSync(d, { recursive: true, force: true })
    tempDirs.length = 0
  })
  function tmp(): string {
    const d = mkdtempSync(join(tmpdir(), 'npm-install-test-'))
    tempDirs.push(d)
    return d
  }

  async function buildTarball(sourceDir: string, outPath: string): Promise<void> {
    // npm packs with contents under a top-level "package/" dir that tar.extract strips.
    const stage = mkdtempSync(join(tmpdir(), 'npm-pack-stage-'))
    tempDirs.push(stage)
    const pkgDir = join(stage, 'package')
    mkdirSync(pkgDir)
    for (const name of ['package.json', 'index.js']) {
      const src = join(sourceDir, name)
      if (existsSync(src)) writeFileSync(join(pkgDir, name), readFileSync(src))
    }
    await tar.create({ gzip: true, file: outPath, cwd: stage }, ['package'])
  }

  function mockFetch(registryJson: object, tarballBytes: Buffer): typeof fetch {
    return vi.fn(async (url: string) => {
      if (String(url).endsWith('.tgz')) {
        return new Response(tarballBytes, { status: 200 })
      }
      return new Response(JSON.stringify(registryJson), { status: 200 })
    }) as unknown as typeof fetch
  }

  it('replaces a broken symlink at installPath', async () => {
    const src = tmp()
    writeFileSync(join(src, 'package.json'), JSON.stringify({
      name: '@spool-lab/connector-foo',
      version: '0.1.0',
      spool: { type: 'connector' },
    }))
    writeFileSync(join(src, 'index.js'), 'module.exports = {}\n')
    const tarballPath = join(tmp(), 'pkg.tgz')
    await buildTarball(src, tarballPath)

    const connectorsDir = tmp()
    const scopeDir = join(connectorsDir, 'node_modules', '@spool-lab')
    mkdirSync(scopeDir, { recursive: true })
    const installPath = join(scopeDir, 'connector-foo')
    // Simulate a broken dev symlink left over from a removed worktree.
    symlinkSync('/nonexistent/worktree/packages/connectors/foo', installPath)

    const fetchFn = mockFetch({
      name: '@spool-lab/connector-foo',
      version: '0.1.0',
      dist: { tarball: 'https://registry.npmjs.org/@spool-lab/connector-foo/-/connector-foo-0.1.0.tgz' },
      spool: { type: 'connector' },
    }, readFileSync(tarballPath))

    const result = await downloadAndInstall('@spool-lab/connector-foo', connectorsDir, fetchFn)

    expect(result.name).toBe('@spool-lab/connector-foo')
    expect(result.version).toBe('0.1.0')
    expect(lstatSync(installPath).isDirectory()).toBe(true)
    expect(existsSync(join(installPath, 'package.json'))).toBe(true)
    expect(existsSync(join(installPath, 'index.js'))).toBe(true)
  })
})
