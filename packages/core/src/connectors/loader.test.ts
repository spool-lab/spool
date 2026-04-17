import { describe, it, expect, beforeEach, vi } from 'vitest'
import { validatePrerequisites } from './loader.js'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConnectors } from './loader.js'
import { ConnectorRegistry } from './registry.js'
import { TrustStore } from './trust-store.js'
import type { Connector } from '@spool-lab/connector-sdk'

function writePkg(nodeModulesDir: string, name: string, manifest: object, entrySource: string) {
  const segments = name.startsWith('@') ? name.split('/') : [name]
  const pkgDir = join(nodeModulesDir, ...segments)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      type: 'module',
      main: './index.js',
      ...manifest,
    }),
  )
  writeFileSync(join(pkgDir, 'index.js'), entrySource)
}

function fakeCapabilityImpls() {
  return {
    fetch: globalThis.fetch,
    cookies: { get: async () => [] },
    sqlite: { openReadonly: () => { throw new Error('not available') } },
    exec: { run: async () => ({ stdout: '', stderr: '', exitCode: 0 }) },
    logFor: () => ({
      debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
      span: async (_name: string, fn: () => Promise<any>) => fn(),
    }),
  }
}

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: function() { return this },
  }
}

describe('loadConnectors', () => {
  let connectorsDir: string

  beforeEach(() => {
    connectorsDir = mkdtempSync(join(tmpdir(), 'loader-connectors-'))
  })

  function makeTrustStore(): TrustStore {
    const dir = mkdtempSync(join(tmpdir(), 'spool-trust-'))
    return new TrustStore(dir)
  }

  it('loads a connector that declares spool.type === "connector"', async () => {
    const registry = new ConnectorRegistry()
    writePkg(
      join(connectorsDir, 'node_modules'),
      '@spool-lab/connector-test',
      {
        spool: {
          type: 'connector',
          id: 'test',
          platform: 'test',
          label: 'Test',
          description: 'Test',
          color: '#000',
          ephemeral: false,
          capabilities: ['log'],
        },
      },
      `export default class TestConn {
        id = 'test'; platform = 'test'; label = 'Test';
        description = 'Test'; color = '#000'; ephemeral = false;
        constructor(caps) { this.caps = caps }
        async checkAuth() { return { ok: true } }
        async fetchPage() { return { items: [], nextCursor: null } }
      }`,
    )

    const report = await loadConnectors({
            connectorsDir,
      capabilityImpls: fakeCapabilityImpls(),
      registry,
      log: silentLogger(),
      trustStore: makeTrustStore(),
    })

    expect(report.loadResults.find(r => r.name === '@spool-lab/connector-test')?.status)
      .toBe('loaded')
    expect(registry.list().length).toBe(1)
  })

  it('manifest metadata wins over class field declarations', async () => {
    const registry = new ConnectorRegistry()
    writePkg(
      join(connectorsDir, 'node_modules'),
      '@spool-lab/connector-drift',
      {
        spool: {
          type: 'connector',
          id: 'drift',
          platform: 'drift',
          label: 'Manifest Label',
          description: 'manifest description',
          color: '#abcdef',
          ephemeral: true,
          capabilities: ['log'],
        },
      },
      `export default class DriftConn {
        id = 'drift'; platform = 'drift'; label = 'Stale Class Label';
        description = 'class description'; color = '#000000'; ephemeral = false;
        constructor(caps) { this.caps = caps }
        async checkAuth() { return { ok: true } }
        async fetchPage() { return { items: [], nextCursor: null } }
      }`,
    )

    const report = await loadConnectors({
            connectorsDir,
      capabilityImpls: fakeCapabilityImpls(),
      registry,
      log: silentLogger(),
      trustStore: makeTrustStore(),
    })

    expect(report.loadResults.find(r => r.name === '@spool-lab/connector-drift')?.status)
      .toBe('loaded')
    const loaded = registry.list()[0]!
    expect(loaded.label).toBe('Manifest Label')
    expect(loaded.color).toBe('#abcdef')
    expect(loaded.ephemeral).toBe(true)
  })

  it('skips packages without spool.type === "connector"', async () => {
    const registry = new ConnectorRegistry()
    writePkg(
      join(connectorsDir, 'node_modules'),
      'some-random-pkg',
      { description: 'not a connector' },
      `export default {}`,
    )

    const report = await loadConnectors({
            connectorsDir,
      capabilityImpls: fakeCapabilityImpls(),
      registry,
      log: silentLogger(),
      trustStore: makeTrustStore(),
    })

    expect(report.loadResults.length).toBe(0)
    expect(registry.list().length).toBe(0)
  })

  it('rejects connectors with unknown capabilities', async () => {
    const registry = new ConnectorRegistry()
    writePkg(
      join(connectorsDir, 'node_modules'),
      '@spool-lab/connector-test',
      {
        spool: {
          type: 'connector', id: 'test', platform: 'test', label: 'Test',
          description: 'Test', color: '#000', ephemeral: false,
          capabilities: ['fetch', 'filesystem:read'],
        },
      },
      `export default class {}`,
    )

    const log = silentLogger()
    await loadConnectors({
            connectorsDir,
      capabilityImpls: fakeCapabilityImpls(),
      registry,
      log,
    })

    const errorCalls = (log.error as any).mock.calls
    expect(errorCalls.some((c: any[]) =>
      String(c[1]?.error ?? '').includes('filesystem:read')
    )).toBe(true)
  })

  it('skips untrusted community connectors', async () => {
    const registry = new ConnectorRegistry()
    writePkg(
      join(connectorsDir, 'node_modules'),
      '@community/connector-untrusted',
      {
        spool: {
          type: 'connector', id: 'untrusted', platform: 'test', label: 'Untrusted',
          description: 'Test', color: '#000', ephemeral: false,
          capabilities: ['log'],
        },
      },
      `export default class {}`,
    )

    const report = await loadConnectors({
            connectorsDir,
      capabilityImpls: fakeCapabilityImpls(),
      registry,
      log: silentLogger(),
      trustStore: makeTrustStore(),
    })

    expect(report.loadResults.find(r => r.name === '@community/connector-untrusted')?.status)
      .toBe('skipped')
    expect(registry.list().length).toBe(0)
  })

  it('isolates crashes: one broken connector does not block others', async () => {
    const registry = new ConnectorRegistry()
    writePkg(
      join(connectorsDir, 'node_modules'),
      '@spool-lab/connector-typeless',
      {
        spool: {
          type: 'connector', id: 'typeless', platform: 'typeless',
          label: 'Typeless', description: '...', color: '#000', ephemeral: false,
          capabilities: ['log'],
        },
      },
      `export default class {
        id = 'typeless'; platform = 'typeless'; label = 'Typeless';
        description = '...'; color = '#000'; ephemeral = false;
        constructor() {}
        async checkAuth() { return { ok: true } }
        async fetchPage() { return { items: [], nextCursor: null } }
      }`,
    )
    writePkg(
      join(connectorsDir, 'node_modules'),
      '@spool-lab/connector-twitter-bookmarks',
      {
        spool: {
          type: 'connector', id: 'twitter-bookmarks', platform: 'twitter',
          label: 'Twitter', description: '...', color: '#000', ephemeral: false,
          capabilities: ['log'],
        },
      },
      `export default class {
        constructor() { throw new Error('boom') }
      }`,
    )

    const report = await loadConnectors({
            connectorsDir,
      capabilityImpls: fakeCapabilityImpls(),
      registry,
      log: silentLogger(),
      trustStore: makeTrustStore(),
    })

    const statuses = Object.fromEntries(
      report.loadResults.map(r => [r.name, r.status]),
    )
    expect(statuses['@spool-lab/connector-typeless']).toBe('loaded')
    expect(statuses['@spool-lab/connector-twitter-bookmarks']).toBe('failed')
    expect(registry.list().length).toBe(1)
  })

  it('loads multi-connector package with spool.connectors array', async () => {
    const registry = new ConnectorRegistry()
    writePkg(
      join(connectorsDir, 'node_modules'),
      '@spool-lab/connector-multi',
      {
        spool: {
          type: 'connector',
          connectors: [
            {
              id: 'multi-a',
              platform: 'multi',
              label: 'Multi A',
              description: 'A',
              color: '#aaa',
              ephemeral: false,
              capabilities: ['log'],
            },
            {
              id: 'multi-b',
              platform: 'multi',
              label: 'Multi B',
              description: 'B',
              color: '#bbb',
              ephemeral: true,
              capabilities: ['log'],
            },
          ],
        },
      },
      `
      class A {
        id = 'multi-a'; platform = 'multi'; label = 'Multi A';
        description = 'A'; color = '#aaa'; ephemeral = false;
        constructor(caps) { this.caps = caps }
        async checkAuth() { return { ok: true } }
        async fetchPage() { return { items: [], nextCursor: null } }
      }
      class B {
        id = 'multi-b'; platform = 'multi'; label = 'Multi B';
        description = 'B'; color = '#bbb'; ephemeral = true;
        constructor(caps) { this.caps = caps }
        async checkAuth() { return { ok: true } }
        async fetchPage() { return { items: [], nextCursor: null } }
      }
      export const connectors = [A, B];
      `,
    )

    const report = await loadConnectors({
            connectorsDir,
      capabilityImpls: fakeCapabilityImpls(),
      registry,
      log: silentLogger(),
      trustStore: makeTrustStore(),
    })

    const loaded = report.loadResults.filter(r => r.status === 'loaded')
    expect(loaded.length).toBe(2)
    expect(registry.list().length).toBe(2)
    expect(registry.has('multi-a')).toBe(true)
    expect(registry.has('multi-b')).toBe(true)
  })

  it('loads single-connector package unchanged (backward compat)', async () => {
    const registry = new ConnectorRegistry()
    writePkg(
      join(connectorsDir, 'node_modules'),
      '@spool-lab/connector-single',
      {
        spool: {
          type: 'connector',
          id: 'single',
          platform: 'test',
          label: 'Single',
          description: 'S',
          color: '#000',
          ephemeral: false,
          capabilities: ['log'],
        },
      },
      `export default class {
        id = 'single'; platform = 'test'; label = 'Single';
        description = 'S'; color = '#000'; ephemeral = false;
        constructor(caps) {}
        async checkAuth() { return { ok: true } }
        async fetchPage() { return { items: [], nextCursor: null } }
      }`,
    )

    const report = await loadConnectors({
            connectorsDir,
      capabilityImpls: fakeCapabilityImpls(),
      registry,
      log: silentLogger(),
      trustStore: makeTrustStore(),
    })

    expect(report.loadResults.find(r => r.name === '@spool-lab/connector-single')?.status).toBe('loaded')
    expect(registry.list().length).toBe(1)
  })

  it('throws when plugin uses an undeclared capability at runtime', async () => {
    const registry = new ConnectorRegistry()
    writePkg(
      join(connectorsDir, 'node_modules'),
      '@spool-lab/connector-test',
      {
        spool: {
          type: 'connector', id: 'test', platform: 'test', label: 'Test',
          description: 'Test', color: '#000', ephemeral: false,
          capabilities: ['log'],
        },
      },
      `export default class {
        id = 'test'; platform = 'test'; label = 'Test';
        description = 'Test'; color = '#000'; ephemeral = false;
        constructor(caps) { this.caps = caps }
        async checkAuth() { return { ok: true } }
        async fetchPage() {
          await this.caps.fetch('https://example.com')
          return { items: [], nextCursor: null }
        }
      }`,
    )

    const report = await loadConnectors({
            connectorsDir,
      capabilityImpls: fakeCapabilityImpls(),
      registry,
      log: silentLogger(),
      trustStore: makeTrustStore(),
    })

    expect(report.loadResults.find(r => r.name === '@spool-lab/connector-test')?.status)
      .toBe('loaded')
    const connector = registry.list()[0]
    await expect(connector.fetchPage({ cursor: null, sinceItemId: null, phase: 'forward', signal: new AbortController().signal }))
      .rejects.toThrow(/not declared/)
  })
})

describe('validatePrerequisites', () => {
  const validBase = {
    id: 'req1',
    name: 'Req One',
    kind: 'exec' as const,
    detect: { type: 'exec' as const, command: 'req1', args: ['--version'] },
    install: { kind: 'exec' as const, url: 'https://example.com' },
  }

  it('accepts a valid prerequisite', () => {
    expect(validatePrerequisites([validBase], 'pkg')).toHaveLength(1)
  })

  it('throws on duplicate prerequisite id', () => {
    expect(() => validatePrerequisites([validBase, validBase], 'pkg'))
      .toThrow('Prerequisite req1 in pkg: duplicate id')
  })

  it('throws on missing required fields', () => {
    expect(() => validatePrerequisites([{ id: 'x' }], 'pkg'))
      .toThrow(/missing required fields/)
  })

  it('throws on install.kind mismatch', () => {
    const bad = { ...validBase, install: { ...validBase.install, kind: 'browser-extension' as any } }
    expect(() => validatePrerequisites([bad], 'pkg'))
      .toThrow(/install\.kind/)
  })
})
