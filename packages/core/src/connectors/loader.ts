import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  Connector,
  ConnectorCapabilities,
  CookiesCapability,
  ExecCapability,
  FetchCapability,
  LogCapability,
  Prerequisite,
  PrerequisitesCapability,
  SqliteCapability,
} from '@spool-lab/connector-sdk'
import { SyncError, SyncErrorCode, KNOWN_CAPABILITIES_V1 } from '@spool-lab/connector-sdk'
import type { ConnectorRegistry } from './registry.js'
import { extractBundledConnectorsIfNeeded, type BundleLogger, type BundleReport } from './bundle-extract.js'
import { TrustStore } from './trust-store.js'

export function validatePrerequisites(prereqs: unknown[], packageName: string): Prerequisite[] {
  const result: Prerequisite[] = []
  const seen = new Set<string>()
  for (const raw of prereqs) {
    const p = raw as Prerequisite
    if (!p.id || !p.name || !p.kind || !p.detect || !p.install) {
      throw new Error(`Invalid prerequisite in ${packageName}: missing required fields`)
    }
    if (p.install.kind !== p.kind) {
      throw new Error(`Prerequisite ${p.id} in ${packageName}: install.kind "${p.install.kind}" must match kind "${p.kind}"`)
    }
    if (p.kind === 'browser-extension') {
      const inst = p.install as { webstoreUrl?: string; manual?: unknown }
      if (!inst.webstoreUrl && !inst.manual) {
        throw new Error(`Prerequisite ${p.id} in ${packageName}: browser-extension requires webstoreUrl or manual`)
      }
    }
    if (p.minVersion && !(p.detect.type === 'exec' && p.detect.versionRegex)) {
      throw new Error(`Prerequisite ${p.id} in ${packageName}: minVersion requires detect.versionRegex`)
    }
    if (seen.has(p.id)) {
      throw new Error(`Prerequisite ${p.id} in ${packageName}: duplicate id`)
    }
    for (const req of p.requires ?? []) {
      if (!seen.has(req)) {
        throw new Error(`Prerequisite ${p.id} in ${packageName}: requires "${req}" must appear earlier in array`)
      }
    }
    seen.add(p.id)
    result.push(p)
  }
  return result
}

export interface CapabilityImpls {
  fetch: FetchCapability
  cookies: CookiesCapability
  sqlite: SqliteCapability
  exec: ExecCapability
  logFor(connectorId: string): LogCapability
  /** Returns the prerequisites capability for the given package id, or undefined if not supported. */
  prerequisitesFor?: (packageId: string) => PrerequisitesCapability
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
  multi: boolean
  prerequisites: Prerequisite[]
}

const KNOWN_CAPS_SET = new Set<string>(KNOWN_CAPABILITIES_V1)

const importedModules = new Map<string, any>()

export async function loadConnectors(deps: LoadDeps): Promise<LoadReport> {
  const { bundledConnectorsDir, connectorsDir, log } = deps

  importedModules.clear()
  // Clear before re-populating so connectors deleted from disk don't linger
  deps.registry.clear()

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
        results.push(...tryReadConnectorManifest(join(entryPath, sub), log))
      }
    } else {
      results.push(...tryReadConnectorManifest(entryPath, log))
    }
  }

  return results
}

function tryReadConnectorManifest(
  pkgDir: string,
  log: LoaderLogger,
): PkgInfo[] {
  const pkgJsonPath = join(pkgDir, 'package.json')
  if (!existsSync(pkgJsonPath)) return []

  let json: any
  try {
    json = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  } catch (err) {
    log.warn('invalid package.json', { path: pkgJsonPath, error: String(err) })
    return []
  }

  if (json?.spool?.type !== 'connector') return []

  const packageName = String(json.name)
  let prerequisites: Prerequisite[]
  try {
    prerequisites = validatePrerequisites(
      Array.isArray(json.spool.prerequisites) ? json.spool.prerequisites : [],
      packageName,
    )
  } catch (err) {
    log.error('invalid prerequisites in package', { package: packageName, error: String(err) })
    return []
  }

  // Multi-connector package: spool.connectors is an array
  if (Array.isArray(json.spool.connectors)) {
    const results: PkgInfo[] = []
    for (const entry of json.spool.connectors) {
      const declared: string[] = Array.isArray(entry.capabilities) ? entry.capabilities : []
      const unknown = declared.filter(c => !KNOWN_CAPS_SET.has(c))
      if (unknown.length > 0) {
        log.error('unknown capability in spool.connectors entry', {
          package: packageName,
          connectorId: entry.id,
          unknown,
          error: `Unknown capability "${unknown[0]}" — known v1 values: ${[...KNOWN_CAPS_SET].join(', ')}`,
        })
        continue
      }
      results.push({
        dir: pkgDir,
        name: packageName,
        version: String(json.version ?? '0.0.0'),
        manifest: {
          id: String(entry.id ?? ''),
          platform: String(entry.platform ?? ''),
          label: String(entry.label ?? ''),
          description: String(entry.description ?? ''),
          color: String(entry.color ?? '#888'),
          ephemeral: Boolean(entry.ephemeral),
          capabilities: declared,
        },
        main: String(json.main ?? 'dist/index.js'),
        multi: true,
        prerequisites,
      })
    }
    return results
  }

  // Single-connector package (original path)
  const declared: string[] = Array.isArray(json.spool.capabilities)
    ? json.spool.capabilities
    : []

  const unknown = declared.filter(c => !KNOWN_CAPS_SET.has(c))
  if (unknown.length > 0) {
    log.error('unknown capability in spool.capabilities', {
      package: packageName,
      unknown,
      error: `Unknown capability "${unknown[0]}" — known v1 values: ${[...KNOWN_CAPS_SET].join(', ')}`,
    })
    return []
  }

  return [{
    dir: pkgDir,
    name: packageName,
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
    multi: false,
    prerequisites,
  }]
}

