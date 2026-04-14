import { describe, it, expect, vi } from 'vitest'
import { XhsFeedConnector, XhsNotesConnector, XhsNotificationsConnector } from './index.js'
import type { ConnectorCapabilities } from '@spool/connector-sdk'

function mockCaps(runImpl: (cmd: string, args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>): ConnectorCapabilities {
  return {
    exec: { run: vi.fn().mockImplementation(runImpl) },
  } as unknown as ConnectorCapabilities
}

function jsonLines(items: Array<Record<string, unknown>>): string {
  return items.map(i => JSON.stringify(i)).join('\n')
}

function mkItem(id: string) {
  return { id, title: `note ${id}`, url: `https://xhs.test/${id}`, ts: Date.now() }
}

describe('XhsFeedConnector.fetchPage', () => {
  it('first call with no cursor invokes opencli without --cursor', async () => {
    const caps = mockCaps(async () => ({ exitCode: 0, stdout: jsonLines(Array.from({ length: 5 }, (_, i) => mkItem(`a${i}`))), stderr: '' }))
    const c = new XhsFeedConnector(caps)
    const r = await c.fetchPage({ cursor: null, sinceItemId: null, phase: 'forward' } as any)
    expect(r.items).toHaveLength(5)
    expect(r.nextCursor).toBeNull()   // fewer than limit → no more
    expect(caps.exec!.run).toHaveBeenCalledWith('opencli', expect.not.arrayContaining(['--cursor']), expect.anything())
  })

  it('returns page cursor when limit reached under max', async () => {
    const items = Array.from({ length: 20 }, (_, i) => mkItem(`b${i}`))
    const caps = mockCaps(async () => ({ exitCode: 0, stdout: jsonLines(items), stderr: '' }))
    const c = new XhsFeedConnector(caps)
    const r = await c.fetchPage({ cursor: null, sinceItemId: null, phase: 'forward' } as any)
    expect(r.nextCursor).toBe('2')
  })

  it('terminates at MAX_PAGES for feed (3)', async () => {
    const items = Array.from({ length: 20 }, (_, i) => mkItem(`c${i}`))
    const caps = mockCaps(async () => ({ exitCode: 0, stdout: jsonLines(items), stderr: '' }))
    const c = new XhsFeedConnector(caps)
    // Simulate 3 consecutive calls — at page 3, should return nextCursor: null
    const r1 = await c.fetchPage({ cursor: null, sinceItemId: null, phase: 'forward' } as any)
    expect(r1.nextCursor).toBe('2')
    const r2 = await c.fetchPage({ cursor: '2', sinceItemId: null, phase: 'forward' } as any)
    expect(r2.nextCursor).toBe('3')
    const r3 = await c.fetchPage({ cursor: '3', sinceItemId: null, phase: 'forward' } as any)
    expect(r3.nextCursor).toBeNull()
  })

  it('even if opencli returns infinite same-cursor data, loop terminates by MAX_PAGES', async () => {
    // Simulate sync-engine's loop: call fetchPage repeatedly until nextCursor is null
    const items = Array.from({ length: 20 }, (_, i) => mkItem(`d${i}`))
    const runMock = vi.fn().mockResolvedValue({ exitCode: 0, stdout: jsonLines(items), stderr: '' })
    const caps = { exec: { run: runMock } } as unknown as ConnectorCapabilities
    const c = new XhsFeedConnector(caps)

    let cursor: string | null = null
    let pages = 0
    while (pages < 100) {
      const r = await c.fetchPage({ cursor, sinceItemId: null, phase: 'forward' } as any)
      pages++
      if (!r.nextCursor) break
      cursor = r.nextCursor
    }
    expect(pages).toBeLessThanOrEqual(3)   // MAX_PAGES.feed
  })

  it('passes --cursor to opencli when ctx.cursor is set', async () => {
    const caps = mockCaps(async () => ({ exitCode: 0, stdout: jsonLines([mkItem('x')]), stderr: '' }))
    const c = new XhsFeedConnector(caps)
    await c.fetchPage({ cursor: '2', sinceItemId: null, phase: 'forward' } as any)
    expect(caps.exec!.run).toHaveBeenCalledWith(
      'opencli',
      expect.arrayContaining(['--cursor', '2']),
      expect.anything(),
    )
  })

  it('throws SyncError when opencli exits non-zero', async () => {
    const caps = mockCaps(async () => ({ exitCode: 1, stdout: '', stderr: 'connection failed' }))
    const c = new XhsFeedConnector(caps)
    await expect(c.fetchPage({ cursor: null, sinceItemId: null, phase: 'forward' } as any)).rejects.toThrow(/connection failed/)
  })
})

describe('XhsNotesConnector MAX_PAGES cap', () => {
  it('caps at 20 pages even with infinite data', async () => {
    const items = Array.from({ length: 20 }, (_, i) => mkItem(`n${i}`))
    const caps = mockCaps(async () => ({ exitCode: 0, stdout: jsonLines(items), stderr: '' }))
    const c = new XhsNotesConnector(caps)

    let cursor: string | null = null
    let pages = 0
    while (pages < 1000) {
      const r = await c.fetchPage({ cursor, sinceItemId: null, phase: 'forward' } as any)
      pages++
      if (!r.nextCursor) break
      cursor = r.nextCursor
    }
    expect(pages).toBeLessThanOrEqual(20)
  })
})

describe('XhsNotificationsConnector', () => {
  it('is persistent (not ephemeral)', () => {
    const caps = { exec: { run: vi.fn() } } as unknown as ConnectorCapabilities
    const c = new XhsNotificationsConnector(caps)
    expect(c.ephemeral).toBe(false)
  })

  it('caps at 20 pages', async () => {
    const items = Array.from({ length: 20 }, (_, i) => mkItem(`m${i}`))
    const caps = mockCaps(async () => ({ exitCode: 0, stdout: jsonLines(items), stderr: '' }))
    const c = new XhsNotificationsConnector(caps)

    let cursor: string | null = null
    let pages = 0
    while (pages < 1000) {
      const r = await c.fetchPage({ cursor, sinceItemId: null, phase: 'forward' } as any)
      pages++
      if (!r.nextCursor) break
      cursor = r.nextCursor
    }
    expect(pages).toBeLessThanOrEqual(20)
  })
})
