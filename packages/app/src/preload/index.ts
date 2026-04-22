import { contextBridge, ipcRenderer } from 'electron'
import type { FragmentResult, Session, Message, StatusInfo, SyncResult, SearchResult, StarKind, StarredItem, ConnectorStatus, AuthStatus, SchedulerStatus, RegistryConnector } from '@spool-lab/core'
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
  search: (query: string, limit?: number, source?: string, onlyStarred?: boolean): Promise<SearchResult[]> =>
    ipcRenderer.invoke('spool:search', { query, limit, source, onlyStarred }),

  searchPreview: (query: string, limit?: number, source?: string): Promise<SearchResult[]> =>
    ipcRenderer.invoke('spool:search-preview', { query, limit, source }),

  listSessions: (limit?: number): Promise<Session[]> =>
    ipcRenderer.invoke('spool:list-sessions', { limit }),

  getSession: (sessionUuid: string): Promise<{ session: Session; messages: Message[] } | null> =>
    ipcRenderer.invoke('spool:get-session', { sessionUuid }),

  getStatus: (): Promise<StatusInfo> =>
    ipcRenderer.invoke('spool:get-status'),

  starItem: (kind: StarKind, uuid: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:star-item', { kind, uuid }),

  unstarItem: (kind: StarKind, uuid: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:unstar-item', { kind, uuid }),

  listStarredItems: (limit?: number): Promise<StarredItem[]> =>
    ipcRenderer.invoke('spool:list-starred-items', { limit }),

  getStarredUuids: (): Promise<{ session: string[]; capture: string[] }> =>
    ipcRenderer.invoke('spool:get-starred-uuids'),

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

  // ── Connectors ──

  connectors: {
    list: (): Promise<ConnectorStatus[]> =>
      ipcRenderer.invoke('connector:list'),

    checkAuth: (id: string): Promise<AuthStatus> =>
      ipcRenderer.invoke('connector:check-auth', { id }),

    syncNow: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('connector:sync-now', { id }),

    setEnabled: (id: string, enabled: boolean): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('connector:set-enabled', { id, enabled }),

    getStatus: (): Promise<SchedulerStatus> =>
      ipcRenderer.invoke('connector:get-status'),

    getCaptureCount: (connectorId: string): Promise<number> =>
      ipcRenderer.invoke('connector:get-capture-count', { connectorId }),

    uninstall: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('connector:uninstall', { id }),

    checkUpdates: (): Promise<Record<string, { current: string; latest: string }>> =>
      ipcRenderer.invoke('connector:check-updates'),

    update: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('connector:update', { id }),

    onEvent: (cb: (event: { type: string; connectorId?: string; progress?: unknown; result?: unknown; code?: string; message?: string; name?: string; version?: string }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as any)
      ipcRenderer.on('connector:event', handler)
      return () => ipcRenderer.removeListener('connector:event', handler)
    },

    fetchRegistry: (): Promise<RegistryConnector[]> =>
      ipcRenderer.invoke('connector:fetch-registry'),

    install: (packageName: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('connector:install', { packageName }),

    recheckPrerequisites: (packageId: string) =>
      ipcRenderer.invoke('connector:recheck-prerequisites', { packageId }),

    installCli: (packageId: string, prereqId: string, installId?: string) =>
      ipcRenderer.invoke('connector:install-cli', { packageId, prereqId, installId }),

    cancelInstallCli: (installId: string) =>
      ipcRenderer.invoke('connector:install-cli-cancel', { installId }),

    copyInstallCommand: (packageId: string, prereqId: string) =>
      ipcRenderer.invoke('connector:copy-install-command', { packageId, prereqId }),

    openExternal: (url: string) =>
      ipcRenderer.invoke('connector:open-external', { url }),

    onStatusChanged: (cb: (e: { packageId: string }) => void) => {
      const handler = (_e: unknown, payload: { packageId: string }) => cb(payload)
      ipcRenderer.on('connector:status-changed', handler)
      return () => ipcRenderer.removeListener('connector:status-changed', handler)
    },
  },

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
