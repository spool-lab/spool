import { Command } from 'commander'
import {
  getDB, OpenCLIManager,
  getOpenCLISourceId, listOpenCLISources, addOpenCLISource, removeOpenCLISource,
} from '@spool/core'

export const sourcesCommand = new Command('sources')
  .description('Manage OpenCLI data sources')
  .option('--json', 'Output as JSON')
  .action(async (opts: { json?: boolean }) => {
    const db = getDB(true)
    const sources = listOpenCLISources(db)

    if (opts.json) {
      console.log(JSON.stringify(sources, null, 2))
      return
    }

    if (sources.length === 0) {
      console.log('No OpenCLI sources configured.')
      console.log('Add one with: spool sources add <platform> <command>')
      console.log('Example: spool sources add twitter bookmarks')
      return
    }

    console.log('OpenCLI Sources:')
    console.log('')
    for (const src of sources) {
      const status = src.enabled ? '●' : '○'
      const synced = src.lastSynced
        ? `synced ${new Date(src.lastSynced).toLocaleString()}`
        : 'never synced'
      console.log(`  ${status} ${src.platform} ${src.command}  — ${src.syncCount} items, ${synced}`)
    }
  })

sourcesCommand
  .command('add')
  .description('Add a new OpenCLI source')
  .argument('<platform>', 'Platform name (e.g., twitter, github)')
  .argument('<command>', 'Command (e.g., bookmarks, stars)')
  .action(async (platform: string, command: string) => {
    const db = getDB()
    const sourceId = getOpenCLISourceId(db)
    const id = addOpenCLISource(db, sourceId, platform, command)
    console.log(`Added source: ${platform} ${command} (id: ${id})`)
  })

sourcesCommand
  .command('remove')
  .description('Remove an OpenCLI source')
  .argument('<id>', 'Source ID')
  .action(async (idStr: string) => {
    const db = getDB()
    const id = parseInt(idStr, 10)
    removeOpenCLISource(db, id)
    console.log(`Removed source ${id}`)
  })

sourcesCommand
  .command('sync')
  .description('Sync one or all OpenCLI sources')
  .argument('[platform]', 'Platform name (omit to sync all)')
  .action(async (platform?: string) => {
    const db = getDB()
    const manager = new OpenCLIManager(db, (e) => {
      process.stdout.write(`\r${e.phase}: ${e.message}`)
    })

    const sources = listOpenCLISources(db)
    const toSync = platform
      ? sources.filter(s => s.platform === platform && s.enabled)
      : sources.filter(s => s.enabled)

    if (toSync.length === 0) {
      console.log(platform ? `No enabled source found for "${platform}"` : 'No enabled sources to sync')
      return
    }

    let totalAdded = 0
    for (const src of toSync) {
      try {
        const result = await manager.syncSource(src.id, src.platform, src.command)
        totalAdded += result.added
        console.log(`\n  ${src.platform} ${src.command}: ${result.added} items`)
      } catch (err) {
        console.error(`\n  ${src.platform} ${src.command}: error — ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    console.log(`\nTotal: ${totalAdded} items synced`)
  })
