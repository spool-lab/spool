import { contextBridge, ipcRenderer } from 'electron'
import type { FragmentResult, Session, Message, StatusInfo, SyncResult, SearchResult, OpenCLISetupStatus, OpenCLISource, PlatformInfo, CapturedItem } from '@spool/core'

export interface AgentInfo {
  id: string
  name: string
  path: string
}

export type SpoolAPI = typeof api

const api = {
  search: (query: string, limit?: number, source?: string): Promise<FragmentResult[]> =>
    ipcRenderer.invoke('spool:search', { query, limit, source }),

  listSessions: (limit?: number): Promise<Session[]> =>
    ipcRenderer.invoke('spool:list-sessions', { limit }),

  getSession: (sessionUuid: string): Promise<{ session: Session; messages: Message[] } | null> =>
    ipcRenderer.invoke('spool:get-session', { sessionUuid }),

  getStatus: (): Promise<StatusInfo> =>
    ipcRenderer.invoke('spool:get-status'),

  syncNow: (): Promise<SyncResult> =>
    ipcRenderer.invoke('spool:sync-now'),

  resumeCLI: (sessionUuid: string, source: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('spool:resume-cli', { sessionUuid, source }),

  copyFragment: (text: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:copy-fragment', { text }),

  // AI / ACP
  getAiAgents: (): Promise<AgentInfo[]> =>
    ipcRenderer.invoke('spool:ai-agents'),

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

  // ── OpenCLI ──

  opencli: {
    checkSetup: (): Promise<OpenCLISetupStatus> =>
      ipcRenderer.invoke('opencli:check-setup'),

    installCli: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('opencli:install-cli'),

    availablePlatforms: (): Promise<PlatformInfo[]> =>
      ipcRenderer.invoke('opencli:available-platforms'),

    addSource: (platform: string, command: string): Promise<{ ok: boolean; id: number }> =>
      ipcRenderer.invoke('opencli:add-source', { platform, command }),

    removeSource: (id: number): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('opencli:remove-source', { id }),

    listSources: (): Promise<OpenCLISource[]> =>
      ipcRenderer.invoke('opencli:list-sources'),

    syncSource: (id: number, platform: string, command: string): Promise<{ ok: boolean; count?: number; error?: string }> =>
      ipcRenderer.invoke('opencli:sync-source', { id, platform, command }),

    syncAllSources: (): Promise<{ ok: boolean; count: number; errors: string[] }> =>
      ipcRenderer.invoke('opencli:sync-all-sources'),

    captureUrl: (url: string): Promise<{ ok: boolean; capture?: CapturedItem; error?: string }> =>
      ipcRenderer.invoke('opencli:capture-url', { url }),

    getCaptureCount: (platform?: string): Promise<number> =>
      ipcRenderer.invoke('opencli:get-capture-count', { platform }),

    getSetupValue: (key: string): Promise<string | null> =>
      ipcRenderer.invoke('opencli:get-setup-value', { key }),

    setSetupValue: (key: string, value: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('opencli:set-setup-value', { key, value }),

    onCaptureProgress: (cb: (e: { phase: string; message: string }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as { phase: string; message: string })
      ipcRenderer.on('opencli:capture-progress', handler)
      return () => ipcRenderer.removeListener('opencli:capture-progress', handler)
    },
  },

  onOpenCaptureModal: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('spool:open-capture-modal', handler)
    return () => ipcRenderer.removeListener('spool:open-capture-modal', handler)
  },
}

contextBridge.exposeInMainWorld('spool', api)

declare global {
  interface Window {
    spool: SpoolAPI
  }
}
