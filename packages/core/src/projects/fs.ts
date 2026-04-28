import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import type { IdentityFs } from './identity.js'

export const realFs: IdentityFs = {
  exists: existsSync,
  readText: (p) => {
    try { return readFileSync(p, 'utf8') } catch { return null }
  },
  spawn: (cmd, args, opts) => {
    const r = spawnSync(cmd, args, { cwd: opts.cwd, encoding: 'utf8' })
    return { stdout: r.stdout ?? '', exitCode: r.status ?? 1 }
  },
}
