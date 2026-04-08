import { useEffect, useState } from 'react'
import type { StatusInfo } from '@spool/core'
import type { SearchMode } from './SearchBar.js'

interface Props {
  syncStatus: { phase: string; count: number; total: number } | null
  searchMode?: SearchMode
  aiAgent?: string
  aiAgentMode?: string
  onSourcesClick?: () => void
  onSettingsClick?: () => void
}

interface UpdateStatus {
  status: 'available' | 'downloading' | 'ready' | 'error'
  version?: string
  percent?: number
}

export default function StatusBar({
  syncStatus,
  searchMode = 'fast',
  aiAgent,
  aiAgentMode,
  onSourcesClick,
  onSettingsClick,
}: Props) {
  const [status, setStatus] = useState<StatusInfo | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    if (!window.spool) return
    window.spool.getStatus().then(setStatus).catch(console.error)
  }, [syncStatus])

  useEffect(() => {
    if (!window.spool?.onUpdateStatus) return () => {}
    return window.spool.onUpdateStatus((data) => {
      if (data.status === 'error') setUpdateStatus(null)
      else setUpdateStatus(data)
    })
  }, [])

  const isAiMode = searchMode === 'ai'
  const statusText = isAiMode
    ? `✦ ${aiAgentMode === 'sdk' ? 'API' : 'ACP'} · ${aiAgent ?? 'agent'} · local`
    : getSyncStatusText(syncStatus, status)
  const isOk = !syncStatus || syncStatus.phase === 'done'

  return (
    <div
      className="flex-none h-[30px] border-t border-warm-border dark:border-dark-border flex items-center justify-between px-4 bg-warm-surface dark:bg-dark-surface"
    >
      <div className="flex items-center gap-1.5">
        {isAiMode ? (
          <span className="w-1.5 h-1.5 rounded-full flex-none bg-accent dark:bg-accent-dark" />
        ) : (
          <span className={`w-1.5 h-1.5 rounded-full flex-none ${isOk ? 'bg-green-500' : 'bg-amber-400 animate-pulse'}`} />
        )}
        <span data-testid="status-text" className="text-[11px] font-mono text-warm-muted dark:text-dark-muted truncate">
          {statusText}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {updateStatus?.status === 'available' && (
          <button
            onClick={() => window.spool?.downloadUpdate()}
            className="flex items-center gap-1.5 text-[11px] text-accent dark:text-accent-dark hover:opacity-80 transition-opacity font-medium"
            title={`Update to ${updateStatus.version}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-accent dark:bg-accent-dark" />
            v{updateStatus.version} available
          </button>
        )}
        {updateStatus?.status === 'downloading' && (
          <span className="text-[11px] text-warm-muted dark:text-dark-muted font-mono">
            Updating{updateStatus.percent != null ? ` ${updateStatus.percent}%` : '…'}
          </span>
        )}
        {updateStatus?.status === 'ready' && (
          <button
            onClick={() => window.spool?.installUpdate()}
            className="flex items-center gap-1.5 text-[11px] text-accent dark:text-accent-dark hover:opacity-80 transition-opacity font-medium"
            title={`Restart to update to ${updateStatus.version}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-accent dark:bg-accent-dark" />
            Restart to update
          </button>
        )}
        {onSourcesClick && (
          <button
            type="button"
            onClick={onSourcesClick}
            title="Data sources"
            className="text-[11px] text-warm-muted dark:text-dark-muted hover:text-accent dark:hover:text-accent-dark transition-colors font-medium"
          >
            Sources
          </button>
        )}
        <button
          onClick={onSettingsClick}
          title="Settings"
          className="text-warm-faint hover:text-warm-text dark:text-dark-muted dark:hover:text-dark-text transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

function getSyncStatusText(
  syncStatus: { phase: string; count: number; total: number } | null,
  status: StatusInfo | null,
): string {
  if (syncStatus) {
    if (syncStatus.phase === 'scanning') return `Scanning for sessions…`
    if (syncStatus.phase === 'syncing') return `Indexing ${syncStatus.count}/${syncStatus.total}…`
    if (syncStatus.phase === 'indexing') return `Building search index…`
    if (syncStatus.phase === 'done') return `Synced · ${status?.totalSessions ?? '…'} sessions`
  }
  if (!status) return 'Loading…'
  const lastSync = status.lastSyncedAt ? formatTimeAgo(status.lastSyncedAt) : 'never'
  return `Synced ${lastSync} · ${status.totalSessions} sessions`
}

function formatTimeAgo(iso: string): string {
  try {
    const utcIso = iso.endsWith('Z') ? iso : iso + 'Z'
    const diff = Date.now() - new Date(utcIso).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  } catch {
    return iso
  }
}
