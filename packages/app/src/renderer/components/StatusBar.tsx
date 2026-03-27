import { useEffect, useState, type ReactNode } from 'react'
import type { StatusInfo } from '@spool/core'
import type { SearchMode } from './SearchBar.js'

interface Props {
  syncStatus: { phase: string; count: number; total: number } | null
  searchMode?: SearchMode
  aiAgent?: string
}

type Theme = 'system' | 'light' | 'dark'
const themeCycle: Theme[] = ['system', 'light', 'dark']
const themeIcons: Record<Theme, ReactNode> = {
  system: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="5"/>
      <path d="M8 3V1M8 15v-2M13 8h2M1 8h2M11.5 4.5l1-1M3.5 12.5l1-1M11.5 11.5l1 1M3.5 3.5l1 1"/>
    </svg>
  ),
  light: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="4"/>
      <path d="M8 2V0M8 16v-2M14 8h2M0 8h2M12 4l1.5-1.5M2.5 13.5L4 12M12 12l1.5 1.5M2.5 2.5L4 4"/>
    </svg>
  ),
  dark: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M13.5 8.5a6 6 0 01-6-6A6 6 0 108.5 14.5a6 6 0 005-6z"/>
    </svg>
  ),
}

export default function StatusBar({ syncStatus, searchMode = 'fast', aiAgent }: Props) {
  const [status, setStatus] = useState<StatusInfo | null>(null)
  const [theme, setTheme] = useState<Theme>('system')

  useEffect(() => {
    if (!window.spool) return
    window.spool.getStatus().then(setStatus).catch(console.error)
  }, [syncStatus])

  useEffect(() => {
    if (!window.spool) return
    window.spool.getTheme().then(t => { if (t) setTheme(t) }).catch(console.error)
  }, [])

  const cycleTheme = () => {
    if (!window.spool) return
    const idx = themeCycle.indexOf(theme)
    const next: Theme = themeCycle[(idx + 1) % themeCycle.length] ?? 'system'
    setTheme(next)
    window.spool.setTheme(next)
  }

  const isAiMode = searchMode === 'ai'
  const statusText = isAiMode
    ? `✦ ACP · ${aiAgent ?? 'agent'} · local`
    : getSyncStatusText(syncStatus, status)
  const isOk = !syncStatus || syncStatus.phase === 'done'

  return (
    <div className="flex-none h-[30px] bg-warm-surface dark:bg-dark-surface border-t border-warm-border dark:border-dark-border flex items-center justify-between px-4">
      <div className="flex items-center gap-1.5">
        {isAiMode ? (
          <span className="w-1.5 h-1.5 rounded-full flex-none bg-accent dark:bg-accent-dark" />
        ) : (
          <span className={`w-1.5 h-1.5 rounded-full flex-none ${isOk ? 'bg-green-500' : 'bg-amber-400 animate-pulse'}`} />
        )}
        <span className="text-[11px] font-mono text-warm-muted dark:text-dark-muted truncate">
          {statusText}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={cycleTheme}
          title={`Theme: ${theme}`}
          className="text-warm-faint hover:text-warm-text dark:text-dark-muted dark:hover:text-dark-text transition-colors"
        >
          {themeIcons[theme]}
        </button>
        <button className="text-[11px] text-warm-faint hover:text-warm-text dark:text-dark-muted dark:hover:text-dark-text transition-colors">
          Sources +
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
