import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TrustStore } from './trust-store.js'

describe('TrustStore', () => {
  let dir: string
  let store: TrustStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spool-trust-'))
    store = new TrustStore(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('auto-trusts @spool-lab/* packages', () => {
    expect(store.isTrusted('@spool-lab/connector-twitter-bookmarks')).toBe(true)
    expect(store.isTrusted('@spool-lab/connector-anything')).toBe(true)
  })

  it('rejects unknown community packages', () => {
    expect(store.isTrusted('@community/connector-foo')).toBe(false)
  })

  it('trusts community package after explicit add', () => {
    store.add('@community/connector-foo')
    expect(store.isTrusted('@community/connector-foo')).toBe(true)
  })

  it('persists trust to config.json', () => {
    store.add('@community/connector-foo')
    const raw = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))
    expect(raw.trustedConnectors).toContain('@community/connector-foo')
  })

  it('removes trust', () => {
    store.add('@community/connector-foo')
    store.remove('@community/connector-foo')
    expect(store.isTrusted('@community/connector-foo')).toBe(false)
  })

  it('loads existing config on construction', () => {
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ trustedConnectors: ['@community/connector-bar'] }),
    )
    const store2 = new TrustStore(dir)
    expect(store2.isTrusted('@community/connector-bar')).toBe(true)
  })

  it('preserves other config keys when writing', () => {
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ someOtherKey: 42 }),
    )
    const store2 = new TrustStore(dir)
    store2.add('@community/connector-foo')
    const raw = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))
    expect(raw.someOtherKey).toBe(42)
    expect(raw.trustedConnectors).toContain('@community/connector-foo')
  })
})
