import { program } from 'commander'
import { searchCommand } from './commands/search.js'
import { syncCommand } from './commands/sync.js'
import { listCommand } from './commands/list.js'
import { statusCommand } from './commands/status.js'
import { showCommand } from './commands/show.js'
import { connectorSyncCommand } from './commands/connector-sync.js'
import { installCommand } from './commands/install.js'

program
  .name('spool')
  .description('A local search engine for your thinking — search across all your AI sessions')
  .version('0.0.1')

program.addCommand(searchCommand)
program.addCommand(syncCommand)
program.addCommand(listCommand)
program.addCommand(statusCommand)
program.addCommand(showCommand)
program.addCommand(connectorSyncCommand)
program.addCommand(installCommand)

program.parse()
