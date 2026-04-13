import { describe, it, expect } from 'vitest'
import { parseCliJsonOutput } from './cli-parser.js'

describe('parseCliJsonOutput', () => {
  it('parses a JSON array of items', () => {
    const input = JSON.stringify([
      { id: '1', title: 'Hello', url: 'https://example.com', created_at: '2026-01-01T00:00:00Z' },
      { id: '2', title: 'World', url: 'https://example.com/2', created_at: '2026-01-02T00:00:00Z' },
    ])
    const items = parseCliJsonOutput(input, 'test')
    expect(items.length).toBe(2)
    expect(items[0].title).toBe('Hello')
    expect(items[0].platformId).toBe('1')
    expect(items[0].platform).toBe('test')
  })

  it('parses newline-delimited JSON', () => {
    const input = '{"id":"1","title":"A","url":"https://a.com"}\n{"id":"2","title":"B","url":"https://b.com"}'
    const items = parseCliJsonOutput(input, 'test')
    expect(items.length).toBe(2)
  })

  it('extracts fields from flat JSON objects', () => {
    const input = JSON.stringify([{
      id: 12345,
      full_name: 'user/repo',
      html_url: 'https://github.com/user/repo',
      description: 'A cool repo',
      owner: { login: 'user' },
      created_at: '2026-03-15T10:00:00Z',
    }])
    const items = parseCliJsonOutput(input, 'github', 'repo')
    expect(items.length).toBe(1)
    expect(items[0].url).toBe('https://github.com/user/repo')
    expect(items[0].title).toBe('user/repo')
    expect(items[0].capturedAt).toBe('2026-03-15T10:00:00Z')
    expect(items[0].contentType).toBe('repo')
    expect(items[0].author).toBe('user')
  })

  it('returns empty array for empty input', () => {
    expect(parseCliJsonOutput('', 'test')).toEqual([])
    expect(parseCliJsonOutput('  \n  ', 'test')).toEqual([])
  })

  it('skips non-JSON lines in NDJSON', () => {
    const input = '{"id":"1","title":"ok","url":"https://ok.com"}\nthis is not json\n{"id":"2","title":"also ok","url":"https://ok.com"}'
    const items = parseCliJsonOutput(input, 'test')
    expect(items.length).toBe(2)
  })

  it('reads url field with fallbacks', () => {
    expect(parseCliJsonOutput(JSON.stringify([{ id: '1', url: 'https://a.com' }]), 'test')[0].url).toBe('https://a.com')
    expect(parseCliJsonOutput(JSON.stringify([{ id: '1', link: 'https://b.com' }]), 'test')[0].url).toBe('https://b.com')
    expect(parseCliJsonOutput(JSON.stringify([{ id: '1', html_url: 'https://c.com' }]), 'test')[0].url).toBe('https://c.com')
  })

  it('uses contentType from caller, defaults to page', () => {
    const input = JSON.stringify([{ id: '1', title: 'Post', url: 'https://x.com' }])
    expect(parseCliJsonOutput(input, 'github', 'repo')[0].contentType).toBe('repo')
    expect(parseCliJsonOutput(input, 'twitter', 'tweet')[0].contentType).toBe('tweet')
    expect(parseCliJsonOutput(input, 'unknown')[0].contentType).toBe('page')
  })
})
