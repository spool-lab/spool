import type { Connector, ConnectorPackage } from './types.js'

/**
 * In-memory registry of available connectors.
 *
 * Connectors are registered at app startup. The registry is the single source
 * of truth for "what connectors exist" — the scheduler and UI both read from it.
 */
export class ConnectorRegistry {
  private connectors = new Map<string, Connector>()
  private packages = new Map<string, ConnectorPackage>()

  register(connector: Connector): void {
    this.connectors.set(connector.id, connector)
  }

  registerPackage(pkg: ConnectorPackage): void {
    const existing = this.packages.get(pkg.id)
    if (existing) {
      // Multi-connector packages register once per sub-connector — merge the connectors list
      const mergedConnectors = [...existing.connectors]
      for (const c of pkg.connectors) {
        if (!mergedConnectors.some(e => e.id === c.id)) {
          mergedConnectors.push(c)
        }
      }
      this.packages.set(pkg.id, { ...pkg, connectors: mergedConnectors })
    } else {
      this.packages.set(pkg.id, pkg)
    }
  }

  getPackage(id: string): ConnectorPackage | undefined {
    return this.packages.get(id)
  }

  listPackages(): ConnectorPackage[] {
    return Array.from(this.packages.values())
  }

  get(id: string): Connector {
    const connector = this.connectors.get(id)
    if (!connector) throw new Error(`Connector "${id}" not found`)
    return connector
  }

  has(id: string): boolean {
    return this.connectors.has(id)
  }

  remove(id: string): boolean {
    return this.connectors.delete(id)
  }

  clear(): void {
    this.connectors.clear()
    this.packages.clear()
  }

  list(): Connector[] {
    return Array.from(this.connectors.values())
  }

  /** List connectors for a specific platform. */
  listByPlatform(platform: string): Connector[] {
    return this.list().filter(c => c.platform === platform)
  }
}
