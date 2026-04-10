import Database from 'better-sqlite3'
import { saveSyncState } from './sync-engine.js'
import type { SyncState } from './types.js'
import type { CapturedItem } from '../types.js'

export function createTestDB(): InstanceType<typeof Database> {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE sources (
      id        INTEGER PRIMARY KEY,
      name      TEXT NOT NULL UNIQUE,
      base_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO sources (name, base_path) VALUES ('claude', '~/.claude/projects');

    CREATE TABLE captures (
      id              INTEGER PRIMARY KEY,
      source_id       INTEGER NOT NULL REFERENCES sources(id),
      capture_uuid    TEXT NOT NULL UNIQUE,
      url             TEXT NOT NULL,
      title           TEXT NOT NULL DEFAULT '',
      content_text    TEXT NOT NULL DEFAULT '',
      author          TEXT,
      platform        TEXT NOT NULL,
      platform_id     TEXT,
      content_type    TEXT NOT NULL DEFAULT 'page',
      thumbnail_url   TEXT,
      metadata        TEXT NOT NULL DEFAULT '{}',
      captured_at     TEXT NOT NULL,
      indexed_at      TEXT NOT NULL DEFAULT (datetime('now')),
      raw_json        TEXT
    );

    CREATE TABLE connector_sync_state (
      connector_id        TEXT PRIMARY KEY,
      head_cursor         TEXT,
      head_item_id        TEXT,
      tail_cursor         TEXT,
      tail_complete       INTEGER NOT NULL DEFAULT 0,
      last_forward_sync_at  TEXT,
      last_backfill_sync_at TEXT,
      total_synced        INTEGER NOT NULL DEFAULT 0,
      consecutive_errors  INTEGER NOT NULL DEFAULT 0,
      enabled             INTEGER NOT NULL DEFAULT 1,
      config_json         TEXT NOT NULL DEFAULT '{}',
      last_error_at       TEXT,
      last_error_code     TEXT,
      last_error_message  TEXT
    );
  `)
  return db
}

export function makeItem(platformId: string): CapturedItem {
  return {
    url: `https://example.com/${platformId}`,
    title: `Item ${platformId}`,
    contentText: `Content for ${platformId}`,
    author: null,
    platform: 'test',
    platformId,
    contentType: 'post',
    thumbnailUrl: null,
    metadata: {},
    capturedAt: new Date().toISOString(),
    rawJson: null,
  }
}

export function setState(db: InstanceType<typeof Database>, partial: Partial<SyncState> & { connectorId: string }): void {
  const { connectorId, ...rest } = partial
  const state: SyncState = {
    connectorId,
    headCursor: null,
    headItemId: null,
    tailCursor: null,
    tailComplete: false,
    lastForwardSyncAt: null,
    lastBackfillSyncAt: null,
    totalSynced: 0,
    consecutiveErrors: 0,
    enabled: true,
    configJson: {},
    lastErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    ...rest,
  }
  saveSyncState(db, state)
}

export function countCaptures(db: InstanceType<typeof Database>): number {
  return (db.prepare('SELECT COUNT(*) as c FROM captures').get() as { c: number }).c
}
