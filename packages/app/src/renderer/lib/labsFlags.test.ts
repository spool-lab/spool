import { describe, it, expect, beforeEach } from 'vitest'
import {
  getLabsFlag,
  setLabsFlag,
  subscribeLabsFlag,
  __resetLabsFlagsForTest,
  type LabsFlag,
} from './labsFlags.js'
import { MemoryStorage } from './__test__/memoryStorage.js'

let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
  __resetLabsFlagsForTest(storage)
})

describe('getLabsFlag', () => {
  it('returns null when no value is stored (no opinion)', () => {
    expect(getLabsFlag('share')).toBeNull()
  })

  it('returns true when the key is "1"', () => {
    storage.setItem('spool.labs.share', '1')
    expect(getLabsFlag('share')).toBe(true)
  })

  it('returns false when the key is "0"', () => {
    storage.setItem('spool.labs.share', '0')
    expect(getLabsFlag('share')).toBe(false)
  })

  it('returns null for unrecognized values (treated as no opinion)', () => {
    storage.setItem('spool.labs.share', 'true')
    expect(getLabsFlag('share')).toBeNull()
    storage.setItem('spool.labs.share', '')
    expect(getLabsFlag('share')).toBeNull()
  })
})

describe('setLabsFlag', () => {
  it('persists true as "1"', () => {
    setLabsFlag('share', true)
    expect(storage.getItem('spool.labs.share')).toBe('1')
  })

  it('persists false as "0" (NOT removal) so the disable wins over DEV / env', () => {
    setLabsFlag('share', false)
    expect(storage.getItem('spool.labs.share')).toBe('0')
  })

  it('round-trips through getLabsFlag', () => {
    setLabsFlag('share', true)
    expect(getLabsFlag('share')).toBe(true)
    setLabsFlag('share', false)
    expect(getLabsFlag('share')).toBe(false)
  })
})

describe('subscribeLabsFlag', () => {
  it('invokes the listener when the flag value changes', () => {
    let calls = 0
    subscribeLabsFlag('share', () => { calls++ })
    setLabsFlag('share', true)
    expect(calls).toBe(1)
    setLabsFlag('share', false)
    expect(calls).toBe(2)
  })

  it('does not fire when the value is unchanged', () => {
    setLabsFlag('share', true)
    let calls = 0
    subscribeLabsFlag('share', () => { calls++ })
    setLabsFlag('share', true)
    expect(calls).toBe(0)
  })

  it('fires when transitioning out of the unset state', () => {
    // Storage starts empty (null). Setting to false IS a change.
    let calls = 0
    subscribeLabsFlag('share', () => { calls++ })
    setLabsFlag('share', false)
    expect(calls).toBe(1)
  })

  it('returns an unsubscribe function that detaches the listener', () => {
    let calls = 0
    const off = subscribeLabsFlag('share', () => { calls++ })
    setLabsFlag('share', true)
    off()
    setLabsFlag('share', false)
    expect(calls).toBe(1)
  })

  it('isolates listeners by flag — toggling one does not fire another', () => {
    // Cast to LabsFlag: the runtime registry is keyed by string, so an
    // unregistered name still exercises the per-flag isolation path.
    let shareCalls = 0
    let otherCalls = 0
    subscribeLabsFlag('share', () => { shareCalls++ })
    subscribeLabsFlag('__test_other' as LabsFlag, () => { otherCalls++ })
    setLabsFlag('share', true)
    expect(shareCalls).toBe(1)
    expect(otherCalls).toBe(0)
  })

  it('supports multiple listeners for the same flag', () => {
    let a = 0
    let b = 0
    subscribeLabsFlag('share', () => { a++ })
    subscribeLabsFlag('share', () => { b++ })
    setLabsFlag('share', true)
    expect(a).toBe(1)
    expect(b).toBe(1)
  })
})
