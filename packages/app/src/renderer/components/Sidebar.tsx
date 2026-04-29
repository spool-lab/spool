import { useEffect, useState } from 'react'
import type { ProjectGroup, SessionSource, StatusInfo } from '@spool-lab/core'
import { getSessionSourceColor, getSessionSourceLabel } from '../../shared/sessionSources.js'
import { SearchTrigger } from './LibraryLanding.js'

type Props = {
  activeIdentityKey: string | null
  onSelectProject: (identityKey: string) => void
  onSelectHome?: () => void
  onOpenSearch?: () => void
  syncStatus?: { phase: string; count: number; total: number } | null
  onSettingsClick?: () => void
}

export default function Sidebar({ activeIdentityKey, onSelectProject, onSelectHome, onOpenSearch, syncStatus, onSettingsClick }: Props) {
  const [groups, setGroups] = useState<ProjectGroup[] | null>(null)
  const [projectsOpen, setProjectsOpen] = useState(true)

  useEffect(() => {
    let cancelled = false
    window.spool.listProjectGroups()
      .then(result => { if (!cancelled) setGroups(result) })
      .catch(() => { if (!cancelled) setGroups([]) })
    return () => { cancelled = true }
  }, [])

  const visibleGroups = (groups ?? []).filter(g => g.sessionCount > 0)
  const projectGroups = visibleGroups.filter(g => g.identityKind !== 'loose')
  const looseGroup = visibleGroups.find(g => g.identityKind === 'loose')

  return (
    <aside
      data-testid="sidebar"
      className="w-60 flex-none border-r border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface flex flex-col h-full overflow-hidden"
    >
      <div className="px-4 pt-3 pb-3 flex-none">
        <button
          type="button"
          data-testid="sidebar-home"
          onClick={() => onSelectHome?.()}
          className="text-xl font-bold tracking-[-0.04em] select-none cursor-pointer hover:opacity-80 transition-opacity"
          aria-label="Spool home"
        >
          Spool<span className="text-accent">.</span>
        </button>
      </div>

      {onOpenSearch && (
        <div className="px-3 pb-3 flex-none">
          <SearchTrigger onClick={onOpenSearch} fullWidth />
        </div>
      )}

      <button
        type="button"
        data-testid="sidebar-projects-toggle"
        aria-expanded={projectsOpen}
        onClick={() => setProjectsOpen(open => !open)}
        className="group mx-2 px-2 py-1 flex-none flex items-center gap-1 text-[10px] font-semibold tracking-[0.08em] text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text rounded-md select-none"
      >
        <span>PROJECTS</span>
        <svg
          width="9"
          height="9"
          viewBox="0 0 9 9"
          fill="none"
          aria-hidden="true"
          className={`flex-none transition-all opacity-0 group-hover:opacity-100 ${projectsOpen ? 'rotate-90' : ''}`}
        >
          <path d="M3 1.5L6 4.5L3 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
        {projectsOpen && (
          groups === null ? (
            <SidebarSkeleton />
          ) : projectGroups.length === 0 && !looseGroup ? (
            <p className="px-2 py-3 text-xs text-warm-faint dark:text-dark-muted">
              No sessions yet
            </p>
          ) : (
            <>
              {projectGroups.map(group => (
                <ProjectRow
                  key={group.identityKey}
                  group={group}
                  active={group.identityKey === activeIdentityKey}
                  onClick={() => onSelectProject(group.identityKey)}
                />
              ))}

              {looseGroup && (
                <>
                  <div className="my-2 mx-2 border-t border-warm-border dark:border-dark-border" />
                  <ProjectRow
                    group={looseGroup}
                    active={looseGroup.identityKey === activeIdentityKey}
                    onClick={() => onSelectProject(looseGroup.identityKey)}
                  />
                </>
              )}
            </>
          )
        )}
      </div>

      <SidebarStatus
        syncStatus={syncStatus ?? null}
        {...(onSettingsClick ? { onSettingsClick } : {})}
      />
    </aside>
  )
}

