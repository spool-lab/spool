import type { SqliteDatabase } from '@spool/connector-sdk'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_DB_PATH = join(
  homedir(),
  'Library',
  'Application Support',
  'Typeless',
  'typeless.db',
)

export const PAGE_SIZE = 25

export interface TypelessRow {
  id: string
  refined_text: string | null
  edited_text: string | null
  status: string
  mode: string | null
  duration: number | null
  detected_language: string | null
  audio_local_path: string | null
  focused_app_name: string | null
  focused_app_bundle_id: string | null
  focused_app_window_title: string | null
  focused_app_window_web_url: string | null
  focused_app_window_web_domain: string | null
  focused_app_window_web_title: string | null
  created_at: string
}

const SELECT_COLS = `
  id, refined_text, edited_text, status, mode, duration, detected_language,
  audio_local_path, focused_app_name, focused_app_bundle_id,
  focused_app_window_title, focused_app_window_web_url,
  focused_app_window_web_domain, focused_app_window_web_title, created_at
`

const WHERE_TRANSCRIBED = `
  status = 'transcript'
  AND refined_text IS NOT NULL
  AND refined_text != ''
`

export function fetchTranscriptPage(
  db: SqliteDatabase,
  cursor: string | null,
): TypelessRow[] {
  if (cursor === null) {
    return db
      .prepare<TypelessRow>(
        `SELECT ${SELECT_COLS} FROM history
         WHERE ${WHERE_TRANSCRIBED}
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(PAGE_SIZE)
  }

  return db
    .prepare<TypelessRow>(
      `SELECT ${SELECT_COLS} FROM history
       WHERE ${WHERE_TRANSCRIBED}
         AND created_at < ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(cursor, PAGE_SIZE)
}
