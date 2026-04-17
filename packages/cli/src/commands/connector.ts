import { Command } from 'commander'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  downloadAndInstall,
  uninstallConnector,
  checkForUpdates,
  loadSyncState,
  SyncEngine,
  TrustStore,
} from '@spool/core'
import type { SetupStep } from '@spool/core'
import * as readline from 'node:readline'
import { bootstrap } from './connector-shared.js'

// ── list ───────────────────────────────────────────────────────────────────

const listSubcommand = new Command('list')
  .description('List installed connectors')
  .option('--json', 'Output as JSON')
  .action(async (opts: { json?: boolean }) => {
    const { db, registry, versions } = await bootstrap({ readonly: true })
    const connectors = registry.list()

    if (connectors.length === 0) {
      if (opts.json) {
        console.log('[]')
      } else {
        console.log('No connectors installed.')
      }
      return
    }

    if (opts.json) {
      const data = connectors.map(c => {
        const state = loadSyncState(db, c.id)
        const pkg = registry.getPackage(c.id) ?? registry.listPackages().find(p => p.connectors.some(pc => pc.id === c.id))
        return {
          id: c.id,
          label: c.label,
          platform: c.platform,
          packageName: pkg?.packageName ?? c.id,
          version: versions.get(pkg?.packageName ?? '') ?? 'unknown',
          totalSynced: state.totalSynced,
          lastSync: state.lastForwardSyncAt,
          hasError: state.consecutiveErrors > 0,
        }
      })
      console.log(JSON.stringify(data, null, 2))
      return
    }

    for (const c of connectors) {
      const state = loadSyncState(db, c.id)
      const pkg = registry.getPackage(c.id) ?? registry.listPackages().find(p => p.connectors.some(pc => pc.id === c.id))
      const version = versions.get(pkg?.packageName ?? '') ?? '?'
      const items = String(state.totalSynced).padStart(5)
      const lastSync = state.lastForwardSyncAt
        ? timeSince(state.lastForwardSyncAt)
        : 'never'
      const errorMark = state.consecutiveErrors > 0 ? ' [ERR]' : ''
      console.log(`  ${c.id.padEnd(24)} v${version.padEnd(8)} ${items} items  synced ${lastSync}${errorMark}`)
    }
  })

// ── status ─────────────────────────────────────────────────────────────────

const statusSubcommand = new Command('status')
  .description('Show detailed status of a connector')
  .argument('<id>', 'Connector ID')
  .action(async (connectorId: string) => {
    const { db, registry, versions } = await bootstrap({ readonly: true })

    if (!registry.has(connectorId)) {
      console.error(`Unknown connector: ${connectorId}`)
      console.error(`Available: ${registry.list().map(c => c.id).join(', ')}`)
      process.exit(1)
    }

    const connector = registry.get(connectorId)
    const state = loadSyncState(db, connectorId)
    const pkg = registry.getPackage(connectorId) ?? registry.listPackages().find(p => p.connectors.some(c => c.id === connectorId))
    const version = versions.get(pkg?.packageName ?? '') ?? 'unknown'

    const itemCount = (db.prepare(
      'SELECT COUNT(*) as cnt FROM capture_connectors WHERE connector_id = ?',
    ).get(connectorId) as { cnt: number }).cnt

    console.log(`Connector:    ${connector.label} (${connector.id})`)
    console.log(`Platform:     ${connector.platform}`)
    console.log(`Package:      ${pkg?.packageName ?? 'unknown'}`)
    console.log(`Version:      ${version}`)
    console.log(`Items in DB:  ${itemCount}`)
    console.log(`Total synced: ${state.totalSynced}`)
    console.log(``)
    console.log(`Forward sync: ${state.lastForwardSyncAt ?? 'never'}`)
    console.log(`Backfill:     ${state.lastBackfillSyncAt ?? 'never'}`)
    console.log(`Tail done:    ${state.tailComplete ? 'yes' : 'no'}`)

    if (state.consecutiveErrors > 0) {
      console.log(``)
      console.log(`Errors:       ${state.consecutiveErrors} consecutive`)
      console.log(`Last error:   [${state.lastErrorCode}] ${state.lastErrorMessage}`)
      console.log(`Error at:     ${state.lastErrorAt}`)
    }

    // Auth check
    console.log(``)
    process.stdout.write('Auth:         checking...')
    const auth = await connector.checkAuth()
    process.stdout.write(`\rAuth:         ${auth.ok ? 'ok' : 'FAILED'}        \n`)
    if (!auth.ok) {
      if (auth.message) console.log(`  Message: ${auth.message}`)
      if (auth.hint) console.log(`  Hint: ${auth.hint}`)
      printSetupSteps(auth.setup)
    }
  })

// ── install ────────────────────────────────────────────────────────────────

