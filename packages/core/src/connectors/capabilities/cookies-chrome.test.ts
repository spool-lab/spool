import { describe, it, expect } from 'vitest'
import { makeChromeCookiesCapability } from './cookies-chrome.js'
import { SyncError, SyncErrorCode } from '@spool/connector-sdk'

describe('makeChromeCookiesCapability', () => {
  it('returns a capability with a get method', () => {
    const cap = makeChromeCookiesCapability()
    expect(typeof cap.get).toBe('function')
  })

  it('rejects non-chrome browser', async () => {
    const cap = makeChromeCookiesCapability()
    // @ts-expect-error — testing runtime guard against invalid union value
    await expect(cap.get({ browser: 'safari', url: 'https://x.com' }))
      .rejects.toThrow(SyncError)
  })

  // Integration test: only runs if Chrome is available
  it.skipIf(!process.env.CI_HAS_CHROME)(
    'returns cookies from Chrome for x.com',
    async () => {
      const cap = makeChromeCookiesCapability()
      const cookies = await cap.get({ browser: 'chrome', url: 'https://x.com' })
      expect(Array.isArray(cookies)).toBe(true)
      for (const c of cookies) {
        expect(typeof c.name).toBe('string')
        expect(typeof c.value).toBe('string')
        expect(typeof c.secure).toBe('boolean')
      }
    },
  )
})
