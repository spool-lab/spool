import { Command } from 'commander'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { downloadAndInstall, TrustStore } from '@spool/core'
import * as readline from 'node:readline'

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
      console.log('Restart the Spool app to activate.')
    } catch (err) {
      console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  })

export const connectorCommand = new Command('connector')
  .description('Manage connector plugins')
  .addCommand(installSubcommand)

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y')
    })
  })
}
