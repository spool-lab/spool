export type SessionSource = 'claude' | 'codex' | 'gemini'
export type Source = SessionSource
export type SearchMatchType = 'fts' | 'phrase' | 'all_terms'

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
  source: SessionSource
  sessionUuid: string
  filePath: string
  title: string
  cwd: string
  model: string
  startedAt: string
  endedAt: string
  messages: ParsedMessage[]
}

export type ParseSessionResult =
  | { kind: 'parsed'; session: ParsedSession }
  | { kind: 'filtered' }
  | { kind: 'skipped' }

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
  source: SessionSource
  projectDisplayPath: string
  projectDisplayName: string
}

export type ProjectIdentityKind =
  | 'git_remote'
  | 'git_common_dir'
  | 'manifest_path'
  | 'path'
  | 'loose'

export interface ProjectIdentity {
  kind: ProjectIdentityKind
  key: string                       // normalized origin URL / abs path / 'loose'
  displayName: string
}

export interface ProjectGroup {
  identityKind: ProjectIdentityKind
  identityKey: string
  displayName: string
  sources: SessionSource[]          // unique sources contributing
  sessionCount: number
  lastSessionAt: string | null
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
  matchCount: number
  matchType: SearchMatchType
  source: SessionSource
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
  geminiSessions: number
  lastSyncedAt: string | null
  dbSizeBytes: number
}

export interface SyncResult {
  added: number
  updated: number
  errors: number
}

// ── Search ──────────────────────────────────────────────────────────────────

export type SearchResult = FragmentResult & { kind: 'fragment' }

// ── Stars ──────────────────────────────────────────────────────────────────

export type StarKind = 'session'

export type StarredItem = { kind: 'session'; starredAt: string; session: Session }
