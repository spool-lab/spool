import { program } from 'commander'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { searchCommand } from './commands/search.js'
import { syncCommand } from './commands/sync.js'
import { listCommand } from './commands/list.js'
import { statusCommand } from './commands/status.js'
import { showCommand } from './commands/show.js'
import { connectorSyncCommand } from './commands/connector-sync.js'
import { connectorCommand } from './commands/connector.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }

program
  .name('spool')
  .description('A local search engine for your thinking — search across all your AI sessions')
  .version(pkg.version)

program.addCommand(searchCommand)
program.addCommand(syncCommand)
program.addCommand(listCommand)
program.addCommand(statusCommand)
program.addCommand(showCommand)
program.addCommand(connectorSyncCommand)
program.addCommand(connectorCommand)

program.parse()
