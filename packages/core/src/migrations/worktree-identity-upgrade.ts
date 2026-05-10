import type Database from 'better-sqlite3'
import { computeIdentity, type IdentityFs } from '../projects/identity.js'

/**
 * v10 data migration: re-classify historical `path`-kind project rows whose
 * `identity_key` is a worktree path that has since been deleted.
 *
 * Before the worktree resolvers landed, a session synced AFTER its worktree
 * was torn down had no way to recover its upstream remote — `computeIdentity`
 * would walk up looking for `.git`, find nothing (the worktree was gone),
 * and fall through to `path` kind. That created an orphan project per
 * deleted worktree, even when the user had a perfectly good `spool` project
 * already grouped under `git_remote: github.com/spool-lab/spool`.
 *
 * This migration re-runs `computeIdentity` against the stored `identity_key`.
 * The resolver chain (default: superset) now reads the worktree tool's
 * persistent registry to find the upstream main-repo path, runs git on it,
 * and returns a real `git_remote` / `git_common_dir` identity. Same identity
 * tuple as the parent project → `project_groups_v` collapses them into one
 * row in the sidebar without any explicit row merging.
 *
 * Idempotent: re-running sees no `path`-kind candidates that resolve to a
 * different identity, so it's a no-op on the second pass. Rows that still
 * fail to resolve (e.g. genuine ad-hoc paths, or worktree tools we don't
 * have a resolver for yet) stay untouched.
 */

export interface WorktreeUpgradeResult {
  examined: number
  upgraded: number
}

export function upgradeWorktreeIdentities(
  db: Database.Database,
  fs: IdentityFs,
): WorktreeUpgradeResult {
  const rows = db.prepare(
    `SELECT id, identity_key FROM projects WHERE identity_kind = 'path'`,
  ).all() as Array<{ id: number; identity_key: string }>

  if (rows.length === 0) return { examined: 0, upgraded: 0 }

  const update = db.prepare(
    `UPDATE projects
     SET identity_kind = ?, identity_key = ?, display_name = ?
     WHERE id = ?`,
  )

  let upgraded = 0
  for (const row of rows) {
    const id = computeIdentity(row.identity_key, fs)
    // Only upgrade when the resolver produced something stronger than path.
    // (`loose` shouldn't happen here since we feed it a real cwd, but skip
    // defensively to avoid demoting rows.)
    if (id.kind === 'path' || id.kind === 'loose') continue
    update.run(id.kind, id.key, id.displayName, row.id)
    upgraded += 1
  }

  return { examined: rows.length, upgraded }
}
