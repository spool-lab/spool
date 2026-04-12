import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchRegistry } from './registry-fetch.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testCacheDir = join(tmpdir(), `registry-fetch-test-${process.pid}`)

const sampleRegistry = {
  version: 1,
  connectors: [
    {
      name: '@spool-lab/connector-twitter-bookmarks',
      id: 'twitter-bookmarks',
      platform: 'twitter',
      label: 'X Bookmarks',
      description: 'Your saved tweets on X',
      color: '#1DA1F2',
      author: 'spool-lab',
      category: 'social',
      firstParty: true,
      bundled: true,
      npm: 'https://www.npmjs.com/package/@spool-lab/connector-twitter-bookmarks',
    },
  ],
}

beforeEach(() => {
  rmSync(testCacheDir, { recursive: true, force: true })
  mkdirSync(testCacheDir, { recursive: true })
})

describe('fetchRegistry', () => {
  it('returns connectors on successful fetch', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(sampleRegistry)))
    const result = await fetchRegistry({ fetchFn, cacheDir: testCacheDir })
    expect(result).toEqual(sampleRegistry.connectors)
  })

  it('caches result with fetchedAt timestamp', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(sampleRegistry)))
    await fetchRegistry({ fetchFn, cacheDir: testCacheDir })

    const cached = JSON.parse(
      require('node:fs').readFileSync(join(testCacheDir, 'registry-cache.json'), 'utf-8'),
    )
    expect(cached.connectors).toEqual(sampleRegistry.connectors)
    expect(typeof cached.fetchedAt).toBe('number')
  })

  it('falls back to cache on fetch failure', async () => {
    writeFileSync(
      join(testCacheDir, 'registry-cache.json'),
      JSON.stringify({ connectors: sampleRegistry.connectors, fetchedAt: Date.now() }),
    )
    const fetchFn = vi.fn().mockRejectedValue(new Error('network error'))
    const result = await fetchRegistry({ fetchFn, cacheDir: testCacheDir })
    expect(result).toEqual(sampleRegistry.connectors)
  })

  it('returns empty array when fetch fails and no cache', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network error'))
    const result = await fetchRegistry({ fetchFn, cacheDir: testCacheDir })
    expect(result).toEqual([])
  })

  it('returns empty array when fetch returns non-ok response and no cache', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }))
    const result = await fetchRegistry({ fetchFn, cacheDir: testCacheDir })
    expect(result).toEqual([])
  })

  it('falls back to cache on non-ok response', async () => {
    writeFileSync(
      join(testCacheDir, 'registry-cache.json'),
      JSON.stringify({ connectors: sampleRegistry.connectors, fetchedAt: Date.now() }),
    )
    const fetchFn = vi.fn().mockResolvedValue(new Response('Server Error', { status: 500 }))
    const result = await fetchRegistry({ fetchFn, cacheDir: testCacheDir })
    expect(result).toEqual(sampleRegistry.connectors)
  })

  it('uses AbortSignal with 3s timeout', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(sampleRegistry)))
    await fetchRegistry({ fetchFn, cacheDir: testCacheDir })
    const call = fetchFn.mock.calls[0]
    expect(call[1]?.signal).toBeInstanceOf(AbortSignal)
  })
})
