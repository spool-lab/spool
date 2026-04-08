export type Source = 'claude' | 'codex'

export interface ParsedMessage {
  uuid: string
  parentUuid: string | null
  role: 'user' | 'assistant' | 'system'
  contentText: string
  timestamp: string
  isSidechain: boolean
  toolNames: string[]
  seq: number
}

export interface ParsedSession {
  source: Source
  sessionUuid: string
  filePath: string
  title: string
  cwd: string
  model: string
  startedAt: string
  endedAt: string
  messages: ParsedMessage[]
}

export interface Session {
  id: number
  projectId: number
  sourceId: number
  sessionUuid: string
  filePath: string
  title: string | null
  startedAt: string
  endedAt: string
  messageCount: number
  hasToolUse: boolean
  cwd: string | null
  model: string | null
  source: Source
  projectDisplayPath: string
  projectDisplayName: string
}

export interface Message {
  id: number
  sessionId: number
  msgUuid: string | null
  parentUuid: string | null
  role: 'user' | 'assistant' | 'system'
  contentText: string
  timestamp: string
  isSidechain: boolean
  toolNames: string[]
  seq: number
}

export interface FragmentResult {
  rank: number
  sessionId: number
  sessionUuid: string
  sessionTitle: string
  source: Source
  profileLabel?: string
  cwd?: string
  project: string
  startedAt: string
  snippet: string
  messageId: number
  messageRole: string
  messageTimestamp: string
}

export interface StatusInfo {
  dbPath: string
  totalSessions: number
  claudeSessions: number
  codexSessions: number
  lastSyncedAt: string | null
  dbSizeBytes: number
}

export interface SyncResult {
  added: number
  updated: number
  errors: number
}

// ── Capture Types ────────────────────────────────────────────────────────────

export interface CaptureResult {
  rank: number
  captureId: number
  captureUuid: string
  url: string
  title: string
  snippet: string
  platform: string
  contentType: string
  author: string | null
  capturedAt: string
}

export interface CapturedItem {
  url: string
  title: string
  contentText: string
  author: string | null
  platform: string
  platformId: string | null
  contentType: string
  thumbnailUrl: string | null
  metadata: Record<string, unknown>
  capturedAt: string
  rawJson: string | null
}

export type SearchResult =
  | (FragmentResult & { kind: 'fragment' })
  | (CaptureResult & { kind: 'capture' })
