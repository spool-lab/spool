import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  Connector,
  ConnectorCapabilities,
  CookiesCapability,
  FetchCapability,
  LogCapability,
  SqliteCapability,
} from '@spool/connector-sdk'
import { SyncError, SyncErrorCode, KNOWN_CAPABILITIES_V1 } from '@spool/connector-sdk'
import type { ConnectorRegistry } from './registry.js'
import { extractBundledConnectorsIfNeeded, type BundleLogger, type BundleReport } from './bundle-extract.js'
import { TrustStore } from './trust-store.js'

export interface CapabilityImpls {
  fetch: FetchCapability
  cookies: CookiesCapability
  sqlite: SqliteCapability
  logFor(connectorId: string): LogCapability
}

export interface LoaderLogger extends BundleLogger {
  child?(attrs: Record<string, unknown>): LoaderLogger
}

export interface LoadDeps {
  bundledConnectorsDir: string
  connectorsDir: string
  capabilityImpls: CapabilityImpls
  registry: ConnectorRegistry
  log: LoaderLogger
  trustStore: TrustStore
}

export type LoadResult =
  | { status: 'loaded'; name: string; version: string }
  | { status: 'failed'; name: string; error: unknown }
  | { status: 'skipped'; name: string; reason: 'not-in-allowlist' | 'bad-manifest' }

export interface LoadReport {
  bundleReport: BundleReport
  loadResults: LoadResult[]
}

interface PkgInfo {
  dir: string
  name: string
  version: string
  manifest: {
    id: string
    platform: string
    label: string
    description: string
    color: string
    ephemeral: boolean
    capabilities: string[]
  }
  main: string
}

const KNOWN_CAPS_SET = new Set<string>(KNOWN_CAPABILITIES_V1)

export async function loadConnectors(deps: LoadDeps): Promise<LoadReport> {
  const { bundledConnectorsDir, connectorsDir, log } = deps

  const bundleReport = await extractBundledConnectorsIfNeeded({
    bundledDir: bundledConnectorsDir,
    connectorsDir,
    log,
  })

  const discovered = discoverConnectorPackages(connectorsDir, log)

  const loadResults: LoadResult[] = []
  for (const pkg of discovered) {
    const result = await loadOneConnector(pkg, deps)
    loadResults.push(result)
  }

  return { bundleReport, loadResults }
}

function discoverConnectorPackages(
  connectorsDir: string,
  log: LoaderLogger,
): PkgInfo[] {
  const nodeModules = join(connectorsDir, 'node_modules')
  if (!existsSync(nodeModules)) return []

  const results: PkgInfo[] = []
  let topEntries: string[]
  try {
    topEntries = readdirSync(nodeModules)
  } catch (err) {
    log.error('failed to read node_modules', { error: String(err) })
    return results
  }

  for (const entry of topEntries) {
    if (entry.startsWith('.')) continue
    const entryPath = join(nodeModules, entry)

    if (entry.startsWith('@')) {
      let scopedEntries: string[]
      try {
        scopedEntries = readdirSync(entryPath)
      } catch {
        continue
      }
      for (const sub of scopedEntries) {
        if (sub.startsWith('.')) continue
        const pkg = tryReadConnectorManifest(join(entryPath, sub), log)
        if (pkg) results.push(pkg)
      }
    } else {
      const pkg = tryReadConnectorManifest(entryPath, log)
      if (pkg) results.push(pkg)
    }
  }

  return results
}

