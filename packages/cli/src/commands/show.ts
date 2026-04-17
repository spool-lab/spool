import { Command } from 'commander'
import { getDB, getSessionWithMessages } from '@spool-lab/core'

export const showCommand = new Command('show')
  .description('Print full session as text')
  .argument('<uuid>', 'Session UUID')
  .option('--json', 'Output as JSON')
  .action((uuid: string, opts: { json?: boolean }) => {
    const db = getDB(true)
    const result = getSessionWithMessages(db, uuid)

    if (!result) {
      console.error(`Session not found: ${uuid}`)
      process.exit(1)
    }

    const { session, messages } = result

    if (opts.json) {
      console.log(JSON.stringify({ session, messages }, null, 2))
      return
    }

    console.log(`Session: ${session.title ?? '(no title)'}`)
    console.log(`Source:  ${session.source}`)
    console.log(`Project: ${session.projectDisplayPath}`)
    console.log(`Date:    ${formatDate(session.startedAt)}`)
    console.log(`UUID:    ${session.sessionUuid}`)
    console.log(`Messages: ${session.messageCount}`)
    console.log('')
    console.log('─'.repeat(60))

    for (const msg of messages) {
      const role = msg.role.toUpperCase().padEnd(9)
      console.log(`\n[${role}] ${formatDate(msg.timestamp)}`)
      if (msg.toolNames.length > 0) {
        console.log(`Tools: ${msg.toolNames.join(', ')}`)
      }
      console.log(msg.contentText || '(empty)')
    }
  })

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleString() } catch { return iso }
}
