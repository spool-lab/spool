import type {
  Connector,
  ConnectorCapabilities,
  AuthStatus,
  PageResult,
  FetchContext,
  CapturedItem,
} from '@spool/connector-sdk'
import { SyncError, SyncErrorCode } from '@spool/connector-sdk'
import {
  fetchTranscriptPage,
  DEFAULT_DB_PATH,
  PAGE_SIZE,
  type TypelessRow,
} from './db-reader.js'

export default class TypelessConnector implements Connector {
  readonly id = 'typeless'
  readonly platform = 'typeless'
  readonly label = 'Typeless Voice'
  readonly description = 'Your voice transcripts from Typeless'
  readonly color = '#1D1A1A'
  readonly ephemeral = false

  private readonly dbPath: string

  constructor(
    private readonly caps: ConnectorCapabilities,
    opts?: { dbPath?: string },
  ) {
    this.dbPath = opts?.dbPath ?? DEFAULT_DB_PATH
  }

  async checkAuth(): Promise<AuthStatus> {
    try {
      const db = this.caps.sqlite.openReadonly(this.dbPath)
      db.close()
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        error: SyncErrorCode.CONNECTOR_ERROR,
        message: err instanceof Error ? err.message : String(err),
        hint: 'Typeless not found. Install Typeless (typeless.com), record at least once, then retry.',
      }
    }
  }

  async fetchPage(ctx: FetchContext): Promise<PageResult> {
    let db: ReturnType<typeof this.caps.sqlite.openReadonly> | null = null
    try {
      db = this.caps.sqlite.openReadonly(this.dbPath)
      const rows = fetchTranscriptPage(db, ctx.cursor)
      const items = rows.map(rowToCapturedItem)
      const nextCursor =
        rows.length === PAGE_SIZE ? (rows[rows.length - 1]?.created_at ?? null) : null
      return { items, nextCursor }
    } catch (err) {
      if (err instanceof SyncError) throw err
      throw new SyncError(
        SyncErrorCode.CONNECTOR_ERROR,
        err instanceof Error ? err.message : String(err),
      )
    } finally {
      db?.close()
    }
  }
}

function rowToCapturedItem(row: TypelessRow): CapturedItem {
  const transcript = (row.edited_text?.trim() || row.refined_text?.trim()) ?? ''

  const contextParts: string[] = []
  if (row.focused_app_name) contextParts.push(row.focused_app_name)
  if (row.focused_app_window_title) contextParts.push(row.focused_app_window_title)
  if (row.focused_app_window_web_domain) contextParts.push(row.focused_app_window_web_domain)
  if (row.focused_app_window_web_title) contextParts.push(row.focused_app_window_web_title)

  const contentText =
    contextParts.length > 0
      ? `${transcript}\n${contextParts.join(' · ')}`
      : transcript

  const title =
    transcript.length > 80 ? `${transcript.slice(0, 80)}…` : transcript

  const url = row.audio_local_path
    ? `file://${row.audio_local_path}`
    : `typeless://transcript/${row.id}`

  return {
    url,
    title,
    contentText,
    author: null,
    platform: 'typeless',
    platformId: row.id,
    contentType: row.mode ?? 'voice_transcript',
    thumbnailUrl: null,
    metadata: {
      duration: row.duration,
      detected_language: row.detected_language,
      focused_app: row.focused_app_name,
      focused_app_bundle_id: row.focused_app_bundle_id,
      focused_app_window_title: row.focused_app_window_title,
      focused_app_window_web_url: row.focused_app_window_web_url,
      focused_app_window_web_domain: row.focused_app_window_web_domain,
    },
    capturedAt: row.created_at,
    rawJson: JSON.stringify(row),
  }
}
