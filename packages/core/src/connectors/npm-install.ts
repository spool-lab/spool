import { mkdirSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import * as tar from 'tar'

export interface NpmPackageInfo {
  name: string
  version: string
  tarballUrl: string
  isConnector: boolean
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

  return { name, version, tarballUrl, isConnector }
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
