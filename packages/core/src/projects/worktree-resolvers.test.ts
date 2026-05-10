import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { supersetResolver, _resetSupersetCacheForTests } from './worktree-resolvers.js'

let tmpHome: string
const originalHome = process.env['HOME']

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'spool-superset-test-'))
  process.env['HOME'] = tmpHome
  mkdirSync(join(tmpHome, '.superset'), { recursive: true })
  _resetSupersetCacheForTests()
})

afterEach(() => {
  if (originalHome) process.env['HOME'] = originalHome
  else delete process.env['HOME']
  try { rmSync(tmpHome, { recursive: true, force: true }) } catch { /* ignore */ }
  _resetSupersetCacheForTests()
})

function supersetDbPath() { return join(tmpHome, '.superset', 'local.db') }

function createSupersetSchema(): Database.Database {
  const db = new Database(supersetDbPath())
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      main_repo_path TEXT NOT NULL,
      name TEXT NOT NULL,
      worktree_base_dir TEXT
    );
    CREATE TABLE settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      worktree_base_dir TEXT
    );
  `)
  return db
}

describe('supersetResolver', () => {
  it('returns null when superset DB is absent', () => {
    expect(supersetResolver.resolve('/some/path')).toBeNull()
  })

  it('matches a worktree under the default base dir', () => {
    const db = createSupersetSchema()
    db.prepare(
      `INSERT INTO projects (id, main_repo_path, name, worktree_base_dir) VALUES (?, ?, ?, ?)`,
    ).run('proj1', '/Users/me/github/spool', 'spool', null)
    db.close()

    const cwd = join(tmpHome, '.superset', 'worktrees', 'spool', 'feat-branch')
    expect(supersetResolver.resolve(cwd)).toBe('/Users/me/github/spool')
  })

  it('matches when project has a custom worktree_base_dir', () => {
    const db = createSupersetSchema()
    db.prepare(
      `INSERT INTO projects (id, main_repo_path, name, worktree_base_dir) VALUES (?, ?, ?, ?)`,
    ).run('proj1', '/repos/customproj', 'customproj', '/custom/wt-base')
    db.close()

    expect(supersetResolver.resolve('/custom/wt-base/customproj/branch-x'))
      .toBe('/repos/customproj')
  })

  it('falls back to global settings worktree_base_dir', () => {
    const db = createSupersetSchema()
    db.prepare(
      `INSERT INTO projects (id, main_repo_path, name, worktree_base_dir) VALUES (?, ?, ?, ?)`,
    ).run('proj1', '/repos/p', 'p', null)
    db.prepare(
      `INSERT INTO settings (id, worktree_base_dir) VALUES (1, ?)`,
    ).run('/global/wts')
    db.close()

    expect(supersetResolver.resolve('/global/wts/p/branch')).toBe('/repos/p')
  })

  it('returns null when cwd does not match any project convention', () => {
    const db = createSupersetSchema()
    db.prepare(
      `INSERT INTO projects (id, main_repo_path, name, worktree_base_dir) VALUES (?, ?, ?, ?)`,
    ).run('proj1', '/repos/spool', 'spool', null)
    db.close()

    const cwd = join(tmpHome, '.superset', 'worktrees', 'unknown-project', 'branch')
    expect(supersetResolver.resolve(cwd)).toBeNull()
  })

  it('does not match when project name is only a string prefix', () => {
    // "spool-foo" must not be matched by project name "spool" — the path
    // segment boundary is required.
    const db = createSupersetSchema()
    db.prepare(
      `INSERT INTO projects (id, main_repo_path, name, worktree_base_dir) VALUES (?, ?, ?, ?)`,
    ).run('proj1', '/repos/spool', 'spool', null)
    db.close()

    const cwd = join(tmpHome, '.superset', 'worktrees', 'spool-foo', 'branch')
    expect(supersetResolver.resolve(cwd)).toBeNull()
  })

  it('returns null gracefully on malformed schema', () => {
    const db = new Database(supersetDbPath())
    db.exec(`CREATE TABLE projects (id TEXT)`)  // missing required columns
    db.close()

    expect(supersetResolver.resolve('/anything')).toBeNull()
  })
})
