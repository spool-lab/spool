import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const REGISTRY_URL =
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
}

export async function fetchRegistry(opts: FetchRegistryOpts): Promise<RegistryConnector[]> {
  const { fetchFn = globalThis.fetch, cacheDir } = opts
  const cachePath = join(cacheDir, CACHE_FILE)

  try {
    const res = await fetchFn(REGISTRY_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) })
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
