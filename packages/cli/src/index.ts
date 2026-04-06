import { program } from 'commander'
import { searchCommand } from './commands/search.js'
import { syncCommand } from './commands/sync.js'
import { listCommand } from './commands/list.js'
import { statusCommand } from './commands/status.js'
import { showCommand } from './commands/show.js'
import { captureCommand } from './commands/capture.js'
import { sourcesCommand } from './commands/sources.js'
import { connectorSyncCommand } from './commands/connector-sync.js'

program
  .name('spool')
  .description('A local search engine for your thinking — search across all your AI sessions')
  .version('0.0.1')

program.addCommand(searchCommand)
program.addCommand(syncCommand)
program.addCommand(listCommand)
program.addCommand(statusCommand)
program.addCommand(showCommand)
program.addCommand(captureCommand)
program.addCommand(sourcesCommand)
program.addCommand(connectorSyncCommand)

program.parse()
