import { statSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type Database from 'better-sqlite3'
import { parseClaudeSession, decodeProjectSlug } from '../parsers/claude.js'
import { parseCodexSession } from '../parsers/codex.js'
import { getSessionRoots } from './source-paths.js'
import {
  getSourceId,
  getOrCreateProject,
  getSessionMtime,
  getAllSessionMtimes,
  upsertSession,
  insertMessages,
} from '../db/queries.js'
import type { SyncResult } from '../types.js'

export interface SyncProgressEvent {
  phase: 'scanning' | 'syncing' | 'indexing' | 'done'
  count: number
  total: number
}

export type SyncEventCallback = (event: SyncProgressEvent) => void

export class Syncer {
  private db: Database.Database
  private onProgress: SyncEventCallback | undefined
  private codexTitleIndex: Map<string, string> = new Map()

  constructor(db: Database.Database, onProgress?: SyncEventCallback) {
    this.db = db
    this.onProgress = onProgress
  }

  syncAll(): SyncResult {
    const seenPaths = new Set<string>()
    const files: Array<{ path: string; source: 'claude' | 'codex' }> = []

    for (const dir of getSessionRoots('claude')) {
      try { addUniqueFiles(files, seenPaths, collectJSONL(dir, 'claude')) } catch { /* dir may not exist */ }
    }
    for (const dir of getSessionRoots('codex')) {
      try { addUniqueFiles(files, seenPaths, collectJSONL(dir, 'codex')) } catch { /* dir may not exist */ }
    }

    this.onProgress?.({ phase: 'scanning', count: 0, total: files.length })

    const knownMtimes = getAllSessionMtimes(this.db)
    this.codexTitleIndex = loadCodexSessionIndex()

    // Count how many files actually need syncing (no mtime match)
    const needsSync = files.filter(f => {
      const existing = knownMtimes.get(f.path)
      if (!existing) return true
      try { return existing !== getMtime(f.path) } catch { return false }
    })
    const isBulk = needsSync.length > 100

    // For bulk syncs (e.g. first launch), drop FTS triggers and rebuild at the end.
    // FTS5 segment merges on per-row triggers cause significant write amplification;
    // a single rebuild after all inserts is ~3x faster.
    if (isBulk) {
      this.db.exec('DROP TRIGGER IF EXISTS messages_fts_insert')
      this.db.exec('DROP TRIGGER IF EXISTS messages_fts_delete')
    }

    let added = 0
    let updated = 0
    let errors = 0

    try {
      const BATCH = 20
      for (let i = 0; i < files.length; i += BATCH) {
        const batch = files.slice(i, i + BATCH)
        for (const file of batch) {
          const result = this.syncFile(file.path, file.source, knownMtimes)
          if (result === 'added') added++
          else if (result === 'updated') updated++
          else if (result === 'error') errors++
        }
        this.onProgress?.({ phase: 'syncing', count: Math.min(i + BATCH, files.length), total: files.length })
      }

      this.applyCodexTitles()
    } finally {
      if (isBulk) {
        this.onProgress?.({ phase: 'indexing', count: 0, total: 0 })
        this.db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')")
        this.db.exec(`
          CREATE TRIGGER IF NOT EXISTS messages_fts_insert
          AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts(rowid, content_text) VALUES(NEW.id, NEW.content_text);
          END
        `)
        this.db.exec(`
          CREATE TRIGGER IF NOT EXISTS messages_fts_delete
          AFTER DELETE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content_text)
              VALUES('delete', OLD.id, OLD.content_text);
          END
        `)
      }
    }

    this.onProgress?.({ phase: 'done', count: files.length, total: files.length })
    return { added, updated, errors }
  }

  private applyCodexTitles(): void {
    if (this.codexTitleIndex.size === 0) return
    const stmt = this.db.prepare(
      'UPDATE sessions SET title = ? WHERE session_uuid = ? AND title != ?',
    )
    this.db.transaction(() => {
      for (const [uuid, title] of this.codexTitleIndex) {
        stmt.run(title, uuid, title)
      }
    })()
  }

  syncFile(filePath: string, source: 'claude' | 'codex', knownMtimes?: Map<string, string>): 'added' | 'updated' | 'skipped' | 'error' {
    try {
      const mtime = getMtime(filePath)
      const existingMtime = knownMtimes
        ? (knownMtimes.get(filePath) ?? null)
        : getSessionMtime(this.db, filePath)
      if (existingMtime === mtime) return 'skipped'

      const parsed = source === 'claude'
        ? parseClaudeSession(filePath)
        : parseCodexSession(filePath)

      if (!parsed) return 'skipped'

      if (source === 'codex') {
        const codexTitle = this.codexTitleIndex.get(parsed.sessionUuid)
        if (codexTitle) parsed.title = codexTitle
      }

      const sourceId = getSourceId(this.db, source)
      const { slug, displayPath, displayName } = resolveProject(filePath, source, parsed.cwd)
      const projectId = getOrCreateProject(this.db, sourceId, slug, displayPath, displayName)

      const isNew = existingMtime === null
      const hasToolUse = parsed.messages.some(m => m.toolNames.length > 0)

      this.db.transaction(() => {
        const sessionId = upsertSession(this.db, {
          projectId,
          sourceId,
          sessionUuid: parsed.sessionUuid,
          filePath,
          title: parsed.title,
          startedAt: parsed.startedAt,
          endedAt: parsed.endedAt,
          messageCount: parsed.messages.filter(m => !m.isSidechain).length,
          hasToolUse,
          cwd: parsed.cwd,
          model: parsed.model,
          rawFileMtime: mtime,
        })

        insertMessages(this.db, sessionId, sourceId, parsed.messages)

        this.db.prepare(`
          INSERT INTO sync_log (source_id, file_path, status)
          VALUES (?, ?, 'ok')
        `).run(sourceId, filePath)
      })()
      return isNew ? 'added' : 'updated'
    } catch (err) {
      try {
        const sourceRow = this.db
          .prepare('SELECT id FROM sources WHERE name = ?')
          .get(source) as { id: number } | undefined
        if (sourceRow) {
          this.db.prepare(`
            INSERT INTO sync_log (source_id, file_path, status, message)
            VALUES (?, ?, 'error', ?)
          `).run(sourceRow.id, filePath, String(err))
        }
      } catch { /* ignore log errors */ }
      return 'error'
    }
  }
}

function addUniqueFiles(
  files: Array<{ path: string; source: 'claude' | 'codex' }>,
  seenPaths: Set<string>,
  candidates: Array<{ path: string; source: 'claude' | 'codex' }>,
): void {
  for (const candidate of candidates) {
    if (seenPaths.has(candidate.path)) continue
    seenPaths.add(candidate.path)
    files.push(candidate)
  }
}

function getMtime(filePath: string): string {
  return statSync(filePath).mtime.toISOString()
}

function collectJSONL(
  dir: string,
  source: 'claude' | 'codex',
): Array<{ path: string; source: 'claude' | 'codex' }> {
  const results: Array<{ path: string; source: 'claude' | 'codex' }> = []
  walkDir(dir, results, source)
  return results
}

function walkDir(
  dir: string,
  results: Array<{ path: string; source: 'claude' | 'codex' }>,
  source: 'claude' | 'codex',
): void {
  let entries: import('node:fs').Dirent<string>[]
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkDir(fullPath, results, source)
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      results.push({ path: fullPath, source })
    }
  }
}

