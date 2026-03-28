import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

/**
 * Resolve a binary path that works in both terminal-launched and
 * GUI-launched (minimal PATH) contexts on macOS.
 *
 * Strategy: try `which` first, then login shell, then well-known paths.
 */
export function resolveSystemBinary(name: string, extraSearchPaths: string[] = []): string | null {
  // Try shell lookup first
  try {
    const p = execSync(`which ${name}`, { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    if (p) return p
  } catch {}

  // Try login shell — picks up nvm/fnm/etc even in GUI context
  try {
    const p = execSync(`bash -lc "which ${name}"`, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    if (p) return p
  } catch {}

  // Check well-known paths directly
  const home = homedir()
  const searchPaths = [
    ...extraSearchPaths,
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    `${home}/.local/bin/${name}`,
    `${home}/.nvm/current/bin/${name}`,
  ]
  for (const p of searchPaths) {
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
