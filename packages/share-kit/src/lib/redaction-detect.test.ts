import { describe, it, expect } from 'vitest'
import { detectSensitiveSpans } from './redaction-detect'

describe('detectSensitiveSpans', () => {
  it('finds an email and reports its span', () => {
    const text = 'reply to maya@example.com when ready'
    const [m] = detectSensitiveSpans(text)
    expect(m).toBeDefined()
    expect(m?.kind).toBe('email')
    expect(m?.value).toBe('maya@example.com')
    expect(text.slice(m!.start, m!.end)).toBe('maya@example.com')
  })

  it('finds an OpenAI-style api key', () => {
    const matches = detectSensitiveSpans('use sk-abcdef0123456789ABCDEFGH for now')
    expect(matches.map((m) => m.kind)).toContain('api-key')
  })

  it('finds a GitHub personal access token', () => {
    const matches = detectSensitiveSpans('export GH_TOKEN=ghp_abcdef0123456789ABCDEFGHIJ12')
    const kinds = matches.map((m) => m.kind)
    expect(kinds).toContain('api-key')
  })

  it('finds an AWS access key id', () => {
    const matches = detectSensitiveSpans('AKIAIOSFODNN7EXAMPLE')
    expect(matches[0]?.kind).toBe('api-key')
  })

  it('finds a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4f'
    const matches = detectSensitiveSpans(`Authorization: Bearer ${jwt}`)
    expect(matches[0]?.kind).toBe('jwt')
    expect(matches[0]?.value).toBe(jwt)
  })

  it('finds an absolute home path', () => {
    const matches = detectSensitiveSpans('check /Users/chen/secrets/keys.txt')
    expect(matches[0]?.kind).toBe('absolute-path')
  })

  it('finds an env-var-style assignment with a token-ish name', () => {
    const matches = detectSensitiveSpans('STRIPE_SECRET_KEY=sk_live_xxx')
    expect(matches.map((m) => m.kind)).toContain('env-var')
  })

  it('does not flag plain prose', () => {
    expect(detectSensitiveSpans('The cache TTL is five minutes.')).toEqual([])
  })

  it('does not flag CSS hex colors as emails', () => {
    expect(detectSensitiveSpans('background: #FF8800;')).toEqual([])
  })

  it('orders matches by start position', () => {
    const matches = detectSensitiveSpans(
      'first: maya@example.com, then key sk-1234567890abcdefghij',
    )
    expect(matches.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i]!.start).toBeGreaterThan(matches[i - 1]!.start)
    }
  })

  it('does not loop forever on a zero-width or unusual pattern', () => {
    // 1k chars of mixed content; if the loop guard fails this would
    // hang the test runner.
    const text = ('a@b.co '.repeat(100) + 'AKIAIOSFODNN7EXAMPLE ').repeat(10)
    const matches = detectSensitiveSpans(text)
    expect(matches.length).toBeGreaterThan(0)
  })
})
