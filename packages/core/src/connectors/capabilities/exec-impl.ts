import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ExecCapability, ExecResult } from '@spool-lab/connector-sdk'

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

/** POSIX single-quote escaping: wraps in '...' and escapes embedded single quotes. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

let enrichedPath: string | null = null

export function makeExecCapability(): ExecCapability {
  if (!enrichedPath) enrichedPath = buildEnrichedPath()
  const isWin = process.platform === 'win32'

  return {
    run(bin: string, args: string[], opts?: { timeout?: number }): Promise<ExecResult> {
      const timeout = opts?.timeout ?? DEFAULT_TIMEOUT

      return new Promise((resolve, reject) => {
        // GUI-launched apps on macOS don't inherit the user's shell env (no
        // proxy vars, no nvm PATH, etc.) — running through a login shell
        // sources .zprofile / .bash_profile so subprocesses get a realistic
        // env. zsh additionally needs -i to source .zshrc where most users
        // keep proxy/PATH tweaks; bash -i emits "cannot set terminal process
        // group" warnings in non-TTY contexts (eg. CI) so we stick to plain
        // -lc for bash and rely on .bash_profile to source .bashrc as is
        // standard. On Windows there is no equivalent concept, spawn direct.
        const shellPath = process.env['SHELL'] || '/bin/zsh'
        const useInteractive = /\bzsh$/.test(shellPath)
        const proc = isWin
          ? spawn(bin, args, {
              stdio: ['pipe', 'pipe', 'pipe'],
              env: { ...process.env, PATH: enrichedPath! },
            })
          : spawn(
              shellPath,
              [useInteractive ? '-ilc' : '-lc', [bin, ...args].map(shellQuote).join(' ')],
              {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, PATH: enrichedPath! },
                // Run in own process group so timeout kills the inner command
                // too, not just the shell wrapper.
                detached: true,
              },
            )

        let stdout = ''
        let stderr = ''
        let timedOut = false

        const killGroup = () => {
          if (!isWin && proc.pid) {
            // Kill the whole process group so the shell wrapper AND the
            // inner command both terminate. Without this, killing only the
            // shell leaves the inner command orphaned and stdio pipes open.
            try { process.kill(-proc.pid, 'SIGKILL') } catch { proc.kill('SIGKILL') }
          } else {
            proc.kill()
          }
        }

        const timer = setTimeout(() => {
          timedOut = true
          killGroup()
          // Resolve immediately rather than waiting for stdio drain — the
          // 'close' handler may not fire promptly when the process group is
          // killed because orphaned descendants can keep pipes open.
          reject(new Error(`Process timed out after ${timeout}ms`))
        }, timeout)

        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

        proc.on('close', () => {
          clearTimeout(timer)
          if (!timedOut) {
            resolve({ stdout, stderr, exitCode: proc.exitCode ?? 1 })
          }
        })

        proc.on('error', (err) => {
          clearTimeout(timer)
          if (!timedOut) reject(err)
        })
      })
    },
  }
}
