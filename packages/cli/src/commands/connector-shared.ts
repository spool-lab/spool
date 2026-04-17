import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  getDB,
  ConnectorRegistry,
  TrustStore,
  PrerequisiteChecker,
  loadConnectors,
} from '@spool/core'
import type { PrerequisitesCapability } from '@spool/core'
import type Database from 'better-sqlite3'

export interface BootstrapResult {
  db: Database.Database
  registry: ConnectorRegistry
  spoolDir: string
  connectorsDir: string
  trustStore: TrustStore
  versions: Map<string, string>
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

  return { db, registry, spoolDir, connectorsDir, trustStore, versions }
}