const installSubcommand = new Command('install')
  .description('Install a connector plugin from npm')
  .argument('<package>', 'npm package name (e.g. @spool-lab/connector-hackernews-hot)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (packageName: string, opts: { yes?: boolean }) => {
    const isFirstParty = packageName.startsWith('@spool-lab/')

    if (!opts.yes) {
      const warning = isFirstParty
        ? `Install official connector "${packageName}"?`
        : `Install community connector "${packageName}"? It will run code on your machine.`

      const confirmed = await confirm(`${warning} [y/N] `)
      if (!confirmed) {
        console.log('Cancelled.')
        process.exit(0)
      }
    }

    const spoolDir = join(homedir(), '.spool')
    const connectorsDir = join(spoolDir, 'connectors')

    console.log(`Installing ${packageName}...`)
    try {
      const result = await downloadAndInstall(packageName, connectorsDir, fetch)

      if (!isFirstParty) {
        const trustStore = new TrustStore(spoolDir)
        trustStore.add(packageName)
      }

      console.log(`Installed ${result.name} v${result.version}`)
      console.log(`  → ${result.installPath}`)
      console.log('Run `spool connector sync` to start syncing, or restart the Spool app to activate.')
    } catch (err) {
      console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  })

// ── uninstall ──────────────────────────────────────────────────────────────

