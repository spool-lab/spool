import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getDB,
  ConnectorRegistry,
  TrustStore,
  loadConnectors,
  loadSyncState,
} from '@spool/core'
import type { LoadReport, LoadResult } from '@spool/core'
import type Database from 'better-sqlite3'

const __dirname = dirname(fileURLToPath(import.meta.url))

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

  const report = await loadConnectors({
    bundledConnectorsDir: join(__dirname, '../../resources/bundled-connectors'),
    connectorsDir,
    capabilityImpls: {
      fetch: makeFetchCapability(),
      cookies: makeChromeCookiesCapability(),
      sqlite: makeSqliteCapability(),
      exec: makeExecCapability(),
      logFor: (id: string) => makeLogCapabilityFor(id),
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
