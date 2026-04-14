import { describe, it, expect } from 'vitest'
import { ConnectorRegistry } from './registry.js'
import type { ConnectorPackage } from './types.js'

function mkConnector(id: string) {
  return { id, platform: 'p', label: id, description: '', color: '#000', ephemeral: false } as any
}

function mkPkg(id: string, connectorIds: string[]): ConnectorPackage {
  return {
    id,
    packageName: id,
    rootDir: '/tmp',
    connectors: connectorIds.map(mkConnector),
  } as any
}

describe('ConnectorRegistry.registerPackage', () => {
  it('merges connectors when the same package id registers multiple times', () => {
    const r = new ConnectorRegistry()
    r.registerPackage(mkPkg('p1', ['a']))
    r.registerPackage(mkPkg('p1', ['b']))
    const merged = r.getPackage('p1')
    expect(merged?.connectors.map(c => c.id).sort()).toEqual(['a', 'b'])
  })

  it('does not duplicate connectors with the same id', () => {
    const r = new ConnectorRegistry()
    r.registerPackage(mkPkg('p1', ['a']))
    r.registerPackage(mkPkg('p1', ['a']))
    expect(r.getPackage('p1')?.connectors.map(c => c.id)).toEqual(['a'])
  })

  it('keeps later package fields (e.g. prerequisites) on merge', () => {
    const r = new ConnectorRegistry()
    r.registerPackage(mkPkg('p1', ['a']))
    const p2 = { ...mkPkg('p1', ['b']), prerequisites: [{ id: 'req1' }] } as any
    r.registerPackage(p2)
    expect(r.getPackage('p1')?.prerequisites).toEqual([{ id: 'req1' }])
  })

  it('accumulates three sub-connectors from a multi-connector package', () => {
    const r = new ConnectorRegistry()
    for (const id of ['x', 'y', 'z']) {
      r.registerPackage(mkPkg('multi', [id]))
    }
    expect(r.getPackage('multi')?.connectors.map(c => c.id).sort()).toEqual(['x', 'y', 'z'])
  })
})
