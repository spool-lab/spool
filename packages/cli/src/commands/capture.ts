import { Command } from 'commander'
import { getDB, OpenCLIManager } from '@spool/core'

export const captureCommand = new Command('capture')
  .description('Capture a URL via OpenCLI and index it locally')
  .argument('<url>', 'URL to capture')
  .option('--json', 'Output as JSON')
  .action(async (url: string, opts: { json?: boolean }) => {
    const db = getDB()
    const manager = new OpenCLIManager(db, (e) => {
      if (!opts.json) {
        process.stdout.write(`\r${e.phase}: ${e.message}`)
      }
    })

    try {
      const item = await manager.captureUrl(url)

      if (opts.json) {
        console.log(JSON.stringify(item, null, 2))
      } else {
        console.log('\n')
        console.log(`Captured and indexed:`)
        console.log(`  Title:    ${item.title || '(no title)'}`)
        console.log(`  URL:      ${item.url}`)
        console.log(`  Platform: ${item.platform}`)
        if (item.author) console.log(`  Author:   ${item.author}`)
        console.log(`  Content:  ${item.contentText.slice(0, 200)}${item.contentText.length > 200 ? '...' : ''}`)
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    }
  })