async function loadOneConnector(
  pkg: PkgInfo,
  deps: LoadDeps,
): Promise<LoadResult> {
  if (!deps.trustStore.isTrusted(pkg.name)) {
    deps.log.info('skip untrusted connector', { name: pkg.name, id: pkg.manifest.id })
    return { status: 'skipped', name: pkg.name, reason: 'not-in-allowlist' }
  }

  try {
    const entryPath = join(pkg.dir, pkg.main)
    if (!existsSync(entryPath)) {
      throw new Error(`entry file not found: ${entryPath}`)
    }

    let mod: any
    if (importedModules.has(entryPath)) {
      mod = importedModules.get(entryPath)
    } else {
      const modUrl = pathToFileURL(entryPath).href
      mod = await import(modUrl)
      importedModules.set(entryPath, mod)
    }

    const caps = buildCapabilities(pkg.manifest.capabilities, pkg.manifest.id, pkg.name, deps.capabilityImpls)
    let ConnectorClass: any

    if (pkg.multi) {
      // Multi-connector: find the class from mod.connectors by matching id
      const classes: any[] = mod.connectors
      if (!Array.isArray(classes)) {
        throw new Error('multi-connector package must export a `connectors` array')
      }
      ConnectorClass = null
      for (const Cls of classes) {
        if (typeof Cls !== 'function') continue
        const probe: Connector = new Cls(caps)
        if (probe.id === pkg.manifest.id) {
          ConnectorClass = Cls
          break
        }
      }
      if (!ConnectorClass) {
        throw new Error(`no connector class with id="${pkg.manifest.id}" found in connectors array`)
      }
    } else {
      ConnectorClass =
        mod.default ??
        mod[pkg.manifest.id] ??
        (typeof mod === 'function' ? mod : null)
    }

    if (typeof ConnectorClass !== 'function') {
      throw new Error('module does not export a connector class')
    }

    const instance: Connector = new ConnectorClass(caps)
    applyManifestMetadata(instance, pkg, deps.log)

    deps.registry.register(instance)
    const connectorPkg: import('./types.js').ConnectorPackage = {
      id: pkg.name,
      packageName: pkg.name,
      rootDir: pkg.dir,
      connectors: [instance],
    }
    if (pkg.prerequisites.length > 0) {
      connectorPkg.prerequisites = pkg.prerequisites
    }
    deps.registry.registerPackage(connectorPkg)
    deps.log.info('loaded connector', { name: pkg.name, id: pkg.manifest.id, version: pkg.version })
    return { status: 'loaded', name: pkg.name, version: pkg.version }
  } catch (err) {
    deps.log.error('failed to load connector', {
      name: pkg.name,
      id: pkg.manifest.id,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    return { status: 'failed', name: pkg.name, error: err }
  }
}

function buildCapabilities(
  declared: string[],
  connectorId: string,
  packageId: string,
  impls: CapabilityImpls,
): ConnectorCapabilities {
  const caps: ConnectorCapabilities = {
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
    exec: declared.includes('exec')
      ? impls.exec
      : (undefinedCapability('exec') as ExecCapability),
  }
  if (declared.includes('prerequisites') && impls.prerequisitesFor) {
    caps.prerequisites = impls.prerequisitesFor(packageId)
  }
  return caps
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

/**
 * Manifest is the single source of truth for connector metadata.
 *
 * Any `readonly id/platform/label/description/color/ephemeral` declared on the
 * connector class is treated as a default and overwritten with the manifest
 * value so that runtime behavior always matches what the package declared.
 *
 * If the class field disagrees with the manifest, we log a warning so authors
 * can clean it up — but loading proceeds, since silently dropping a connector
 * because two redundant declarations drifted is worse than the inconsistency.
 */
function applyManifestMetadata(instance: Connector, pkg: PkgInfo, log: LoadDeps['log']): void {
  const fields: Array<keyof typeof pkg.manifest & keyof Connector> = [
    'id', 'platform', 'label', 'description', 'color', 'ephemeral',
  ]
  for (const field of fields) {
    const classValue = (instance as any)[field]
    const manifestValue = pkg.manifest[field]
    if (classValue !== undefined && classValue !== manifestValue) {
      log.warn('connector class field disagrees with manifest; manifest wins', {
        package: pkg.name,
        field,
        classValue,
        manifestValue,
      })
    }
    Object.defineProperty(instance, field, {
      value: manifestValue,
      writable: false,
      configurable: true,
      enumerable: true,
    })
  }
}
