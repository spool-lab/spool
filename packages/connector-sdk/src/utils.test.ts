import { describe, it, expect } from 'vitest'
import { abortableSleep } from './utils.js'

describe('abortableSleep', () => {
  it('resolves after the specified duration when signal is not aborted', async () => {
    const start = Date.now()
    await abortableSleep(50)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(45)
    expect(elapsed).toBeLessThan(200)
  })

  it('rejects immediately if signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort(new Error('pre-aborted'))
    await expect(abortableSleep(5000, ac.signal)).rejects.toThrow('pre-aborted')
  })

  it('rejects when signal fires during sleep', async () => {
    const ac = new AbortController()
    const sleepPromise = abortableSleep(5000, ac.signal)
    setTimeout(() => ac.abort(new Error('cancelled')), 20)
    const start = Date.now()
    await expect(sleepPromise).rejects.toThrow('cancelled')
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(200)
  })

  it('does not leak timeout when signal fires', async () => {
    for (let i = 0; i < 100; i++) {
      const ac = new AbortController()
      const p = abortableSleep(10_000, ac.signal).catch(() => {})
      ac.abort()
      await p
    }
  })

  it('does not leak listener when timeout completes', async () => {
    const ac = new AbortController()
    await abortableSleep(10, ac.signal)
    ac.abort()
  })
})
