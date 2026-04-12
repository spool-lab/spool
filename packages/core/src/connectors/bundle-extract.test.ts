import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'
import { extractBundledConnectorsIfNeeded } from './bundle-extract.js'

function makeTarballFixture(destDir: string, pkgName: string, version: string, extraFiles: Record<string, string> = {}): string {
  const stagingDir = mkdtempSync(join(tmpdir(), 'bundle-fixture-'))
  const packageDir = join(stagingDir, 'package')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name: pkgName,
      version,
      main: './dist/index.js',
      spool: { type: 'connector', id: pkgName.split('/').pop() },
    }),
  )
  const distDir = join(packageDir, 'dist')
  mkdirSync(distDir, { recursive: true })
  writeFileSync(join(distDir, 'index.js'), 'export default class {}')
  for (const [name, content] of Object.entries(extraFiles)) {
    writeFileSync(join(packageDir, name), content)
  }
  const tarballName = `${pkgName.replace('@', '').replace('/', '-')}-${version}.tgz`
  const tarballPath = join(destDir, tarballName)
  tar.create(
    { file: tarballPath, cwd: stagingDir, gzip: true, sync: true },
    ['package'],
  )
  rmSync(stagingDir, { recursive: true, force: true })
  return tarballPath
}

describe('extractBundledConnectorsIfNeeded', () => {
  let bundledDir: string
  let connectorsDir: string

  beforeEach(() => {
    bundledDir = mkdtempSync(join(tmpdir(), 'bundled-'))
    connectorsDir = mkdtempSync(join(tmpdir(), 'connectors-'))
  })

  it('extracts a bundled tarball when the target dir is empty', async () => {
    makeTarballFixture(bundledDir, '@spool-lab/connector-test', '1.0.0')
    const log = { info: () => {}, warn: () => {}, error: () => {} }
    await extractBundledConnectorsIfNeeded({ bundledDir, connectorsDir, log })
    const installedPath = join(
      connectorsDir, 'node_modules', '@spool-lab', 'connector-test', 'package.json',
    )
    expect(existsSync(installedPath)).toBe(true)
    const pkg = JSON.parse(readFileSync(installedPath, 'utf8'))
    expect(pkg.name).toBe('@spool-lab/connector-test')
    expect(pkg.version).toBe('1.0.0')
  })

  it('does not re-extract when installed version is equal', async () => {
    makeTarballFixture(bundledDir, '@spool-lab/connector-test', '1.0.0')
    const log = { info: () => {}, warn: () => {}, error: () => {} }
    await extractBundledConnectorsIfNeeded({ bundledDir, connectorsDir, log })
    const installedEntry = join(
      connectorsDir, 'node_modules', '@spool-lab', 'connector-test', 'dist', 'index.js',
    )
    writeFileSync(installedEntry, 'USER_MODIFIED')
    await extractBundledConnectorsIfNeeded({ bundledDir, connectorsDir, log })
    expect(readFileSync(installedEntry, 'utf8')).toBe('USER_MODIFIED')
  })

  it('overwrites when bundled version is newer', async () => {
    makeTarballFixture(bundledDir, '@spool-lab/connector-test', '1.0.0')
    const log = { info: () => {}, warn: () => {}, error: () => {} }
    await extractBundledConnectorsIfNeeded({ bundledDir, connectorsDir, log })
    rmSync(bundledDir, { recursive: true, force: true })
    mkdirSync(bundledDir, { recursive: true })
    makeTarballFixture(bundledDir, '@spool-lab/connector-test', '2.0.0')
    await extractBundledConnectorsIfNeeded({ bundledDir, connectorsDir, log })
    const installedPath = join(
      connectorsDir, 'node_modules', '@spool-lab', 'connector-test', 'package.json',
    )
    const pkg = JSON.parse(readFileSync(installedPath, 'utf8'))
    expect(pkg.version).toBe('2.0.0')
  })

  it('does not overwrite when installed version is newer than bundle', async () => {
    makeTarballFixture(bundledDir, '@spool-lab/connector-test', '2.0.0')
    const log = { info: () => {}, warn: () => {}, error: () => {} }
    await extractBundledConnectorsIfNeeded({ bundledDir, connectorsDir, log })
    rmSync(bundledDir, { recursive: true, force: true })
    mkdirSync(bundledDir, { recursive: true })
    makeTarballFixture(bundledDir, '@spool-lab/connector-test', '1.0.0')
    await extractBundledConnectorsIfNeeded({ bundledDir, connectorsDir, log })
    const installedPath = join(
      connectorsDir, 'node_modules', '@spool-lab', 'connector-test', 'package.json',
    )
    const pkg = JSON.parse(readFileSync(installedPath, 'utf8'))
    expect(pkg.version).toBe('2.0.0')
  })

  it('respects .do-not-restore list', async () => {
    makeTarballFixture(bundledDir, '@spool-lab/connector-test', '1.0.0')
    writeFileSync(join(connectorsDir, '.do-not-restore'), '@spool-lab/connector-test\n')
    const log = { info: () => {}, warn: () => {}, error: () => {} }
    await extractBundledConnectorsIfNeeded({ bundledDir, connectorsDir, log })
    const installedPath = join(
      connectorsDir, 'node_modules', '@spool-lab', 'connector-test', 'package.json',
    )
    expect(existsSync(installedPath)).toBe(false)
  })

  it('handles missing bundledDir gracefully', async () => {
    const log = { info: () => {}, warn: () => {}, error: () => {} }
    await extractBundledConnectorsIfNeeded({
      bundledDir: join(bundledDir, 'nonexistent'),
      connectorsDir,
      log,
    })
    expect(existsSync(join(connectorsDir, 'node_modules'))).toBe(false)
  })
})
