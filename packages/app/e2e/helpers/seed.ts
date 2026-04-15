import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

export interface SeedCapture {
  platform: string
  platformId: string
  title: string
  url: string
  content?: string
  connectorId: string
  author?: string
}

/**
 * Insert a capture + its M:N attribution directly into the DB. Uses the
 * sqlite3 CLI (preinstalled on macOS and ubuntu-latest) instead of better-
 * sqlite3, so the test process doesn't need a node-ABI native binding when
 * the app is built against the electron ABI.
 *
 * Safe to call after `waitForSync` — the app opens WAL-mode, which allows
 * a second writer without locking issues for a handful of rows.
 */
export function seedCapture(dbPath: string, capture: SeedCapture): void {
  const captureUuid = randomUUID()
  const sql = `
    INSERT INTO captures
      (source_id, capture_uuid, url, title, content_text, author,
       platform, platform_id, content_type, thumbnail_url, metadata,
       captured_at, raw_json)
    VALUES (
      (SELECT id FROM sources WHERE name = 'connector'),
      '${captureUuid}',
      '${sqlEscape(capture.url)}',
      '${sqlEscape(capture.title)}',
      '${sqlEscape(capture.content ?? capture.title)}',
      ${capture.author ? `'${sqlEscape(capture.author)}'` : 'NULL'},
      '${sqlEscape(capture.platform)}',
      '${sqlEscape(capture.platformId)}',
      'post', NULL, '{}',
      datetime('now'), NULL
    );
    INSERT OR IGNORE INTO capture_connectors (capture_id, connector_id)
    VALUES (last_insert_rowid(), '${sqlEscape(capture.connectorId)}');
  `
  execFileSync('sqlite3', [dbPath, sql], { stdio: 'pipe' })
}

function sqlEscape(value: string): string {
  return value.replace(/'/g, "''")
}
