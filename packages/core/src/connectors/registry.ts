import type { Connector } from './types.js'

/**
 * In-memory registry of available connectors.
 *
 * Connectors are registered at app startup. The registry is the single source
 * of truth for "what connectors exist" — the scheduler and UI both read from it.
 */
export class ConnectorRegistry {
  private connectors = new Map<string, Connector>()

  register(connector: Connector): void {
    this.connectors.set(connector.id, connector)
  }

  get(id: string): Connector {
    const connector = this.connectors.get(id)
    if (!connector) throw new Error(`Connector "${id}" not found`)
    return connector
  }

  has(id: string): boolean {
    return this.connectors.has(id)
  }

  list(): Connector[] {
    return Array.from(this.connectors.values())
  }

  /** List connectors for a specific platform. */
  listByPlatform(platform: string): Connector[] {
    return this.list().filter(c => c.platform === platform)
  }
}
