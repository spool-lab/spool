import { contextBridge, ipcRenderer } from 'electron'
import type { FragmentResult, Session, Message, StatusInfo, SyncResult, SearchResult, ProjectGroup, ListSessionsByIdentityOptions } from '@spool-lab/core'
import type { SearchSortOrder } from '../shared/searchSort.js'
import type { ThemeEditorStateV1 } from '../renderer/theme/editorTypes.js'

export interface AgentInfo {
  id: string
  name: string
  path: string
  status: 'ready' | 'not_found' | 'not_running'
  acpMode: 'extension' | 'native' | 'websocket' | 'sdk'
}

export interface BuiltinAgent {
  name: string
  bin: string
  acpMode: 'extension' | 'native' | 'websocket' | 'sdk'
}

export interface SdkAgentConfig {
  apiKey?: string | undefined
  model?: string | undefined
  baseURL?: string | undefined
}

export interface AgentsConfig {
  defaultAgent?: string
  defaultSearchSort?: SearchSortOrder
  terminal?: string
  sidebarShowSourceDots?: boolean
  sidebarShowSessionCount?: boolean
  sdkAgent?: SdkAgentConfig
  customAgents?: Record<string, {
    name?: string
    bin: string
    acpMode: 'extension' | 'native' | 'websocket'
    acpArgs?: string[]
    wsEndpoint?: string
    healthCheck?: string
  }>
}

export type SpoolAPI = typeof api

const api = {
  search: (query: string, limit?: number, source?: string, onlyPinned?: boolean, identityKey?: string): Promise<SearchResult[]> =>
    ipcRenderer.invoke('spool:search', { query, limit, source, onlyPinned, identityKey }),

  searchPreview: (query: string, limit?: number, source?: string): Promise<SearchResult[]> =>
    ipcRenderer.invoke('spool:search-preview', { query, limit, source }),

  listSessions: (limit?: number): Promise<Session[]> =>
    ipcRenderer.invoke('spool:list-sessions', { limit }),

  listProjectGroups: (): Promise<ProjectGroup[]> =>
    ipcRenderer.invoke('spool:list-project-groups'),

  listSessionsByIdentity: (identityKey: string, options?: ListSessionsByIdentityOptions): Promise<Session[]> =>
    ipcRenderer.invoke('spool:list-sessions-by-identity', { identityKey, options }),

  getSession: (sessionUuid: string): Promise<{ session: Session; messages: Message[] } | null> =>
    ipcRenderer.invoke('spool:get-session', { sessionUuid }),

  getStatus: (): Promise<StatusInfo> =>
    ipcRenderer.invoke('spool:get-status'),

  pinSession: (uuid: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:pin-session', { uuid }),

  unpinSession: (uuid: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:unpin-session', { uuid }),

  getPinnedUuids: (): Promise<string[]> =>
    ipcRenderer.invoke('spool:get-pinned-uuids'),

  listPinnedSessions: (): Promise<Session[]> =>
    ipcRenderer.invoke('spool:list-pinned-sessions'),

  listPinnedSessionsByIdentity: (identityKey: string): Promise<Session[]> =>
    ipcRenderer.invoke('spool:list-pinned-sessions-by-identity', { identityKey }),

  getRuntimeInfo: (): Promise<{ isDev: boolean; appPath: string; appName: string }> =>
    ipcRenderer.invoke('spool:get-runtime-info'),

  syncNow: (): Promise<SyncResult> =>
    ipcRenderer.invoke('spool:sync-now'),

  resumeCLI: (sessionUuid: string, source: string, cwd?: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('spool:resume-cli', { sessionUuid, source, cwd }),

  copyFragment: (text: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:copy-fragment', { text }),

  // AI / ACP
  getAiAgents: (): Promise<AgentInfo[]> =>
    ipcRenderer.invoke('spool:ai-agents'),

  getBuiltinAgents: (): Promise<Record<string, BuiltinAgent>> =>
    ipcRenderer.invoke('spool:ai-builtin-agents'),

  getAgentsConfig: (): Promise<AgentsConfig> =>
    ipcRenderer.invoke('spool:ai-get-config'),

  setAgentsConfig: (config: AgentsConfig): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:ai-set-config', { config }),

  aiSearch: (query: string, agentId: string, context: FragmentResult[]): Promise<{ ok: boolean; fullText?: string; error?: string }> =>
    ipcRenderer.invoke('spool:ai-search', { query, agentId, context }),

  aiCancel: (agentId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:ai-cancel', { agentId }),

  onAiChunk: (cb: (data: { text: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as { text: string })
    ipcRenderer.on('spool:ai-chunk', handler)
    return () => ipcRenderer.removeListener('spool:ai-chunk', handler)
  },

  onAiDone: (cb: (data: { fullText: string; error?: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as { fullText: string; error?: string })
    ipcRenderer.on('spool:ai-done', handler)
    return () => ipcRenderer.removeListener('spool:ai-done', handler)
  },

  onAiToolCall: (cb: (data: { toolCallId: string; title: string; status: string; kind?: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as { toolCallId: string; title: string; status: string; kind?: string })
    ipcRenderer.on('spool:ai-tool-call', handler)
    return () => ipcRenderer.removeListener('spool:ai-tool-call', handler)
  },

  onSyncProgress: (cb: (e: { phase: string; count: number; total: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as { phase: string; count: number; total: number })
    ipcRenderer.on('spool:sync-progress', handler)
    return () => ipcRenderer.removeListener('spool:sync-progress', handler)
  },

  onNewSessions: (cb: (data: { count: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as { count: number })
    ipcRenderer.on('spool:new-sessions', handler)
    return () => ipcRenderer.removeListener('spool:new-sessions', handler)
  },

  getTheme: (): Promise<'system' | 'light' | 'dark'> =>
    ipcRenderer.invoke('spool:get-theme'),

  setTheme: (theme: 'system' | 'light' | 'dark'): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:set-theme', { theme }),

  getThemeEditorState: (): Promise<ThemeEditorStateV1 | null> =>
    ipcRenderer.invoke('spool:get-theme-editor-state'),

  setThemeEditorState: (state: ThemeEditorStateV1): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:set-theme-editor-state', { state }),

  // Spool Daemon notice
  getDaemonNoticePending: (): Promise<boolean> =>
    ipcRenderer.invoke('spool:get-daemon-notice-pending'),

  daemonNoticeAction: (action: 'install' | 'dismiss'): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:daemon-notice-action', { action }),

  // Auto-update
  onUpdateStatus: (cb: (data: { status: 'available' | 'downloading' | 'ready' | 'error'; version?: string; percent?: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as { status: 'available' | 'downloading' | 'ready' | 'error'; version?: string; percent?: number })
    ipcRenderer.on('spool:update-status', handler)
    return () => ipcRenderer.removeListener('spool:update-status', handler)
  },

  downloadUpdate: (): Promise<void> =>
    ipcRenderer.invoke('spool:download-update'),

  installUpdate: (): Promise<void> =>
    ipcRenderer.invoke('spool:install-update'),
}

contextBridge.exposeInMainWorld('spool', api)

declare global {
  interface Window {
    spool: SpoolAPI
  }
}
