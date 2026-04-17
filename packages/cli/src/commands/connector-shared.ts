import { homedir } from 'node:os'
import { join } from 'node:path'
import { ProxyAgent, type Dispatcher } from 'undici'
import {
  getDB,
  ConnectorRegistry,
  TrustStore,
  PrerequisiteChecker,
  loadConnectors,
} from '@spool-lab/core'
import type { PrerequisitesCapability } from '@spool-lab/core'
import type Database from 'better-sqlite3'

function getProxyUrl(): string | undefined {
  return process.env['https_proxy'] || process.env['HTTPS_PROXY']
    || process.env['http_proxy'] || process.env['HTTP_PROXY']
    || undefined
}

let _proxyDispatcher: Dispatcher | undefined
function getProxyDispatcher(): Dispatcher | undefined {
  const url = getProxyUrl()
  if (!url) return undefined
  if (!_proxyDispatcher) _proxyDispatcher = new ProxyAgent(url)
  return _proxyDispatcher
}

export function proxyFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const dispatcher = getProxyDispatcher()
  if (!dispatcher) return globalThis.fetch(input, init)
  return globalThis.fetch(input, { ...init, dispatcher } as unknown as RequestInit)
}

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
    await import('@spool-lab/core')

  const execImpl = makeExecCapability()
  const prereqChecker = new PrerequisiteChecker(execImpl)

  const report = await loadConnectors({
    connectorsDir,
    capabilityImpls: {
      fetch: makeFetchCapability(proxyFetch),
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