function loadCodexSessionIndex(): Map<string, string> {
  const titles = new Map<string, string>()
  try {
    const raw = readFileSync(join(homedir(), '.codex', 'session_index.jsonl'), 'utf8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const rec = JSON.parse(line) as { id?: string; thread_name?: string }
        if (rec.id && rec.thread_name) titles.set(rec.id, rec.thread_name)
      } catch { /* skip malformed lines */ }
    }
  } catch { /* file may not exist */ }
  return titles
}

function resolveProject(
  filePath: string,
  source: 'claude' | 'codex',
  cwd: string,
): { slug: string; displayPath: string; displayName: string } {
  const home = homedir()

  if (source === 'claude') {
    // ~/.claude/projects/{slug}/{uuid}.jsonl
    const slug = basename(dirname(filePath))
    const displayPath = cwd || decodeProjectSlug(slug)
    const parts = displayPath.split('/').filter(Boolean)
    const displayName = parts[parts.length - 1] ?? slug
    return { slug, displayPath, displayName }
  } else {
    // ~/.codex/sessions/{YYYY}/{MM}/{DD}/rollout-...jsonl
    // Group by cwd (project working dir)
    const displayPath = cwd || home
    const parts = displayPath.split('/').filter(Boolean)
    const displayName = parts[parts.length - 1] ?? 'codex'
    const slug = displayPath.replace(/^\//, '').replace(/\//g, '-') || 'default'
    return { slug, displayPath, displayName }
  }
}
