import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync, statSync } from 'node:fs'

const BIN = resolve(import.meta.dirname, '..', 'bin', 'spool.js')

describe('cli entry point', () => {
  it('bin/spool.js exists and is executable', () => {
    expect(existsSync(BIN)).toBe(true)
    const mode = statSync(BIN).mode
    expect(mode & 0o111).toBeGreaterThan(0)
  })

  it('--help prints usage', () => {
    const out = execFileSync('node', [BIN, '--help'], { encoding: 'utf8' })
    expect(out).toContain('Usage: spool')
    expect(out).toContain('search')
    expect(out).toContain('sync')
  })

  it('--version prints version', () => {
    const out = execFileSync('node', [BIN, '--version'], { encoding: 'utf8' })
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('unknown command exits with error', () => {
    expect(() =>
      execFileSync('node', [BIN, 'nonexistent'], { encoding: 'utf8', stdio: 'pipe' })
    ).toThrow()
  })
})
