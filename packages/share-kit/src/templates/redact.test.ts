import { describe, it, expect } from 'vitest'
import {
  detectPII,
  applyRedactPolicy,
  collectRedactList,
  SYNTHETIC_KIND_AUTHOR,
  SYNTHETIC_KIND_MANUAL,
  type RedactReplacement,
} from './redact'
import { hashValueForRedactExclude } from '@spool-lab/redact'
import type { Turn } from '@/lib/types'

function turn(role: 'user' | 'assistant', body: string, opts: Partial<Turn> = {}): Turn {
  return { role, body, ...opts } as Turn
}

// Vendor prefixes built at runtime so GitHub's push-protection
// secret scanner doesn't flag the source literals.
const STRIPE_FIXTURE = 'sk_' + 'live_' + 'x'.repeat(24)

const turns: Turn[] = [
  turn('user', 'reply to maya@example.com, also AKIAIOSFODNN7EXAMPLE', { author: '[Maya]' }),
  turn('assistant', `cat /Users/chen/.aws/credentials -> ${STRIPE_FIXTURE}`, { redact: ['custom-blob'] }),
]

const values = (list: RedactReplacement[]) => list.map((r) => r.value)
const replacementFor = (list: RedactReplacement[], v: string) =>
  list.find((r) => r.value === v)?.replacement

describe('detectPII', () => {
  it('returns matches + groups + names + manual + all', () => {
    const det = detectPII(turns)
    expect(det.matches.length).toBeGreaterThan(0)
    expect(det.groups.find((g) => g.kind === 'email')).toBeTruthy()
    expect(det.names).toContain('Maya')
    expect(det.manual).toContain('custom-blob')
    expect(det.all).toContain('maya@example.com')
    expect(det.all).toContain('AKIAIOSFODNN7EXAMPLE')
    expect(det.all).toContain('Maya')
    expect(det.all).toContain('custom-blob')
  })
})

describe('applyRedactPolicy', () => {
  it('returns a {value, replacement} entry for every surviving match', () => {
    const det = detectPII(turns)
    const out = applyRedactPolicy(det, undefined)
    expect(values(out).sort()).toEqual([...det.all].sort())
    // Replacements are per-kind, not the generic [redacted]
    expect(replacementFor(out, 'maya@example.com')).toBe('m***@example.com')
    expect(replacementFor(out, 'AKIAIOSFODNN7EXAMPLE')).toBe('[redacted: AWS key]')
    expect(replacementFor(out, 'Maya')).toBe('[redacted name]')
  })

  it('drops matches whose kind is excluded', () => {
    const det = detectPII(turns)
    const out = applyRedactPolicy(det, { kinds: ['email'] })
    expect(values(out)).not.toContain('maya@example.com')
    expect(values(out)).toContain('AKIAIOSFODNN7EXAMPLE')
  })

  it('drops matches whose value is excluded', () => {
    const det = detectPII(turns)
    const out = applyRedactPolicy(det, { values: ['maya@example.com'] })
    expect(values(out)).not.toContain('maya@example.com')
    expect(values(out)).toContain('AKIAIOSFODNN7EXAMPLE')
  })

  it('honours kind and value exclusions together (union)', () => {
    const det = detectPII(turns)
    const out = applyRedactPolicy(det, {
      kinds: ['absolute-path'],
      values: ['maya@example.com'],
    })
    expect(values(out)).not.toContain('maya@example.com')
    expect(values(out).find((v) => v.includes('/Users/chen'))).toBeUndefined()
    expect(values(out)).toContain('AKIAIOSFODNN7EXAMPLE')
  })

  it('honours synthetic author kind opt-out', () => {
    const det = detectPII(turns)
    const out = applyRedactPolicy(det, { kinds: [SYNTHETIC_KIND_AUTHOR] })
    expect(values(out)).not.toContain('Maya')
    expect(values(out)).toContain('maya@example.com')
  })

  it('honours synthetic manual kind opt-out', () => {
    const det = detectPII(turns)
    const out = applyRedactPolicy(det, { kinds: [SYNTHETIC_KIND_MANUAL] })
    expect(values(out)).not.toContain('custom-blob')
  })

  it('honours valueHashes (the persisted form of per-item opt-outs)', () => {
    const det = detectPII(turns)
    const out = applyRedactPolicy(det, {
      valueHashes: [hashValueForRedactExclude('maya@example.com')],
    })
    expect(values(out)).not.toContain('maya@example.com')
    expect(values(out)).toContain('AKIAIOSFODNN7EXAMPLE')
  })

  it('treats values and valueHashes as set union', () => {
    const det = detectPII(turns)
    const out = applyRedactPolicy(det, {
      values: ['Maya'],
      valueHashes: [hashValueForRedactExclude('AKIAIOSFODNN7EXAMPLE')],
    })
    expect(values(out)).not.toContain('Maya')
    expect(values(out)).not.toContain('AKIAIOSFODNN7EXAMPLE')
  })
})

describe('collectRedactList wires policy through', () => {
  it('without opts redacts everything detected', () => {
    expect(values(collectRedactList(turns))).toContain('maya@example.com')
  })

  it('with opts.redactExclude.kinds drops the named category', () => {
    expect(values(collectRedactList(turns, { redactExclude: { kinds: ['email'] } })))
      .not.toContain('maya@example.com')
  })

  it('with opts.redactExclude.values whitelists a specific literal', () => {
    expect(values(collectRedactList(turns, { redactExclude: { values: ['Maya'] } })))
      .not.toContain('Maya')
  })
})
