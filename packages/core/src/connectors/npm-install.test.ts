import { describe, it, expect, vi } from 'vitest'
import { registryUrl, checkForUpdates } from './npm-install.js'

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
