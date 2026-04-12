import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as tar from 'tar'
import * as semver from 'semver'

export interface BundleLogger {
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
}

export interface BundleExtractOpts {
  bundledDir: string
  connectorsDir: string
  log: BundleLogger
}

export interface BundleReport {
  extracted: string[]
  skipped: string[]
  errors: Array<{ tarball: string; error: string }>
}

export async function extractBundledConnectorsIfNeeded(
  opts: BundleExtractOpts,
): Promise<BundleReport> {
  const { bundledDir, connectorsDir, log } = opts
  const report: BundleReport = { extracted: [], skipped: [], errors: [] }

  if (!existsSync(bundledDir)) {
    log.info('no bundled connectors directory, skipping extraction', { bundledDir })
    return report
  }

  const skip = readDoNotRestore(connectorsDir)

  const tarballs = readdirSync(bundledDir).filter(f => f.endsWith('.tgz'))
  if (tarballs.length === 0) {
    log.info('no bundled tarballs found', { bundledDir })
    return report
  }

  for (const tgzFilename of tarballs) {
    const tgzPath = join(bundledDir, tgzFilename)
    try {
      const manifest = await peekTarballManifest(tgzPath)
      const { name, version: bundledVersion } = manifest

      if (skip.has(name)) {
        log.info('skip bundle (in .do-not-restore)', { name })
        report.skipped.push(name)
        continue
      }

      const installedPkgJsonPath = join(
        connectorsDir, 'node_modules', ...nameToPath(name), 'package.json',
      )
      const installedVersion = readVersionIfExists(installedPkgJsonPath)

      if (installedVersion && semver.gte(installedVersion, bundledVersion)) {
        log.info('bundle up-to-date, skip', { name, installed: installedVersion, bundled: bundledVersion })
        report.skipped.push(name)
        continue
      }

      const destDir = join(connectorsDir, 'node_modules', ...nameToPath(name))
      mkdirSync(destDir, { recursive: true })
      await tar.extract({
        file: tgzPath,
        cwd: destDir,
        strip: 1,
      })
      log.info('extracted bundled connector', { name, version: bundledVersion })
      report.extracted.push(name)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('failed to extract bundled tarball', { tarball: tgzFilename, error: message })
      report.errors.push({ tarball: tgzFilename, error: message })
    }
  }

  return report
}

function nameToPath(name: string): string[] {
  return name.startsWith('@') ? name.split('/') : [name]
}

async function peekTarballManifest(
  tarballPath: string,
): Promise<{ name: string; version: string }> {
  let pkgJsonContent = ''
  await tar.list({
    file: tarballPath,
    onReadEntry: (entry) => {
      if (entry.path === 'package/package.json') {
        const chunks: Buffer[] = []
        entry.on('data', (c: Buffer) => chunks.push(c))
        entry.on('end', () => {
          pkgJsonContent = Buffer.concat(chunks).toString('utf8')
        })
      } else {
        entry.resume()
      }
    },
  })

  if (!pkgJsonContent) {
    throw new Error(`no package.json found inside tarball: ${tarballPath}`)
  }
  const json = JSON.parse(pkgJsonContent) as Record<string, unknown>
  if (typeof json['name'] !== 'string' || typeof json['version'] !== 'string') {
    throw new Error(`invalid package.json in tarball: ${tarballPath}`)
  }
  return { name: json['name'], version: json['version'] }
}

function readVersionIfExists(pkgJsonPath: string): string | null {
  if (!existsSync(pkgJsonPath)) return null
  try {
    const json = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as Record<string, unknown>
    return typeof json['version'] === 'string' ? json['version'] : null
  } catch {
    return null
  }
}

function readDoNotRestore(connectorsDir: string): Set<string> {
  const filePath = join(connectorsDir, '.do-not-restore')
  if (!existsSync(filePath)) return new Set()
  try {
    const lines = readFileSync(filePath, 'utf8').split('\n')
    return new Set(lines.map(l => l.trim()).filter(l => l && !l.startsWith('#')))
  } catch {
    return new Set()
  }
}