function tryReadConnectorManifest(
  pkgDir: string,
  log: LoaderLogger,
): PkgInfo | null {
  const pkgJsonPath = join(pkgDir, 'package.json')
  if (!existsSync(pkgJsonPath)) return null

  let json: any
  try {
    json = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  } catch (err) {
    log.warn('invalid package.json', { path: pkgJsonPath, error: String(err) })
    return null
  }

  if (json?.spool?.type !== 'connector') return null

  const declared: string[] = Array.isArray(json.spool.capabilities)
    ? json.spool.capabilities
    : []

  const unknown = declared.filter(c => !KNOWN_CAPS_SET.has(c))
  if (unknown.length > 0) {
    log.error('unknown capability in spool.capabilities', {
      package: json.name,
      unknown,
      error: `Unknown capability "${unknown[0]}" — known v1 values: ${[...KNOWN_CAPS_SET].join(', ')}`,
    })
    return null
  }

  return {
    dir: pkgDir,
    name: String(json.name),
    version: String(json.version ?? '0.0.0'),
    manifest: {
      id: String(json.spool.id ?? ''),
      platform: String(json.spool.platform ?? ''),
      label: String(json.spool.label ?? ''),
      description: String(json.spool.description ?? ''),
      color: String(json.spool.color ?? '#888'),
      ephemeral: Boolean(json.spool.ephemeral),
      capabilities: declared,
    },
    main: String(json.main ?? 'dist/index.js'),
  }
}

async function loadOneConnector(
  pkg: PkgInfo,
  deps: LoadDeps,
): Promise<LoadResult> {
  if (!deps.trustStore.isTrusted(pkg.name)) {
    deps.log.info('skip untrusted connector', { name: pkg.name })
    return { status: 'skipped', name: pkg.name, reason: 'not-in-allowlist' }
  }

  try {
    const entryPath = join(pkg.dir, pkg.main)
    if (!existsSync(entryPath)) {
      throw new Error(`entry file not found: ${entryPath}`)
    }
    const modUrl = pathToFileURL(entryPath).href
    const mod = await import(modUrl)
    const ConnectorClass =
      mod.default ??
      mod[pkg.manifest.id] ??
      (typeof mod === 'function' ? mod : null)

    if (typeof ConnectorClass !== 'function') {
      throw new Error('module does not export a connector class')
    }

    const caps = buildCapabilities(pkg.manifest.capabilities, pkg.name, deps.capabilityImpls)
    const instance: Connector = new ConnectorClass(caps)
    validateMetadataConsistency(pkg, instance)

    deps.registry.register(instance)
    deps.log.info('loaded connector', { name: pkg.name, version: pkg.version })
    return { status: 'loaded', name: pkg.name, version: pkg.version }
  } catch (err) {
    deps.log.error('failed to load connector', {
      name: pkg.name,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    return { status: 'failed', name: pkg.name, error: err }
  }
}

function buildCapabilities(
  declared: string[],
  connectorId: string,
  impls: CapabilityImpls,
): ConnectorCapabilities {
  return {
    fetch: declared.includes('fetch')
      ? impls.fetch
      : (undefinedCapability('fetch') as FetchCapability),
    cookies: declared.includes('cookies:chrome')
      ? impls.cookies
      : (undefinedCapability('cookies:chrome') as CookiesCapability),
    log: declared.includes('log')
      ? impls.logFor(connectorId)
      : (undefinedCapability('log') as LogCapability),
    sqlite: declared.includes('sqlite')
      ? impls.sqlite
      : (undefinedCapability('sqlite') as SqliteCapability),
  }
}

function undefinedCapability(name: string): unknown {
  return new Proxy(
    function undef() {
      throw makeUndeclaredError(name, 'call')
    },
    {
      get(_target, prop) {
        return () => {
          throw makeUndeclaredError(name, String(prop))
        }
      },
      apply() {
        throw makeUndeclaredError(name, 'call')
      },
    },
  )
}

function makeUndeclaredError(name: string, accessor: string): SyncError {
  return new SyncError(
    SyncErrorCode.CONNECTOR_ERROR,
    `Capability "${name}" used (via .${accessor}) but not declared in spool.capabilities`,
  )
}

function validateMetadataConsistency(pkg: PkgInfo, instance: Connector): void {
  const fields: Array<keyof typeof pkg.manifest & keyof Connector> = [
    'id', 'platform', 'label', 'description', 'color', 'ephemeral',
  ]
  for (const field of fields) {
    if (instance[field] !== pkg.manifest[field]) {
      throw new Error(
        `metadata mismatch for ${pkg.name}: ` +
        `instance.${field}=${JSON.stringify(instance[field])} ` +
        `but manifest.${field}=${JSON.stringify(pkg.manifest[field])}`,
      )
    }
  }
}
