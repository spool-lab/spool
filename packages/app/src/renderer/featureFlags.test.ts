import { describe, it, expect, beforeEach } from 'vitest'
import { resolveFeatureRuntime, type FeatureRuntimeDeps } from './featureFlags.js'
import { __resetLabsFlagsForTest } from './lib/labsFlags.js'
import { MemoryStorage } from './lib/__test__/memoryStorage.js'

const off: FeatureRuntimeDeps = {
  dev: false,
  envEnabled: () => false,
  labsValue: () => null,
}

beforeEach(() => {
  __resetLabsFlagsForTest(new MemoryStorage())
})

describe('resolveFeatureRuntime', () => {
  it('returns false when all sources are off (no opinion)', () => {
    expect(resolveFeatureRuntime('share', off)).toBe(false)
  })

  it('returns true when DEV is on and no labs opinion', () => {
    expect(resolveFeatureRuntime('share', { ...off, dev: true })).toBe(true)
  })

  it('returns true when env flag is set and no labs opinion', () => {
    expect(resolveFeatureRuntime('share', { ...off, envEnabled: (k) => k === 'SHARE' })).toBe(true)
  })

  it('returns true when labs is explicitly enabled', () => {
    expect(resolveFeatureRuntime('share', { ...off, labsValue: () => true })).toBe(true)
  })

  it('labs explicit OFF beats DEV ON (user choice wins)', () => {
    expect(resolveFeatureRuntime('share', { ...off, dev: true, labsValue: () => false })).toBe(false)
  })

  it('labs explicit OFF beats env ON (user choice wins)', () => {
    expect(resolveFeatureRuntime('share', {
      ...off,
      envEnabled: (k) => k === 'SHARE',
      labsValue: () => false,
    })).toBe(false)
  })

  it('labs explicit ON wins even when DEV / env are off', () => {
    expect(resolveFeatureRuntime('share', { ...off, labsValue: () => true })).toBe(true)
  })

  it('upper-cases the flag name when consulting env', () => {
    const seen: string[] = []
    resolveFeatureRuntime('share', { ...off, envEnabled: (k) => { seen.push(k); return false } })
    expect(seen).toEqual(['SHARE'])
  })
})
