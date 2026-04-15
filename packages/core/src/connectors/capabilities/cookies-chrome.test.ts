import { describe, it, expect } from 'vitest'
import { makeChromeCookiesCapability, getMatchingHostKeys } from './cookies-chrome.js'
import { SyncError, SyncErrorCode } from '@spool/connector-sdk'

describe('getMatchingHostKeys', () => {
  it('matches host-only and same-host domain cookies', () => {
    expect(getMatchingHostKeys('reddit.com')).toEqual([
      'reddit.com',
      '.reddit.com',
    ])
  })

  it('matches parent domain cookies for subdomain requests', () => {
    expect(getMatchingHostKeys('www.reddit.com')).toEqual([
      'www.reddit.com',
      '.www.reddit.com',
      '.reddit.com',
    ])
  })

  it('walks all parent labels for deep subdomains', () => {
    expect(getMatchingHostKeys('a.b.example.co.uk')).toEqual([
      'a.b.example.co.uk',
      '.a.b.example.co.uk',
      '.b.example.co.uk',
      '.example.co.uk',
      '.co.uk',
    ])
  })

  it('does not walk into a bare TLD', () => {
    const keys = getMatchingHostKeys('reddit.com')
    expect(keys).not.toContain('.com')
    expect(keys).not.toContain('com')
  })

  it('lower-cases the input host', () => {
    expect(getMatchingHostKeys('WWW.Reddit.COM')).toEqual([
      'www.reddit.com',
      '.www.reddit.com',
      '.reddit.com',
    ])
  })

  it('strips a leading dot from the input', () => {
    expect(getMatchingHostKeys('.reddit.com')).toEqual([
      'reddit.com',
      '.reddit.com',
    ])
  })

  it('returns empty for single-label or empty hosts', () => {
    expect(getMatchingHostKeys('localhost')).toEqual([])
    expect(getMatchingHostKeys('')).toEqual([])
  })
})

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
