import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/spool-lab/spool/main/packages/landing/public/registry.json'
const CACHE_FILE = 'registry-cache.json'
const TIMEOUT_MS = 3_000

export interface RegistryConnector {
  name: string
  id: string
  platform: string
  label: string
  description: string
  color: string
  author: string
  category: string
  firstParty: boolean
  bundled: boolean
  npm: string
}

interface FetchRegistryOpts {
  fetchFn?: typeof fetch
  cacheDir: string
  /** Override source. HTTP(S) URL, file:// URL, or absolute filesystem path. */
  url?: string
}

function isFileSource(url: string): boolean {
  return url.startsWith('file://') || url.startsWith('/')
}

function readLocalRegistry(url: string): RegistryConnector[] {
  const path = url.startsWith('file://') ? fileURLToPath(url) : url
  const raw = readFileSync(path, 'utf-8')
  const data = JSON.parse(raw) as { connectors?: RegistryConnector[] }
  return data.connectors ?? []
}

export async function fetchRegistry(opts: FetchRegistryOpts): Promise<RegistryConnector[]> {
  const { fetchFn = globalThis.fetch, cacheDir, url = DEFAULT_REGISTRY_URL } = opts
  const cachePath = join(cacheDir, CACHE_FILE)

  if (isFileSource(url)) {
    try {
      return readLocalRegistry(url)
    } catch {
      return readCachedRegistry(cachePath)
    }
  }

  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { connectors?: RegistryConnector[] }
    const connectors: RegistryConnector[] = data.connectors ?? []
    try {
      mkdirSync(cacheDir, { recursive: true })
      writeFileSync(cachePath, JSON.stringify({ connectors, fetchedAt: Date.now() }))
    } catch {}
    return connectors
  } catch {
    return readCachedRegistry(cachePath)
  }
}

function readCachedRegistry(cachePath: string): RegistryConnector[] {
  try {
    const raw = readFileSync(cachePath, 'utf-8')
    const cached = JSON.parse(raw)
    return cached.connectors ?? []
  } catch {
    return []
  }
}
