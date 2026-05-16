import { execSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Resolve a binary path that works in both terminal-launched and
 * GUI-launched (minimal PATH) contexts on macOS.
 *
 * Strategy: process PATH → user login+interactive shell → bash fallback →
 * well-known install locations (homebrew, ~/.local/bin, nvm, mise).
 *
 * The interactive (-i) flag is what picks up version managers that activate
 * in .zshrc / .bashrc (mise, asdf, fnm, etc.) rather than only profile files.
 */

export function nvmVersionBins(home: string, name: string): string[] {
  const versionsDir = join(home, '.nvm', 'versions', 'node')
  try {
    return readdirSync(versionsDir)
      .filter(d => d.startsWith('v'))
      .sort().reverse()
      .map(d => join(versionsDir, d, 'bin', name))
  } catch {
    return []
  }
}

/**
 * Enumerate mise-managed binary paths for a given tool name.
 * mise installs under ~/.local/share/mise/installs/<plugin>/<version>/bin/<name>,
 * and exposes shims at ~/.local/share/mise/shims/<name>. We check the shim first
 * (it's a stable entry point), then scan installed versions newest-first.
 */
export function miseVersionBins(home: string, name: string): string[] {
  const root = join(home, '.local', 'share', 'mise')
  const result: string[] = [join(root, 'shims', name)]

  const installsDir = join(root, 'installs')
  let plugins: string[]
  try {
    plugins = readdirSync(installsDir)
  } catch {
    return result
  }

  for (const plugin of plugins) {
    const pluginDir = join(installsDir, plugin)
    let versions: string[]
    try {
      versions = readdirSync(pluginDir)
    } catch { continue }
    const ordered = versions.includes('latest')
      ? ['latest', ...versions.filter(v => v !== 'latest').sort().reverse()]
      : versions.sort().reverse()
    for (const v of ordered) {
      result.push(join(pluginDir, v, 'bin', name))
    }
  }
  return result
}

/** Ordered list of filesystem paths to probe for `name`. Pure. */
export function wellKnownBinPaths(name: string, home: string, extras: string[] = []): string[] {
  return [
    ...extras,
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    `${home}/.local/bin/${name}`,
    `${home}/.nvm/current/bin/${name}`,
    ...nvmVersionBins(home, name),
    ...miseVersionBins(home, name),
  ]
}

function shellLookup(shell: string, flags: string, name: string, timeoutMs: number): string | null {
  try {
    const p = execSync(`${shell} ${flags} 'command -v ${name}'`, {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return p || null
  } catch {
    return null
  }
}

export function resolveSystemBinary(name: string, extraSearchPaths: string[] = []): string | null {
  // 1. Current process PATH — fast path for terminal-launched contexts
  try {
    const p = execSync(`command -v ${name}`, { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    if (p) return p
  } catch {}

  // 2. User's login+interactive shell — covers mise/asdf/fnm activated in .zshrc/.bashrc
  const userShell = process.env['SHELL']
  if (userShell) {
    const p = shellLookup(userShell, '-ilc', name, 5000)
    if (p) return p
  }

  // 3. Bash fallback — in case SHELL is unset or the user's shell is broken
  if (!userShell || !userShell.endsWith('bash')) {
    const p = shellLookup('bash', '-lc', name, 5000)
    if (p) return p
  }

  // 4. Well-known install locations
  for (const p of wellKnownBinPaths(name, homedir(), extraSearchPaths)) {
    if (existsSync(p)) return p
  }
  return null
}

const resolvedPaths: Record<string, string | null> = {}

/** Cached version of resolveSystemBinary — result persists for process lifetime. */
export function cachedResolve(name: string, extras: string[] = []): string | null {
  if (!(name in resolvedPaths)) {
    resolvedPaths[name] = resolveSystemBinary(name, extras)
  }
  return resolvedPaths[name] ?? null
}

/** Clear a cached resolve entry (e.g. after installing a new binary). */
export function clearResolveCache(name: string): void {
  delete resolvedPaths[name]
}
