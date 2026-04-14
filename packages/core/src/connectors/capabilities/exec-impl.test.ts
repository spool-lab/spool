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

  it('returns exit 127 when binary not found (login shell semantics)', async () => {
    const result = await exec.run('nonexistent-binary-xyz', [])
    expect(result.exitCode).toBe(127)
    expect(result.stderr).toMatch(/not found|no such/i)
  })

  it('runs through a login shell so subprocesses inherit user env (e.g. proxy vars)', async () => {
    // Sanity check: the spawned process can see at least one inherited env var
    // that login shells typically set. HOME is reliable across macOS/Linux.
    const result = await exec.run('printenv', ['HOME'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBeTruthy()
  })

  it('quotes args safely (no shell injection)', async () => {
    const result = await exec.run('echo', ['hello world', `it's a $(date) test`])
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe(`hello world it's a $(date) test`)
  })
})
