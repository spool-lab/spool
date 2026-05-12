import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ProjectGroup, Session, SessionSource, StatusInfo } from '@spool-lab/core'
import { Library as LibraryIcon, Search as SearchIcon, Settings as SettingsIcon, Newspaper as SharesIcon, SquareTerminal } from 'lucide-react'
import PinIcon from './PinIcon.js'
import { getSessionSourceColor, getSessionSourceLabel } from '../../shared/sessionSources.js'
import { getSessionResumeCommand } from '../../shared/resumeCommand.js'
import {
  DEFAULT_SIDEBAR_SORT_ORDER,
  SIDEBAR_SORT_OPTIONS,
  type SidebarSortOrder,
} from '../../shared/sidebarSort.js'
import {
  DEFAULT_PINNED_SORT_ORDER,
  PINNED_SORT_OPTIONS,
  type PinnedSortOrder,
} from '../../shared/pinnedSort.js'
import Menu from './Menu.js'

type Props = {
  activeIdentityKey: string | null
  activeSessionUuid?: string | null
  onSelectProject: (identityKey: string) => void
  onSelectSession?: (sessionUuid: string) => void
  onSelectHome?: () => void
  isLibraryActive?: boolean
  onSelectShares?: () => void
  isSharesActive?: boolean
  onOpenSearch?: () => void
  syncStatus?: { phase: string; count: number; total: number } | null
  status?: StatusInfo | null
  onSettingsClick?: () => void
  showSourceDots?: boolean
  showSessionCount?: boolean
  sortOrder?: SidebarSortOrder
  onSortOrderChange?: (next: SidebarSortOrder) => void
  pinnedSortOrder?: PinnedSortOrder
  onPinnedSortOrderChange?: (next: PinnedSortOrder) => void
  onCopySessionId?: (source: SessionSource) => void
}

