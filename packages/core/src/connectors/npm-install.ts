import { mkdirSync, createWriteStream, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import * as tar from 'tar'

export interface NpmPackageInfo {
  name: string
  version: string
  tarballUrl: string
  isConnector: boolean
  label: string | null
  description: string | null
}

export interface InstallResult {
  name: string
  version: string
  installPath: string
}

export function registryUrl(packageName: string): string {
  const encoded = packageName.includes('/')
    ? packageName.replace('/', '%2F')
    : packageName
  return `https://registry.npmjs.org/${encoded}/latest`
}

export async function resolveNpmPackage(
  packageName: string,
  fetchFn: typeof globalThis.fetch,
): Promise<NpmPackageInfo> {
  const url = registryUrl(packageName)
  const res = await fetchFn(url)
  if (!res.ok) {
    throw new Error(`npm registry returned ${res.status} for ${packageName}`)
  }
  const data = await res.json() as Record<string, unknown>
  const name = data['name'] as string
  const version = data['version'] as string
  const dist = data['dist'] as Record<string, unknown>
  const tarballUrl = dist['tarball'] as string
  const spool = data['spool'] as Record<string, unknown> | undefined
  const isConnector = spool?.['type'] === 'connector'

  const label = typeof spool?.['label'] === 'string' ? spool['label'] : null
  const description = typeof spool?.['description'] === 'string' ? spool['description'] : null

  return { name, version, tarballUrl, isConnector, label, description }
}

export async function downloadAndInstall(
  packageName: string,
  connectorsDir: string,
  fetchFn: typeof globalThis.fetch,
): Promise<InstallResult> {
  const info = await resolveNpmPackage(packageName, fetchFn)

  if (!info.isConnector) {
    throw new Error(`Package "${packageName}" is not a spool connector (missing spool.type: "connector")`)
  }

  // Download tarball to temp file
  const tmpPath = join(tmpdir(), `spool-install-${Date.now()}.tgz`)
  const res = await fetchFn(info.tarballUrl)
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download tarball: ${res.status}`)
  }
  const fileStream = createWriteStream(tmpPath)
  await pipeline(res.body as unknown as NodeJS.ReadableStream, fileStream)

  // Extract to node_modules — same pattern as bundle-extract.ts
  const nameSegments = info.name.startsWith('@') ? info.name.split('/') : [info.name]
  const installPath = join(connectorsDir, 'node_modules', ...nameSegments)
  mkdirSync(installPath, { recursive: true })
  await tar.extract({ file: tmpPath, cwd: installPath, strip: 1 })

  return { name: info.name, version: info.version, installPath }
}

export function uninstallConnector(
  packageName: string,
  connectorsDir: string,
): void {
  const nameSegments = packageName.startsWith('@') ? packageName.split('/') : [packageName]
  const installPath = join(connectorsDir, 'node_modules', ...nameSegments)

  rmSync(installPath, { recursive: true, force: true })

  // Prevent bundled connectors from being re-extracted on next startup
  const doNotRestorePath = join(connectorsDir, '.do-not-restore')
  const lines = existsSync(doNotRestorePath)
    ? readFileSync(doNotRestorePath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
    : []
  const entries = new Set(lines)
  entries.add(packageName)
  writeFileSync(doNotRestorePath, [...entries].join('\n') + '\n')
}
