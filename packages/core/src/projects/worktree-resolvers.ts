import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

// Resolve home at call time (not module load) so tests can redirect via
// process.env.HOME. node:os.homedir() reads the OS user info on POSIX and
// ignores HOME, hence the explicit check first.
function getHome(): string {
  return process.env['HOME'] || homedir()
}

/**
 * Recovers the upstream main-repo path of a worktree session whose `cwd`
 * has already been deleted at sync time. This is the only signal that lets
 * Spool group such sessions under their real project — Claude Code's JSONL
 * carries `cwd` and `gitBranch` but no remote URL.
 *
 * Each implementation reads a worktree-tool-specific persistent store. If
 * the store is missing or the cwd doesn't match anything, return null and
 * the next resolver in the chain (or the existing path-kind fallback) wins.
 */
export interface WorktreeUpstreamResolver {
  name: string
  resolve(cwd: string): string | null
}

function supersetDbPath(): string { return join(getHome(), '.superset', 'local.db') }
function supersetDefaultBase(): string { return join(getHome(), '.superset', 'worktrees') }

interface SupersetProjectRow {
  name: string
  main_repo_path: string
  worktree_base_dir: string | null
}

let _supersetCache: { projects: SupersetProjectRow[]; globalBase: string } | null = null

function loadSupersetProjects(): { projects: SupersetProjectRow[]; globalBase: string } | null {
  if (_supersetCache) return _supersetCache
  const dbPath = supersetDbPath()
  if (!existsSync(dbPath)) return null

  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })

    const settings = db.prepare(
      `SELECT worktree_base_dir FROM settings WHERE id = 1`,
    ).get() as { worktree_base_dir: string | null } | undefined
    const globalBase = settings?.worktree_base_dir || supersetDefaultBase()

    const projects = db.prepare(
      `SELECT name, main_repo_path, worktree_base_dir FROM projects`,
    ).all() as SupersetProjectRow[]

    _supersetCache = { projects, globalBase }
    return _supersetCache
  } catch {
    return null
  } finally {
    try { db?.close() } catch { /* ignore */ }
  }
}

/** Test hook: reset the in-process cache so tests can stub the DB. */
export function _resetSupersetCacheForTests(): void {
  _supersetCache = null
}

export const supersetResolver: WorktreeUpstreamResolver = {
  name: 'superset',
  resolve(cwd: string): string | null {
    const data = loadSupersetProjects()
    if (!data) return null
    for (const p of data.projects) {
      if (!p.main_repo_path) continue
      const base = p.worktree_base_dir || data.globalBase
      // Convention enforced by superset: <base>/<project-name>/<branch>
      const projectDir = join(base, p.name)
      if (cwd === projectDir || cwd.startsWith(projectDir + '/')) {
        return p.main_repo_path
      }
    }
    return null
  },
}

export const DEFAULT_RESOLVERS: readonly WorktreeUpstreamResolver[] = Object.freeze([
  supersetResolver,
])