export default function Sidebar({ activeIdentityKey, activeSessionUuid = null, onSelectProject, onSelectSession, onSelectHome, isLibraryActive = false, onSelectShares, isSharesActive = false, onOpenSearch, syncStatus, status, onSettingsClick, showSourceDots = true, showSessionCount = true, sortOrder = DEFAULT_SIDEBAR_SORT_ORDER, onSortOrderChange, pinnedSortOrder = DEFAULT_PINNED_SORT_ORDER, onPinnedSortOrderChange, onCopySessionId }: Props) {
  const [groups, setGroups] = useState<ProjectGroup[] | null>(null)
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [pinned, setPinned] = useState<Session[] | null>(null)
  const [pinnedOpen, setPinnedOpen] = useState(true)

  useEffect(() => {
    let cancelled = false
    window.spool.listProjectGroups()
      .then(result => { if (!cancelled) setGroups(result) })
      .catch(() => { if (!cancelled) setGroups([]) })
    return () => { cancelled = true }
  }, [status?.totalSessions])

  useEffect(() => {
    let cancelled = false
    function refresh() {
      window.spool.listPinnedSessions()
        .then(result => { if (!cancelled) setPinned(result) })
        .catch(() => { if (!cancelled) setPinned([]) })
    }
    refresh()
    window.addEventListener('spool:pin-change', refresh)
    return () => {
      cancelled = true
      window.removeEventListener('spool:pin-change', refresh)
    }
  }, [status?.totalSessions])

  const sortedPinned = useMemo(
    () => (pinned ? sortPinnedSessions(pinned, pinnedSortOrder) : null),
    [pinned, pinnedSortOrder],
  )
  const visibleGroups = (groups ?? []).filter(g => g.sessionCount > 0)
  const projectGroups = useMemo(
    () => sortProjectGroups(visibleGroups.filter(g => g.identityKind !== 'loose'), sortOrder),
    [visibleGroups, sortOrder],
  )
  const looseGroup = visibleGroups.find(g => g.identityKind === 'loose')

  return (
    <aside
      data-testid="sidebar"
      className="w-60 flex-none bg-warm-surface dark:bg-dark-surface flex flex-col h-full overflow-hidden"
    >
      <nav className="px-2 pt-1 pb-2 flex-none flex flex-col gap-0.5" aria-label="Primary">
        {onSelectHome && (
          <NavRow
            testId="sidebar-library"
            icon={<LibraryIcon size={14} strokeWidth={1.75} />}
            label="Library"
            active={isLibraryActive}
            onClick={onSelectHome}
          />
        )}
        {onSelectShares && (
          <NavRow
            testId="sidebar-shares"
            icon={<SharesIcon size={14} strokeWidth={1.75} />}
            label="Shares"
            active={isSharesActive}
            onClick={onSelectShares}
          />
        )}
        {onOpenSearch && (
          <NavRow
            testId="sidebar-search"
            icon={<SearchIcon size={14} strokeWidth={1.75} />}
            label="Search"
            trailing={<KbdHint>⌘K</KbdHint>}
            onClick={onOpenSearch}
          />
        )}
      </nav>

      <div className="flex-1 min-h-0 overflow-y-auto pb-3 scrollbar-none [mask-image:linear-gradient(to_bottom,black_calc(100%_-_20px),transparent)]">
        {sortedPinned && sortedPinned.length > 0 && onSelectSession && (
          <>
            <SectionHeader
              label="Pinned"
              open={pinnedOpen}
              onToggle={() => setPinnedOpen(open => !open)}
              testId="sidebar-pinned-toggle"
              trailing={onPinnedSortOrderChange ? (
                <Menu
                  align="right"
                  testId="sidebar-pinned-sort-menu"
                  trigger={({ open, toggle }) => (
                    <button
                      type="button"
                      data-testid="sidebar-pinned-sort-trigger"
                      onClick={toggle}
                      title="Sort pinned"
                      aria-label="Sort pinned"
                      aria-haspopup="menu"
                      aria-expanded={open}
                      className={`flex-none inline-flex items-center justify-end h-4 transition-opacity text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text ${
                        open ? 'opacity-100' : 'opacity-30 group-hover:opacity-100'
                      }`}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                        <path d="M1 3.5h12M2.5 7h9M5 10.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                  items={PINNED_SORT_OPTIONS.map(option => ({
                    label: option.label,
                    active: pinnedSortOrder === option.value,
                    onSelect: () => onPinnedSortOrderChange(option.value),
                  }))}
                />
              ) : null}
            />
            {pinnedOpen && (
              <div className="px-2 max-h-64 overflow-y-auto scrollbar-none">
                {sortedPinned.map(session => (
                  <PinnedRow
                    key={session.sessionUuid}
                    session={session}
                    active={session.sessionUuid === activeSessionUuid}
                    onClick={() => onSelectSession(session.sessionUuid)}
                    {...(onCopySessionId ? { onCopySessionId } : {})}
                  />
                ))}
              </div>
            )}
          </>
        )}

        <SectionHeader
          label="Projects"
          open={projectsOpen}
          onToggle={() => setProjectsOpen(open => !open)}
          testId="sidebar-projects-toggle"
          trailing={onSortOrderChange ? (
            <Menu
              align="right"
              testId="sidebar-sort-menu"
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  data-testid="sidebar-sort-trigger"
                  onClick={toggle}
                  title="Sort projects"
                  aria-label="Sort projects"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  className={`flex-none inline-flex items-center justify-end h-4 transition-opacity text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text ${
                    open ? 'opacity-100' : 'opacity-30 group-hover:opacity-100'
                  }`}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path d="M1 3.5h12M2.5 7h9M5 10.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}
              items={SIDEBAR_SORT_OPTIONS.map(option => ({
                label: option.label,
                active: sortOrder === option.value,
                onSelect: () => onSortOrderChange(option.value),
              }))}
            />
          ) : null}
        />

        {projectsOpen && (
          <div className="px-2">
            {groups === null ? (
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
                    showSourceDots={showSourceDots}
                    showSessionCount={showSessionCount}
                    onClick={() => onSelectProject(group.identityKey)}
                  />
                ))}

                {looseGroup && (
                  <>
                    <div className="my-2 mx-2 border-t border-warm-border dark:border-dark-border" />
                    <ProjectRow
                      group={looseGroup}
                      active={looseGroup.identityKey === activeIdentityKey}
                      showSourceDots={showSourceDots}
                      showSessionCount={showSessionCount}
                      onClick={() => onSelectProject(looseGroup.identityKey)}
                    />
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <SidebarStatus
        syncStatus={syncStatus ?? null}
        status={status ?? null}
        {...(onSettingsClick ? { onSettingsClick } : {})}
      />
    </aside>
  )
}

function NavRow({
  testId,
  icon,
  label,
  active = false,
  trailing,
  onClick,
}: {
  testId?: string
  icon: ReactNode
  label: string
  active?: boolean
  trailing?: ReactNode
  onClick: () => void
}) {
  const dataAttrs = testId ? { 'data-testid': testId } : {}
  return (
    <button
      type="button"
      {...dataAttrs}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={[
        'w-full flex items-center gap-2 px-2 py-1 rounded-md transition-colors duration-75 text-[13px]',
        active
          ? 'bg-warm-surface2 dark:bg-dark-surface2 text-warm-text dark:text-dark-text'
          : 'text-warm-text/85 dark:text-dark-text/85 hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text',
      ].join(' ')}
    >
      <span className="flex-none w-4 h-4 inline-flex items-center justify-center">{icon}</span>
      <span className="flex-1 text-left truncate">{label}</span>
      {trailing}
    </button>
  )
}

function KbdHint({ children }: { children: ReactNode }) {
  return (
    <kbd className="flex-none font-mono text-[10px] tabular-nums text-warm-faint/80 dark:text-dark-muted/80">
      {children}
    </kbd>
  )
}

function SidebarStatus({
  syncStatus,
  status,
  onSettingsClick,
}: {
  syncStatus: { phase: string; count: number; total: number } | null
  status: StatusInfo | null
  onSettingsClick?: () => void
}) {
  const text = getSyncStatusText(syncStatus, status)
  const isOk = !syncStatus || syncStatus.phase === 'done'

  return (
    <div className="flex-none h-[30px] pl-4 pr-4 flex items-center gap-2">
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full flex-none ${isOk ? 'bg-status-success dark:bg-status-success-dark' : 'bg-status-warning dark:bg-status-warning-dark animate-pulse'}`} />
        <span data-testid="status-text" className="text-[11px] font-mono text-warm-faint dark:text-dark-muted truncate" title={text}>
          {text}
        </span>
      </div>
      {onSettingsClick && (
        <button
          type="button"
          data-testid="settings-button"
          onClick={onSettingsClick}
          title="Settings"
          aria-label="Settings"
          className="flex-none inline-flex items-center justify-center h-4 text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors"
        >
          <SettingsIcon size={13} strokeWidth={1.75} />
        </button>
      )}
    </div>
  )
}

function getSyncStatusText(
  syncStatus: { phase: string; count: number; total: number } | null,
  status: StatusInfo | null,
): string {
  if (syncStatus) {
    if (syncStatus.phase === 'scanning') return 'Scanning…'
    if (syncStatus.phase === 'syncing') return `Indexing ${syncStatus.count}/${syncStatus.total} files`
    if (syncStatus.phase === 'indexing') return 'Building index…'
    if (syncStatus.phase === 'done' && status) {
      return `${status.totalSessions} sessions · now`
    }
  }
  if (!status) return 'Loading…'
  const lastSync = status.lastSyncedAt ? formatShortTimeAgo(status.lastSyncedAt) : 'never'
  return `${status.totalSessions} sessions · ${lastSync}`
}

function formatShortTimeAgo(iso: string): string {
  try {
    const utcIso = iso.endsWith('Z') ? iso : iso + 'Z'
    const diff = Date.now() - new Date(utcIso).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'now'
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`
    return `${Math.floor(hours / 24)}d`
  } catch {
    return iso
  }
}

function SectionHeader({
  label,
  open,
  onToggle,
  testId,
  trailing,
}: {
  label: string
  open: boolean
  onToggle: () => void
  testId?: string
  trailing?: ReactNode
}) {
  return (
    <div className="group mx-2 mt-1 px-2 py-1 flex items-center gap-1">
      <button
        type="button"
        data-testid={testId}
        aria-expanded={open}
        onClick={onToggle}
        className="flex-1 flex items-center gap-1.5 text-left text-[11px] font-medium text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text rounded-md select-none"
      >
        <span>{label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          className={`flex-none transition-all opacity-30 group-hover:opacity-100 ${open ? 'rotate-90' : ''}`}
        >
          <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {trailing}
    </div>
  )
}

function PinnedRow({
  session,
  active,
  onClick,
  onCopySessionId,
}: {
  session: Session
  active: boolean
  onClick: () => void
  onCopySessionId?: (source: SessionSource) => void
}) {
  const [resuming, setResuming] = useState(false)
  const [unpinning, setUnpinning] = useState(false)
  const title = session.title?.trim() || '(no title)'
  const projectName = session.projectDisplayName || session.projectDisplayPath
  const resumeCommand = getSessionResumeCommand(session.source, session.sessionUuid)

  async function handleResume() {
    setResuming(true)
    await window.spool.resumeCLI(session.sessionUuid, session.source, session.cwd ?? undefined)
    setTimeout(() => setResuming(false), 1000)
  }

  async function handleCopyCommand() {
    if (!resumeCommand) return
    await navigator.clipboard.writeText(resumeCommand)
  }

  async function handleCopyId() {
    await navigator.clipboard.writeText(session.sessionUuid)
    onCopySessionId?.(session.source)
  }

  async function handleUnpin() {
    if (unpinning) return
    setUnpinning(true)
    try {
      await window.spool.unpinSession(session.sessionUuid)
      window.dispatchEvent(new CustomEvent('spool:pin-change', { detail: { sessionUuid: session.sessionUuid, pinned: false } }))
    } finally {
      setUnpinning(false)
    }
  }

  return (
    <div
      data-testid="sidebar-pinned-row"
      data-session-uuid={session.sessionUuid}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      aria-label={projectName ? `${title}, ${projectName}` : title}
      className={`group w-full text-left flex items-center gap-1 px-2 py-1 rounded-md transition-colors duration-75 cursor-pointer focus:outline-none ${
        active
          ? 'bg-warm-surface2 dark:bg-dark-surface2 text-warm-text dark:text-dark-text'
          : 'text-warm-text/85 dark:text-dark-text/85 hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text'
      }`}
    >
      <span className="flex-1 truncate text-[13px]" title={title}>{title}</span>
      <span
        className="flex-none flex items-center gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-has-[[aria-expanded=true]]:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          data-testid="sidebar-pinned-unpin"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { void handleUnpin() }}
          aria-label="Unpin"
          disabled={unpinning}
          className="inline-flex items-center justify-center h-4 text-accent/80 dark:text-accent-dark/80 hover:text-accent dark:hover:text-accent-dark transition-colors disabled:opacity-50"
        >
          <PinIcon size={13} filled />
        </button>
        <Menu
          align="right"
          trigger={({ open, toggle }) => (
            <button
              type="button"
              data-testid="sidebar-pinned-menu-trigger"
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggle}
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={open}
              className="inline-flex items-center justify-center h-4 text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <circle cx="5" cy="12" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="19" cy="12" r="1.5" />
              </svg>
            </button>
          )}
          items={[
            {
              label: resuming ? 'Opening…' : 'Resume in Terminal',
              icon: resuming ? <SpinnerIcon /> : <SquareTerminal size={14} strokeWidth={1.5} aria-hidden />,
              onSelect: () => { void handleResume() },
              disabled: resuming,
            },
            ...(resumeCommand ? [{
              label: 'Copy resume command',
              icon: <TerminalGlyph />,
              onSelect: () => { void handleCopyCommand() },
            }] : []),
            {
              label: 'Copy session ID',
              icon: <CopyGlyph />,
              onSelect: () => { void handleCopyId() },
            },
          ]}
        />
      </span>
    </div>
  )
}

function TerminalGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.5L5 7L3 9.5" />
      <path d="M6.5 10H11.5" />
    </svg>
  )
}

function CopyGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="5" y="5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 5V3.5C9 2.67 8.33 2 7.5 2H3.5C2.67 2 2 2.67 2 3.5V7.5C2 8.33 2.67 9 3.5 9H5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="animate-spin" aria-hidden>
      <circle cx="7" cy="7" r="5.25" stroke="currentColor" strokeWidth="1.5" fill="none" strokeOpacity="0.3" />
      <path d="M7 1.75A5.25 5.25 0 0112.25 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}

function ProjectRow({
  group,
  active,
  showSourceDots,
  showSessionCount,
  onClick,
}: {
  group: ProjectGroup
  active: boolean
  showSourceDots: boolean
  showSessionCount: boolean
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
      className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded-md transition-colors duration-75 ${
        active
          ? 'bg-warm-surface2 dark:bg-dark-surface2 text-warm-text dark:text-dark-text'
          : 'text-warm-text/85 dark:text-dark-text/85 hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text'
      }`}
    >
      <FolderIcon active={active} />
      <span className="flex-1 truncate text-[13px]">
        {group.displayName}
      </span>
      {showSourceDots && <SourceDots sources={group.sources} />}
      {showSessionCount && (
        <span className="flex-none font-mono text-[11px] tabular-nums text-warm-faint/70 dark:text-dark-muted/70">
          {group.sessionCount}
        </span>
      )}
    </button>
  )
}

function FolderIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={`flex-none ${active ? 'text-warm-faint dark:text-dark-muted' : 'text-warm-faint/70 dark:text-dark-muted/70'}`}
    >
      <path
        d="M1.5 4.2c0-.55.45-1 1-1h3l1.2 1.3h4.8c.55 0 1 .45 1 1v5.3c0 .55-.45 1-1 1H2.5c-.55 0-1-.45-1-1V4.2z"
        stroke="currentColor"
        strokeWidth="1.5"
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

function sortProjectGroups(groups: ProjectGroup[], order: SidebarSortOrder): ProjectGroup[] {
  const sorted = [...groups]
  switch (order) {
    case 'name':
      sorted.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }))
      return sorted
    case 'most_sessions':
      sorted.sort((a, b) => {
        if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount
        return compareLastSessionAtDesc(a, b)
      })
      return sorted
    case 'recent':
    default:
      sorted.sort(compareLastSessionAtDesc)
      return sorted
  }
}

function sortPinnedSessions(sessions: Session[], order: PinnedSortOrder): Session[] {
  const sorted = [...sessions]
  switch (order) {
    case 'name':
      sorted.sort((a, b) => {
        const at = (a.title ?? '').trim()
        const bt = (b.title ?? '').trim()
        return at.localeCompare(bt, undefined, { sensitivity: 'base' })
      })
      return sorted
    case 'recent':
      sorted.sort((a, b) => {
        const ae = a.endedAt ?? ''
        const be = b.endedAt ?? ''
        return be.localeCompare(ae)
      })
      return sorted
    case 'recent_pinned':
    default:
      return sorted
  }
}

function compareLastSessionAtDesc(a: ProjectGroup, b: ProjectGroup): number {
  if (!a.lastSessionAt && !b.lastSessionAt) return 0
  if (!a.lastSessionAt) return 1
  if (!b.lastSessionAt) return -1
  return b.lastSessionAt.localeCompare(a.lastSessionAt)
}
