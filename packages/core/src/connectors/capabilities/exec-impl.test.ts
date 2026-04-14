import { describe, it, expect } from 'vitest'
import { makeExecCapability } from './exec-impl.js'

describe('makeExecCapability', () => {
  const exec = makeExecCapability()

  it('runs a command and returns stdout', async () => {
    const result = await exec.run('echo', ['hello'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello')
    expect(result.stderr).toBe('')
  })

  it('returns non-zero exitCode on failure', async () => {
    const result = await exec.run('bash', ['-c', 'exit 42'])
    expect(result.exitCode).toBe(42)
  })

  it('captures stderr', async () => {
    const result = await exec.run('bash', ['-c', 'echo err >&2; exit 1'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr.trim()).toBe('err')
  })

  it('rejects on timeout', async () => {
    await expect(
      exec.run('sleep', ['10'], { timeout: 200 }),
    ).rejects.toThrow()
  })

  it('rejects when binary not found', async () => {
    await expect(
      exec.run('nonexistent-binary-xyz', []),
    ).rejects.toThrow()
  })
})
