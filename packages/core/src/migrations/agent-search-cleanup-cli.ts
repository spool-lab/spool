#!/usr/bin/env node
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { getDB, DB_PATH } from '../db/db.js'
import {
  applyMigration,
  computeMigrationPlan,
  formatPlanReport,
  getProjectLabels,
} from './agent-search-cleanup.js'

function parseArgs(argv: string[]): { apply: boolean; help: boolean } {
  const args = new Set(argv.slice(2))
  return {
    apply: args.has('--apply'),
    help: args.has('--help') || args.has('-h'),
  }
}

function backup(db: import('better-sqlite3').Database): string {
  const dir = join(dirname(DB_PATH), 'backups')
  mkdirSync(dir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const path = join(dir, `spool-pre-agent-search-cleanup-${ts}.db`)
  db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`)
  return path
}

function main(): void {
  const opts = parseArgs(process.argv)
  if (opts.help) {
    console.log(`Usage: agent-search-cleanup [--apply]

Rewrites historical agent-search sessions:
  - moves them out of the synthetic project they were placed under
  - sets the title to the user's actual query (extracted from the stored Spool prompt blob)
  - sets title_source='spool' so future sync won't overwrite the title
  - deletes any project that becomes empty as a result

Default mode is dry-run; pass --apply to execute. A backup of the DB is written
to ~/.spool/backups/ before any change is made.
`)
    return
  }

  const db = getDB()
  const plan = computeMigrationPlan(db)
  const labels = getProjectLabels(db, plan.affectedProjects.keys())

  console.log(formatPlanReport(plan, labels))
  console.log('')

  if (plan.candidates.length === 0) {
    console.log('Nothing to do.')
    return
  }

  if (!opts.apply) {
    console.log('Dry run — pass --apply to execute. Backup will be written first.')
    return
  }

  const backupPath = backup(db)
  console.log(`Backup written: ${backupPath}`)

  const result = db.transaction(() => applyMigration(db, plan))()
  console.log('')
  console.log(`Done. ${result.sessionsTouched} session(s) touched: ${result.sessionsTitleUpdated} title-updated, ${result.sessionsExtractionFailed} extraction-failed (project+title_source still updated).`)
  if (result.projectsDeleted.length > 0) {
    console.log(`Deleted ${result.projectsDeleted.length} now-empty project(s): ${result.projectsDeleted.join(', ')}`)
  }
}

main()
