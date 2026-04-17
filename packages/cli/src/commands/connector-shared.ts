import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  getDB,
  ConnectorRegistry,
  TrustStore,
  PrerequisiteChecker,
  loadConnectors,
  loadSyncState,
} from '@spool/core'
import type { PrerequisitesCapability } from '@spool/core'
import type Database from 'better-sqlite3'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface BootstrapResult {
  db: Database.Database
  registry: ConnectorRegistry
  spoolDir: string
  connectorsDir: string
  trustStore: TrustStore
  versions: Map<string, string>
  bundledPackages: Set<string>
}

export async function bootstrap(opts?: { readonly?: boolean }): Promise<BootstrapResult> {
  const db = getDB(opts?.readonly)
  const registry = new ConnectorRegistry()
  const spoolDir = join(homedir(), '.spool')
  const connectorsDir = join(spoolDir, 'connectors')
  const trustStore = new TrustStore(spoolDir)

  const { makeFetchCapability, makeChromeCookiesCapability, makeSqliteCapability, makeExecCapability, makeLogCapabilityFor } =
    await import('@spool/core')

  const execImpl = makeExecCapability()
  const prereqChecker = new PrerequisiteChecker(execImpl)

  const report = await loadConnectors({
    bundledConnectorsDir: resolveBundledConnectorsDir(),
    connectorsDir,
    capabilityImpls: {
      fetch: makeFetchCapability(),
      cookies: makeChromeCookiesCapability(),
      sqlite: makeSqliteCapability(),
      exec: execImpl,
      logFor: (id: string) => makeLogCapabilityFor(id),
      prerequisitesFor: (packageId: string): PrerequisitesCapability => ({
        check: () => {
          const pkg = registry.getPackage(packageId)
          if (!pkg) return Promise.resolve([])
          return prereqChecker.check(pkg)
        },
      }),
    },
    registry,
    log: { info: () => {}, warn: console.warn, error: console.error },
    trustStore,
  })

  const versions = new Map<string, string>()
  for (const r of report.loadResults) {
    if (r.status === 'loaded') {
      versions.set(r.name, r.version)
    }
  }

  const bundledPackages = new Set([
    ...report.bundleReport.extracted,
    ...report.bundleReport.skipped,
  ])

  return { db, registry, spoolDir, connectorsDir, trustStore, versions, bundledPackages }
}

function resolveBundledConnectorsDir(): string {
  // Try the installed Spool app's bundled connectors
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Spool.app/Contents/Resources/bundled-connectors']
    : process.platform === 'linux'
      ? [join(homedir(), '.local/share/Spool/bundled-connectors'), '/opt/Spool/bundled-connectors']
      : []

  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }

  // Fallback: dev environment or no app installed
  const devDir = join(__dirname, '../../resources/bundled-connectors')
  if (existsSync(devDir)) return devDir

  return devDir // non-existent dir is fine — loadConnectors handles it gracefully
}
