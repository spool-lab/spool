import { describe, it, expect, vi } from 'vitest'
import { XhsNotesConnector } from './index.js'
import type { ConnectorCapabilities } from '@spool-lab/connector-sdk'

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

describe('XhsNotesConnector.fetchPage', () => {
  it('single-shot fetch returns items with no nextCursor', async () => {
    const caps = mockCaps(async () => ({ exitCode: 0, stdout: jsonLines(Array.from({ length: 5 }, (_, i) => mkItem(`a${i}`))), stderr: '' }))
    const c = new XhsNotesConnector(caps)
    const r = await c.fetchPage({ cursor: null, sinceItemId: null, phase: 'forward' } as any)
    expect(r.items).toHaveLength(5)
    expect(r.nextCursor).toBeNull()
  })

  it('never passes --cursor / --page / --offset to opencli (unsupported flags)', async () => {
    const caps = mockCaps(async () => ({ exitCode: 0, stdout: jsonLines([mkItem('x')]), stderr: '' }))
    const c = new XhsNotesConnector(caps)
    await c.fetchPage({ cursor: '2', sinceItemId: null, phase: 'forward' } as any)
    const callArgs = (caps.exec!.run as any).mock.calls[0]![1] as string[]
    expect(callArgs).not.toContain('--cursor')
    expect(callArgs).not.toContain('--page')
    expect(callArgs).not.toContain('--offset')
  })

  it('returns nextCursor null even when items reach limit (opencli has no pagination)', async () => {
    const items = Array.from({ length: 20 }, (_, i) => mkItem(`b${i}`))
    const caps = mockCaps(async () => ({ exitCode: 0, stdout: jsonLines(items), stderr: '' }))
    const c = new XhsNotesConnector(caps)
    const r = await c.fetchPage({ cursor: null, sinceItemId: null, phase: 'forward' } as any)
    expect(r.nextCursor).toBeNull()
  })

  it('throws SyncError when opencli exits non-zero', async () => {
    const caps = mockCaps(async () => ({ exitCode: 1, stdout: '', stderr: 'connection failed' }))
    const c = new XhsNotesConnector(caps)
    await expect(c.fetchPage({ cursor: null, sinceItemId: null, phase: 'forward' } as any)).rejects.toThrow(/connection failed/)
  })

  it('treats opencli "no X found" exit as empty result, not error', async () => {
    const caps = mockCaps(async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'No notes found. Are you logged into creator.xiaohongshu.com?',
    }))
    const c = new XhsNotesConnector(caps)
    const r = await c.fetchPage({ cursor: null, sinceItemId: null, phase: 'forward' } as any)
    expect(r.items).toEqual([])
    expect(r.nextCursor).toBeNull()
  })
})
