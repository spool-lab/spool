import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

export function ensureSymlink(target: string, linkPath: string): void {
  try {
    const stat = lstatSync(linkPath)
    if (stat.isSymbolicLink() && readlinkSync(linkPath) === target) return
    rmSync(linkPath, { recursive: true, force: true })
  } catch {
    // Doesn't exist, proceed
  }
  symlinkSync(target, linkPath)
}

function removeIfBrokenSymlink(p: string): boolean {
  let stat
  try { stat = lstatSync(p) } catch { return false }
  if (!stat.isSymbolicLink()) return false
  if (existsSync(p)) return false
  rmSync(p, { force: true })
  return true
}

/**
 * Remove broken symlinks under ~/.spool/connectors/node_modules.
 *
 * Dev symlinks (from linkDevConnectors) point into a workspace checkout;
 * deleting the worktree or switching to a branch that no longer carries a
 * connector leaves the symlink dangling. A dangling link later breaks npm
 * installs (mkdirSync follows the link and ENOENTs on the missing target).
 */
export function pruneBrokenConnectorLinks(spoolDir: string): void {
  const nodeModules = join(spoolDir, 'connectors', 'node_modules')
  if (!existsSync(nodeModules)) return

  for (const entry of readdirSync(nodeModules)) {
    const entryPath = join(nodeModules, entry)
    if (entry.startsWith('@')) {
      let children: string[]
      try { children = readdirSync(entryPath) } catch { continue }
      for (const child of children) {
        const p = join(entryPath, child)
        if (removeIfBrokenSymlink(p)) console.log(`[connectors] pruned broken symlink ${p}`)
      }
    } else {
      if (removeIfBrokenSymlink(entryPath)) console.log(`[connectors] pruned broken symlink ${entryPath}`)
    }
  }
}

/**
 * Try to install a connector package from the workspace by symlinking.
 * Returns the resolved name+version on success, or null if the package
 * isn't in the workspace (caller should fall through to npm install).
 */
export function installFromWorkspace(
  packageName: string,
  spoolDir: string,
  workspaceRoot: string,
): { name: string; version: string } | null {
  const connectorsParent = join(workspaceRoot, 'packages', 'connectors')
  if (!existsSync(connectorsParent)) return null

  for (const entry of readdirSync(connectorsParent)) {
    const pkgDir = join(connectorsParent, entry)
    const pkgJsonPath = join(pkgDir, 'package.json')
    if (!existsSync(pkgJsonPath)) continue
    let pkg: { name?: string; version?: string; spool?: { type?: string } }
    try { pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) } catch { continue }
    if (pkg.name !== packageName || pkg.spool?.type !== 'connector') continue

    const nodeModules = join(spoolDir, 'connectors', 'node_modules')
    const segments = packageName.startsWith('@') ? packageName.split('/') : [packageName]
    mkdirSync(join(nodeModules, ...segments.slice(0, -1)), { recursive: true })
    ensureSymlink(pkgDir, join(nodeModules, ...segments))
    console.log(`[dev] symlinked workspace connector ${packageName}`)
    return { name: packageName, version: pkg.version ?? '0.0.0' }
  }
  return null
}

export function linkDevConnectors(spoolDir: string, workspaceRoot: string): void {
  const connectorsParent = join(workspaceRoot, 'packages', 'connectors')
  if (!existsSync(connectorsParent)) return

  const nodeModules = join(spoolDir, 'connectors', 'node_modules')

  const sdkSource = join(workspaceRoot, 'packages', 'connector-sdk')
  const sdkScopeDir = join(nodeModules, '@spool-lab')
  mkdirSync(sdkScopeDir, { recursive: true })
  ensureSymlink(sdkSource, join(sdkScopeDir, 'connector-sdk'))

  for (const entry of readdirSync(connectorsParent)) {
    const pkgDir = join(connectorsParent, entry)
    const pkgJsonPath = join(pkgDir, 'package.json')
    if (!existsSync(pkgJsonPath)) continue

    let pkg: any
    try { pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) } catch { continue }
    if (pkg?.spool?.type !== 'connector') continue

    const name: string = pkg.name
    const segments = name.startsWith('@') ? name.split('/') : [name]
    const linkPath = join(nodeModules, ...segments)
    mkdirSync(join(nodeModules, ...segments.slice(0, -1)), { recursive: true })
    ensureSymlink(pkgDir, linkPath)
    console.log(`[dev] linked workspace connector ${name}`)
  }
}