function SidebarStatus({
  syncStatus,
  onSettingsClick,
}: {
  syncStatus: { phase: string; count: number; total: number } | null
  onSettingsClick?: () => void
}) {
  const [status, setStatus] = useState<StatusInfo | null>(null)

  useEffect(() => {
    if (!window.spool) return
    window.spool.getStatus().then(setStatus).catch(() => {})
  }, [syncStatus])

  const text = getSyncStatusText(syncStatus, status)
  const isOk = !syncStatus || syncStatus.phase === 'done'

  return (
    <div className="flex-none px-2 pt-1 pb-2 flex flex-col gap-0.5">
      {onSettingsClick && (
        <button
          type="button"
          onClick={onSettingsClick}
          title="Settings"
          aria-label="Settings"
          className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-none">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
          <span className="font-medium">Settings</span>
        </button>
      )}

      <div className="flex items-center gap-2 px-2 py-1">
        <span className={`w-1.5 h-1.5 rounded-full flex-none ${isOk ? 'bg-green-500' : 'bg-amber-400 animate-pulse'}`} />
        <span data-testid="status-text" className="text-[11px] font-mono text-warm-faint dark:text-dark-muted truncate" title={text}>
          {text}
        </span>
      </div>
    </div>
  )
}

function getSyncStatusText(
  syncStatus: { phase: string; count: number; total: number } | null,
  status: StatusInfo | null,
): string {
  if (syncStatus) {
    if (syncStatus.phase === 'scanning') return 'Scanning…'
    if (syncStatus.phase === 'syncing') return `Indexing ${syncStatus.count}/${syncStatus.total}…`
    if (syncStatus.phase === 'indexing') return 'Building index…'
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

function ProjectRow({
  group,
  active,
  onClick,
}: {
  group: ProjectGroup
  active: boolean
  onClick: () => void
}) {
  const sourceList = group.sources.map(getSessionSourceLabel).join(', ')
  const ariaLabel = sourceList
    ? `${group.displayName}, ${sourceList}, ${group.sessionCount} sessions`
    : `${group.displayName}, ${group.sessionCount} sessions`
  return (
    <button
      data-testid="sidebar-project-row"
      data-identity-key={group.identityKey}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded-md transition-colors ${
        active
          ? 'bg-warm-surface2 dark:bg-dark-surface2 text-warm-text dark:text-dark-text'
          : 'text-warm-text/85 dark:text-dark-text/85 hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text'
      }`}
    >
      <FolderIcon active={active} />
      <span className="flex-1 truncate text-[12.5px]">
        {group.displayName}
      </span>
      <SourceDots sources={group.sources} />
      <span className="flex-none font-mono text-[10.5px] tabular-nums text-warm-faint/70 dark:text-dark-muted/70">
        {group.sessionCount}
      </span>
    </button>
  )
}

function FolderIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={`flex-none ${active ? 'text-warm-faint dark:text-dark-muted' : 'text-warm-faint/70 dark:text-dark-muted/70'}`}
    >
      <path
        d="M1.5 4.2c0-.55.45-1 1-1h3l1.2 1.3h4.8c.55 0 1 .45 1 1v5.3c0 .55-.45 1-1 1H2.5c-.55 0-1-.45-1-1V4.2z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SourceDots({ sources }: { sources: SessionSource[] }) {
  if (sources.length === 0) return null
  const tooltip = sources.map(getSessionSourceLabel).join(' · ')
  return (
    <span aria-hidden="true" title={tooltip} className="flex-none flex items-center gap-1">
      {sources.map(source => (
        <span
          key={source}
          className="block w-1.5 h-1.5 rounded-full"
          style={{ background: getSessionSourceColor(source) }}
        />
      ))}
    </span>
  )
}

function SidebarSkeleton() {
  return (
    <div className="px-2 py-1 space-y-1.5" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-6 rounded-md bg-warm-surface2 dark:bg-dark-surface2 opacity-60 animate-pulse"
        />
      ))}
    </div>
  )
}
