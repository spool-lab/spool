import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ExecCapability, ExecResult } from '@spool/connector-sdk'

const DEFAULT_TIMEOUT = 60_000

function buildEnrichedPath(): string {
  const home = homedir()
  const base = process.env['PATH'] ?? ''

  const nvmBins: string[] = []
  const versionsDir = join(home, '.nvm', 'versions', 'node')
  try {
    for (const d of readdirSync(versionsDir)) {
      if (d.startsWith('v')) nvmBins.push(join(versionsDir, d, 'bin'))
    }
    nvmBins.sort().reverse()
  } catch {}

  const extras = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    `${home}/.local/bin`,
    `${home}/.nvm/current/bin`,
    `${home}/.fnm/aliases/default/bin`,
    ...nvmBins,
  ]

  return [...extras, base].join(':')
}

let enrichedPath: string | null = null

export function makeExecCapability(): ExecCapability {
  if (!enrichedPath) enrichedPath = buildEnrichedPath()

  return {
    run(bin: string, args: string[], opts?: { timeout?: number }): Promise<ExecResult> {
      const timeout = opts?.timeout ?? DEFAULT_TIMEOUT

      return new Promise((resolve, reject) => {
        const proc = spawn(bin, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PATH: enrichedPath! },
        })

        let stdout = ''
        let stderr = ''
        let timedOut = false

        const timer = setTimeout(() => {
          timedOut = true
          proc.kill()
        }, timeout)

        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

        proc.on('close', () => {
          clearTimeout(timer)
          if (timedOut) {
            reject(new Error(`Process timed out after ${timeout}ms`))
          } else {
            resolve({ stdout, stderr, exitCode: proc.exitCode ?? 1 })
          }
        })

        proc.on('error', (err) => {
          clearTimeout(timer)
          reject(err)
        })
      })
    },
  }
}
