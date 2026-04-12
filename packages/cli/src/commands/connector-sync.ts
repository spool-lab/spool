import { Command } from 'commander'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  getDB,
  ConnectorRegistry,
  SyncEngine,
  TrustStore,
  loadConnectors,
  makeFetchCapability,
  makeChromeCookiesCapability,
  makeLogCapabilityFor,
  makeSqliteCapability,
  loadSyncState,
  saveSyncState,
} from '@spool/core'
import type { SyncState } from '@spool/core'

export const connectorSyncCommand = new Command('connector-sync')
  .description('Sync a connector until fully complete')
  .argument('[connector-id]', 'Connector ID (default: twitter-bookmarks)', 'twitter-bookmarks')
  .option('--reset', 'Delete all data for this connector and sync from scratch')
  .option('--delay <ms>', 'Delay between page requests in ms', '600')
  .action(async (connectorId: string, opts: { reset?: boolean; delay?: string }) => {
    const db = getDB()
    const registry = new ConnectorRegistry()
    const spoolDir = join(homedir(), '.spool')

    await loadConnectors({
      bundledConnectorsDir: join(__dirname, '../../resources/bundled-connectors'),
      connectorsDir: join(spoolDir, 'connectors'),
      capabilityImpls: {
        fetch: makeFetchCapability(),
        cookies: makeChromeCookiesCapability(),
        sqlite: makeSqliteCapability(),
        logFor: (id: string) => makeLogCapabilityFor(id),
      },
      registry,
      log: { info: () => {}, warn: console.warn, error: console.error },
      trustStore: new TrustStore(spoolDir),
    })

    if (!registry.has(connectorId)) {
      console.error(`Unknown connector: ${connectorId}`)
      console.error(`Available: ${registry.list().map(c => c.id).join(', ')}`)
      process.exit(1)
    }

    const connector = registry.get(connectorId)

    // Check auth first
    const auth = await connector.checkAuth()
    if (!auth.ok) {
      console.error(`Auth failed: ${auth.message}`)
      if (auth.hint) console.error(`Hint: ${auth.hint}`)
      process.exit(1)
    }

    // Reset if requested
    if (opts.reset) {
      console.log(`Resetting ${connectorId}...`)
      db.prepare(
        `DELETE FROM captures WHERE json_extract(metadata, '$.connectorId') = ?`,
      ).run(connectorId)
      db.prepare('DELETE FROM connector_sync_state WHERE connector_id = ?').run(connectorId)
      console.log('Data cleared.')
    }

    const engine = new SyncEngine(db)
    const delayMs = parseInt(opts.delay ?? '600', 10)
    const startedAt = Date.now()

    console.log(`Syncing ${connector.label}... (Ctrl+C to stop)`)

    // Handle graceful shutdown
    let aborted = false
    const controller = new AbortController()
    process.on('SIGINT', () => {
      if (aborted) process.exit(1) // second Ctrl+C = force quit
      console.log('\nStopping after current page...')
      aborted = true
      controller.abort()
    })

    const result = await engine.sync(connector, {
      direction: 'both',
      delayMs,
      maxMinutes: 0, // no time limit
      signal: controller.signal,
      onProgress: (p) => {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0)
        process.stdout.write(
          `\r  ${p.phase} page ${p.page} · ${p.added} new · ${elapsed}s elapsed`,
        )
      },
    })

    process.stdout.write('\n')

    // Final count from DB
    const row = db.prepare(
      `SELECT COUNT(*) as cnt FROM captures WHERE platform = ? AND json_extract(metadata, '$.connectorId') = ?`,
    ).get(connector.platform, connectorId) as { cnt: number }

    console.log(`Done.`)
    console.log(`  stop reason: ${result.stopReason}`)
    console.log(`  pages fetched: ${result.pages}`)
    console.log(`  new items: ${result.added}`)
    console.log(`  total in DB: ${row.cnt}`)

    if (result.error) {
      console.error(`  error [${result.error.code}]: ${result.error.message}`)
    }

    process.exit(result.error ? 1 : 0)
  })