const uninstallSubcommand = new Command('uninstall')
  .description('Uninstall a connector plugin')
  .argument('<id>', 'Connector ID')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('-f, --force', 'Proceed even if the Spool app is running')
  .action(async (connectorId: string, opts: { yes?: boolean; force?: boolean }) => {
    if (!opts.force && isSpoolAppRunning()) {
      console.error('The Spool app is currently running.')
      console.error('Please quit the app first, or use --force to proceed anyway.')
      process.exit(1)
    }

    const { db, registry, connectorsDir, trustStore } = await bootstrap()

    const pkg = registry.getPackage(connectorId)
      ?? registry.listPackages().find(p => p.connectors.some(c => c.id === connectorId))

    if (!pkg) {
      console.error(`Unknown connector: ${connectorId}`)
      console.error(`Available: ${registry.list().map(c => c.id).join(', ')}`)
      process.exit(1)
    }

    const allConnectorIds = pkg.connectors.map(c => c.id)
    const siblingIds = allConnectorIds.filter(id => id !== connectorId)

    if (!opts.yes) {
      let prompt = `Uninstall "${pkg.packageName}"?`
      if (siblingIds.length > 0) {
        prompt += ` This will also remove: ${siblingIds.join(', ')}`
      }
      prompt += ' This will delete all synced data for this connector.'
      const confirmed = await confirm(`${prompt} [y/N] `)
      if (!confirmed) {
        console.log('Cancelled.')
        process.exit(0)
      }
    }

    try {
      // Delete files + write .do-not-restore
      uninstallConnector(pkg.packageName, connectorsDir)
      trustStore.remove(pkg.packageName)

      // Clean DB data for all connectors in the package (matches app behavior)
      for (const cid of allConnectorIds) {
        tryRun(() => db.prepare('DELETE FROM connector_sync_state WHERE connector_id = ?').run(cid))
        tryRun(() => {
          db.prepare('DELETE FROM capture_connectors WHERE connector_id = ?').run(cid)
          db.prepare(`
            DELETE FROM captures
            WHERE source_id = (SELECT id FROM sources WHERE name = 'connector')
              AND NOT EXISTS (SELECT 1 FROM capture_connectors WHERE capture_id = captures.id)
          `).run()
        })
      }

      console.log(`Uninstalled ${pkg.packageName}`)
      if (opts.force) {
        console.log('Restart the Spool app to apply.')
      }
    } catch (err) {
      console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  })

// ── sync ───────────────────────────────────────────────────────────────────

const syncSubcommand = new Command('sync')
  .description('Sync a connector until fully complete')
  .argument('[connector-id]', 'Connector ID (omit to list available)')
  .option('--reset', 'Delete all data for this connector and sync from scratch')
  .option('--delay <ms>', 'Delay between page requests in ms', '600')
  .action(async (connectorId: string | undefined, opts: { reset?: boolean; delay?: string }) => {
    const { db, registry } = await bootstrap()

    const available = registry.list().map(c => c.id)

    if (!connectorId) {
      if (available.length === 0) {
        console.error('No connectors installed.')
        process.exit(1)
      }
      console.log('Available connectors:')
      for (const id of available) console.log(`  ${id}`)
      console.log('\nUsage: spool connector sync <connector-id>')
      process.exit(0)
    }

    if (!registry.has(connectorId)) {
      console.error(`Unknown connector: ${connectorId}`)
      console.error(`Available: ${available.join(', ')}`)
      process.exit(1)
    }

    const connector = registry.get(connectorId)

    const auth = await connector.checkAuth()
    if (!auth.ok) {
      console.error('Auth failed.')
      if (auth.message) console.error(`  ${auth.message}`)
      if (auth.hint) console.error(`  Hint: ${auth.hint}`)
      printSetupSteps(auth.setup)
      process.exit(1)
    }

    if (opts.reset) {
      console.log(`Resetting ${connectorId}...`)
      db.prepare('DELETE FROM capture_connectors WHERE connector_id = ?').run(connectorId)
      db.prepare(`
        DELETE FROM captures
        WHERE source_id = (SELECT id FROM sources WHERE name = 'connector')
          AND NOT EXISTS (SELECT 1 FROM capture_connectors WHERE capture_id = captures.id)
      `).run()
      db.prepare('DELETE FROM connector_sync_state WHERE connector_id = ?').run(connectorId)
      console.log('Data cleared.')
    }

    const engine = new SyncEngine(db)
    const delayMs = parseInt(opts.delay ?? '600', 10)
    const startedAt = Date.now()

    console.log(`Syncing ${connector.label}... (Ctrl+C to stop)`)

    let aborted = false
    const controller = new AbortController()
    process.on('SIGINT', () => {
      if (aborted) process.exit(1)
      console.log('\nStopping after current page...')
      aborted = true
      controller.abort()
    })

    const result = await engine.sync(connector, {
      direction: 'both',
      delayMs,
      maxMinutes: 0,
      signal: controller.signal,
      onProgress: (p) => {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0)
        process.stdout.write(
          `\r  ${p.phase} page ${p.page} · ${p.added} new · ${elapsed}s elapsed`,
        )
      },
    })

    process.stdout.write('\n')

    const row = db.prepare(
      'SELECT COUNT(*) as cnt FROM capture_connectors WHERE connector_id = ?',
    ).get(connectorId) as { cnt: number }

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

// ── update ─────────────────────────────────────────────────────────────────

const updateSubcommand = new Command('update')
  .description('Check for connector updates from npm')
  .argument('[id]', 'Connector ID (omit to check all)')
  .option('--apply', 'Apply available updates')
  .action(async (connectorId: string | undefined, opts: { apply?: boolean }) => {
    const { registry, versions, connectorsDir } = await bootstrap({ readonly: true })

    const packages = registry.listPackages()
    let toCheck = packages.map(p => ({
      packageName: p.packageName,
      currentVersion: versions.get(p.packageName) ?? '0.0.0',
    }))

    if (connectorId) {
      const pkg = registry.getPackage(connectorId)
        ?? packages.find(p => p.connectors.some(c => c.id === connectorId))
      if (!pkg) {
        console.error(`Unknown connector: ${connectorId}`)
        process.exit(1)
      }
      toCheck = toCheck.filter(c => c.packageName === pkg.packageName)
    }

    if (toCheck.length === 0) {
      console.log('No connectors to check.')
      return
    }

    console.log('Checking for updates...')
    const updates = await checkForUpdates(toCheck, fetch)

    if (updates.size === 0) {
      console.log('All connectors are up to date.')
      return
    }

    for (const [name, info] of updates) {
      console.log(`  ${name}  ${info.current} → ${info.latest}`)
    }

    if (!opts.apply) {
      console.log(`\nRun with --apply to install updates.`)
      return
    }

    for (const [name, info] of updates) {
      process.stdout.write(`Updating ${name}...`)
      try {
        await downloadAndInstall(name, connectorsDir, fetch)
        console.log(` ${info.current} → ${info.latest}`)
      } catch (err) {
        console.log(` FAILED: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    console.log('Restart the Spool app to apply.')
  })

// ── main command ───────────────────────────────────────────────────────────

export const connectorCommand = new Command('connector')
  .description('Manage connector plugins')
  .addCommand(listSubcommand)
  .addCommand(statusSubcommand)
  .addCommand(installSubcommand)
  .addCommand(uninstallSubcommand)
  .addCommand(syncSubcommand)
  .addCommand(updateSubcommand)

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y')
    })
  })
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const STATUS_ICON: Record<string, string> = {
  ok: '[ok]',
  missing: '[MISSING]',
  outdated: '[OUTDATED]',
  error: '[ERROR]',
  pending: '[pending]',
}

function printSetupSteps(steps?: SetupStep[]): void {
  if (!steps || steps.length === 0) return
  console.log('  Prerequisites:')
  for (const s of steps) {
    const icon = STATUS_ICON[s.status] ?? `[${s.status}]`
    console.log(`    ${icon} ${s.label}`)
    if (s.hint) console.log(`         ${s.hint}`)
    if (s.status === 'missing' && s.install) {
      const inst = s.install
      if (inst.kind === 'cli') {
        const cmd = inst.command[process.platform as 'darwin' | 'linux' | 'win32']
        if (cmd) console.log(`         → ${cmd}`)
      } else if (inst.kind === 'site-session') {
        console.log(`         → Open ${inst.openUrl} and log in`)
      } else if (inst.kind === 'browser-extension' && inst.manual) {
        for (const step of inst.manual.steps) {
          console.log(`         → ${step}`)
        }
      }
    }
    if (s.docsUrl) console.log(`         docs: ${s.docsUrl}`)
  }
}

function tryRun(fn: () => void): void {
  try { fn() } catch { /* best-effort — FTS triggers may fail on corrupted rows */ }
}

function isSpoolAppRunning(): boolean {
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Spool.exe', '/NH'], { encoding: 'utf8', stdio: 'pipe' })
      return out.includes('Spool.exe')
    }
    // macOS and Linux
    execFileSync('pgrep', ['-xi', 'spool'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}
