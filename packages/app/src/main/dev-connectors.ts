import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

export function readBundledList(scriptPath: string): Set<string> {
  try {
    const content = readFileSync(scriptPath, 'utf8')
    const match = content.match(/FIRST_PARTY_PLUGINS=\(([\s\S]*?)\)/)
    if (!match) return new Set()
    const names = match[1]!.match(/"([^"]+)"/g)?.map(s => s.slice(1, -1)) ?? []
    return new Set(names)
  } catch {
    return new Set()
  }
}

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

export function linkDevConnectors(spoolDir: string, workspaceRoot: string): void {
  const connectorsParent = join(workspaceRoot, 'packages', 'connectors')
  if (!existsSync(connectorsParent)) return

  const bundled = readBundledList(join(workspaceRoot, 'scripts', 'build-bundled-connectors.sh'))
  if (bundled.size === 0) return

  const nodeModules = join(spoolDir, 'connectors', 'node_modules')

  const sdkSource = join(workspaceRoot, 'packages', 'connector-sdk')
  const sdkScopeDir = join(nodeModules, '@spool')
  mkdirSync(sdkScopeDir, { recursive: true })
  ensureSymlink(sdkSource, join(sdkScopeDir, 'connector-sdk'))

  for (const entry of readdirSync(connectorsParent)) {
    const pkgDir = join(connectorsParent, entry)
    const pkgJsonPath = join(pkgDir, 'package.json')
    if (!existsSync(pkgJsonPath)) continue

    let pkg: any
    try { pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) } catch { continue }
    if (pkg?.spool?.type !== 'connector') continue
    if (!bundled.has(pkg.name)) continue

    const name: string = pkg.name
    const segments = name.startsWith('@') ? name.split('/') : [name]
    const linkPath = join(nodeModules, ...segments)
    mkdirSync(join(nodeModules, ...segments.slice(0, -1)), { recursive: true })
    ensureSymlink(pkgDir, linkPath)
    console.log(`[dev] linked bundled connector ${name}`)
  }
}
