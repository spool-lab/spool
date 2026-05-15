import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownUp } from 'lucide-react'
import type { ProjectGroup, Session, SessionSource, ProjectSessionSortOrder } from '@spool-lab/core'
import SessionRow from './SessionRow.js'
import Menu from './Menu.js'
import { CollapsibleSection } from './LibraryLanding.js'
import { getSessionSourceColor, getSessionSourceLabel } from '../../shared/sessionSources.js'
import { formatRelativeDate } from '../../shared/formatDate.js'
import { PROJECT_SORT_OPTIONS } from '../../shared/projectView.js'

type Props = {
  identityKey: string
  sortOrder: ProjectSessionSortOrder
  onSortOrderChange: (next: ProjectSessionSortOrder) => void
  onOpenSession: (uuid: string) => void
  onCopySessionId: (source: Session['source']) => void
  onShare?: (uuid: string) => void
}

export default function ProjectView({
  identityKey,
  sortOrder,
  onSortOrderChange,
  onOpenSession,
  onCopySessionId,
  onShare,
}: Props) {
  const { t } = useTranslation()
  const projectSortLabel = (value: ProjectSessionSortOrder): string => {
    switch (value) {
      case 'recent': return t('project.sort_recent')
      case 'oldest': return t('project.sort_oldest')
      case 'most_messages': return t('project.sort_most_messages')
      case 'title': return t('project.sort_title')
    }
  }
  const [group, setGroup] = useState<ProjectGroup | null>(null)
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [pinnedSessions, setPinnedSessions] = useState<Session[]>([])
  const [activeSources, setActiveSources] = useState<Set<SessionSource>>(new Set())
  const [closedCwds, setClosedCwds] = useState<Set<string>>(new Set())
  const [isolatedCwd, setIsolatedCwd] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    setActiveSources(new Set())
    setClosedCwds(new Set())
    setIsolatedCwd(null)
  }, [identityKey])

  useEffect(() => {
    setSessions(null)
  }, [identityKey, sortOrder, activeSources])

  useEffect(() => {
    let cancelled = false
    window.spool.listProjectGroups()
      .then(groups => {
        if (cancelled) return
        setGroup(groups.find(g => g.identityKey === identityKey) ?? null)
      })
      .catch(() => { if (!cancelled) setGroup(null) })
    return () => { cancelled = true }
  }, [identityKey])

  useEffect(() => {
    let cancelled = false
    const sourcesArray = Array.from(activeSources)
    const sharedOptions = {
      ...(sourcesArray.length > 0 ? { sources: sourcesArray } : {}),
    }
    Promise.all([
      window.spool.listPinnedSessionsByIdentity(identityKey),
      window.spool.listSessionsByIdentity(identityKey, {
        sortOrder,
        excludePinned: true,
        ...sharedOptions,
      }),
    ])
      .then(([pinned, recent]) => {
        if (cancelled) return
        const filteredPinned = sourcesArray.length > 0
          ? pinned.filter(s => sourcesArray.includes(s.source))
          : pinned
        setPinnedSessions(filteredPinned)
        setSessions(recent)
      })
      .catch(() => {
        if (!cancelled) {
          setPinnedSessions([])
          setSessions([])
        }
      })
    return () => { cancelled = true }
  }, [identityKey, sortOrder, activeSources, reloadKey])

  useEffect(() => {
    function bump() { setReloadKey(k => k + 1) }
    window.addEventListener('spool:pin-change', bump)
    return () => window.removeEventListener('spool:pin-change', bump)
  }, [])

  function handlePinChange(sessionUuid: string, pinned: boolean) {
    if (pinned) {
      const candidate = sessions?.find(s => s.sessionUuid === sessionUuid)
      if (candidate) {
        setSessions(prev => (prev ?? []).filter(s => s.sessionUuid !== sessionUuid))
        setPinnedSessions(prev => [candidate, ...prev])
      }
    } else {
      setPinnedSessions(prev => prev.filter(s => s.sessionUuid !== sessionUuid))
    }
    setReloadKey(k => k + 1)
  }

  const availableSources = group?.sources ?? []
  const displayPath = useMemo(() => {
    return pinnedSessions[0]?.projectDisplayPath ?? sessions?.[0]?.projectDisplayPath ?? null
  }, [pinnedSessions, sessions])

  // Chip-strip groups: include pinned so counts match the project total.
  const directoryGroups = useMemo(() => {
    if (!sessions) return null
    const map = new Map<string, Session[]>()
    for (const s of [...pinnedSessions, ...sessions]) {
      const key = cwdOf(s)
      const arr = map.get(key)
      if (arr) arr.push(s)
      else map.set(key, [s])
    }
    return Array.from(map.entries())
      .map(([cwd, items]) => {
        const lastAt = items.reduce((acc, s) => (s.startedAt > acc ? s.startedAt : acc), '')
        return { cwd, sessions: items, lastAt }
      })
      .sort((a, b) => (b.lastAt > a.lastAt ? 1 : b.lastAt < a.lastAt ? -1 : 0))
  }, [sessions, pinnedSessions])

  useEffect(() => {
    if (!directoryGroups || isolatedCwd === null) return
    if (!directoryGroups.some(g => g.cwd === isolatedCwd)) setIsolatedCwd(null)
  }, [directoryGroups, isolatedCwd])

  // Render-side splits: PINNED section + grouped/isolated unpinned list.
  const visiblePinned = useMemo(() => {
    if (isolatedCwd === null) return pinnedSessions
    return pinnedSessions.filter(s => cwdOf(s) === isolatedCwd)
  }, [pinnedSessions, isolatedCwd])

  const visibleUnpinned = useMemo<Session[]>(() => {
    if (!sessions) return []
    if (isolatedCwd === null) return sessions
    return sessions.filter(s => cwdOf(s) === isolatedCwd)
  }, [sessions, isolatedCwd])

  const unpinnedGroups = useMemo(() => {
    if (!sessions) return null
    const map = new Map<string, Session[]>()
    for (const s of sessions) {
      const key = cwdOf(s)
      const arr = map.get(key)
      if (arr) arr.push(s)
      else map.set(key, [s])
    }
    return Array.from(map.entries())
      .map(([cwd, items]) => {
        const lastAt = items.reduce((acc, s) => (s.startedAt > acc ? s.startedAt : acc), '')
        return { cwd, sessions: items, lastAt }
      })
      .sort((a, b) => (b.lastAt > a.lastAt ? 1 : b.lastAt < a.lastAt ? -1 : 0))
  }, [sessions])

  const showGrouped = (unpinnedGroups?.length ?? 0) >= 2 && isolatedCwd === null
  const looseT = t as unknown as (k: string, o?: Record<string, unknown>) => string
  const meta = useMemo(() => {
    if (!group) return null
    const lastActivity = group.lastSessionAt ? formatRelativeDate(group.lastSessionAt, { t: looseT }) : null
    return { count: group.sessionCount, lastActivity, sources: group.sources }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, t])

  function toggleSource(source: SessionSource) {
    setActiveSources(prev => {
      const next = new Set(prev)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })
  }

  return (
    <div data-testid="project-view" className="flex flex-col h-full overflow-hidden">
      <div className="flex-none px-6 pt-1.5 pb-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-xl font-semibold tracking-tight text-warm-text dark:text-dark-text">
            {group?.displayName ?? identityKey}
          </h1>
          {displayPath && (
            <span className="text-[11px] font-mono text-warm-faint/80 dark:text-dark-muted/80 truncate" title={displayPath}>
              {displayPath}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          {meta && (
            <p className="text-xs text-warm-muted dark:text-dark-muted flex items-center gap-2 flex-wrap min-w-0">
              <span>{t('project.sessionCount_other', { count: meta.count })}</span>
              {meta.lastActivity && <><span aria-hidden>·</span><span>{t('project.updatedWhen', { when: meta.lastActivity })}</span></>}
              {meta.sources.length > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span className="flex items-center gap-2 flex-wrap">
                    {meta.sources.map(src => {
                      const isInteractive = availableSources.length > 1
                      const active = activeSources.has(src)
                      const noFilter = activeSources.size === 0
                      const visualActive = noFilter || active
                      const content = (
                        <>
                          <span
                            aria-hidden
                            className="w-1.5 h-1.5 rounded-full flex-none"
                            style={{ background: getSessionSourceColor(src) }}
                          />
                          <span>{getSessionSourceLabel(src)}</span>
                        </>
                      )
                      if (!isInteractive) {
                        return (
                          <span key={src} className="flex items-center gap-1">{content}</span>
                        )
                      }
                      return (
                        <button
                          key={src}
                          type="button"
                          data-testid="source-filter-pill"
                          data-source={src}
                          aria-pressed={active}
                          onClick={() => toggleSource(src)}
                          className={`flex items-center gap-1 rounded transition-opacity hover:text-warm-text dark:hover:text-dark-text ${
                            visualActive ? 'opacity-100' : 'opacity-40'
                          } ${active ? 'text-warm-text dark:text-dark-text' : ''}`}
                        >
                          {content}
                        </button>
                      )
                    })}
                  </span>
                </>
              )}
            </p>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Menu
              align="right"
              testId="project-sort-menu"
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  data-testid="project-sort"
                  data-value={sortOrder}
                  aria-label={t('fragment.sortAriaLabel')}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  onClick={toggle}
                  className="inline-flex items-center gap-1.5 h-7 px-2 text-xs font-medium text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors"
                >
                  <ArrowDownUp size={13} strokeWidth={1.5} aria-hidden />
                  <span>{t('fragment.sortLabel', { value: projectSortLabel(sortOrder) })}</span>
                </button>
              )}
              items={PROJECT_SORT_OPTIONS.map(option => ({
                label: projectSortLabel(option.value),
                active: sortOrder === option.value,
                onSelect: () => onSortOrderChange(option.value),
              }))}
            />
          </div>
        </div>

        {(directoryGroups?.length ?? 0) >= 2 && directoryGroups && (
          <DirectoryChipStrip
            groups={directoryGroups}
            isolatedCwd={isolatedCwd}
            projectDisplayPath={displayPath}
            onSelect={setIsolatedCwd}
          />
        )}

        {isolatedCwd && isolatedCwd !== '(unknown)' && (
          <p
            data-testid="project-isolated-cwd"
            className="mt-1.5 font-mono text-[11px] text-warm-faint/80 dark:text-dark-muted/80 truncate"
            title={isolatedCwd}
          >
            {isolatedCwd}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%_-_24px),transparent)]">
        {sessions === null ? (
          <div className="px-4 py-8 text-center text-sm text-warm-faint dark:text-dark-muted">
            {t('common.loading')}
          </div>
        ) : visibleUnpinned.length === 0 && visiblePinned.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-warm-muted dark:text-dark-muted">{t('project.noSessions')}</p>
            <div className="mt-2 flex items-center justify-center gap-3 text-xs">
              {activeSources.size > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveSources(new Set())}
                  className="text-accent hover:underline"
                >
                  {t('project.clearSourceFilter')}
                </button>
              )}
              {isolatedCwd !== null && (
                <button
                  type="button"
                  onClick={() => setIsolatedCwd(null)}
                  className="text-accent hover:underline"
                >
                  {t('project.clearDirectoryFilter')}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {visiblePinned.length > 0 && (
              <CollapsibleSection
                label={t('library.section_pinned', { count: visiblePinned.length })}
                testId="project-view-pinned"
              >
                <div>
                  {visiblePinned.map(session => (
                    <SessionRow
                      key={session.sessionUuid}
                      session={session}
                      pinned
                      onPinChange={handlePinChange}
                      onOpenSession={onOpenSession}
                      onCopySessionId={onCopySessionId}
                      {...(onShare ? { onShare } : {})}
                    />
                  ))}
                </div>
              </CollapsibleSection>
            )}
            {showGrouped && unpinnedGroups ? (
              <div data-testid="project-view-by-directory">
                {unpinnedGroups.map(g => (
                  <DirectoryGroupSection
                    key={g.cwd}
                    cwd={g.cwd}
                    projectDisplayPath={displayPath}
                    sessions={g.sessions}
                    open={!closedCwds.has(g.cwd)}
                    onToggleOpen={() => {
                      setClosedCwds(prev => {
                        const next = new Set(prev)
                        if (next.has(g.cwd)) next.delete(g.cwd)
                        else next.add(g.cwd)
                        return next
                      })
                    }}
                    onPinChange={handlePinChange}
                    onOpenSession={onOpenSession}
                    onCopySessionId={onCopySessionId}
                    {...(onShare ? { onShare } : {})}
                  />
                ))}
              </div>
            ) : isolatedCwd !== null ? (
              <div data-testid="project-view-isolated" data-cwd={isolatedCwd}>
                {visibleUnpinned.map(session => (
                  <SessionRow
                    key={session.sessionUuid}
                    session={session}
                    onPinChange={handlePinChange}
                    onOpenSession={onOpenSession}
                    onCopySessionId={onCopySessionId}
                    {...(onShare ? { onShare } : {})}
                  />
                ))}
              </div>
            ) : visiblePinned.length > 0 && visibleUnpinned.length > 0 ? (
              <CollapsibleSection label="RECENT" testId="project-view-recent">
                {visibleUnpinned.map(session => (
                  <SessionRow
                    key={session.sessionUuid}
                    session={session}
                    onPinChange={handlePinChange}
                    onOpenSession={onOpenSession}
                    onCopySessionId={onCopySessionId}
                    {...(onShare ? { onShare } : {})}
                  />
                ))}
              </CollapsibleSection>
            ) : (
              <div data-testid="project-view-recent">
                {visibleUnpinned.map(session => (
                  <SessionRow
                    key={session.sessionUuid}
                    session={session}
                    onPinChange={handlePinChange}
                    onOpenSession={onOpenSession}
                    onCopySessionId={onCopySessionId}
                    {...(onShare ? { onShare } : {})}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function DirectoryGroupSection({
  cwd,
  projectDisplayPath,
  sessions,
  open,
  onToggleOpen,
  onPinChange,
  onOpenSession,
  onCopySessionId,
  onShare,
}: {
  cwd: string
  projectDisplayPath: string | null
  sessions: Session[]
  open: boolean
  onToggleOpen: () => void
  onPinChange: (uuid: string, pinned: boolean) => void
  onOpenSession: (uuid: string) => void
  onCopySessionId: (source: Session['source']) => void
  onShare?: (uuid: string) => void
}) {
  const { t } = useTranslation()
  const { name } = formatCwdLabel(cwd, projectDisplayPath)
  const count = sessions.length
  const tooltip = cwd === '(unknown)' ? undefined : cwd

  return (
    <div data-testid="project-view-directory-group" data-cwd={cwd}>
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        aria-label={open ? t('project.collapseDirectory') : t('project.expandDirectory')}
        title={tooltip}
        className="group w-full flex items-center gap-2 px-6 pt-3 pb-1 text-left text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors duration-75 select-none"
      >
        <span className="font-mono text-[11px] font-medium truncate">
          {name}
        </span>
        {count > 1 && (
          <span className="font-mono text-[10px] tabular-nums flex-none">
            {count}
          </span>
        )}
        <svg
          width="9"
          height="9"
          viewBox="0 0 9 9"
          fill="none"
          aria-hidden
          className={`flex-none transition-all opacity-30 group-hover:opacity-100 ${open ? 'rotate-90' : ''}`}
        >
          <path d="M3 1.5L6 4.5L3 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div>
          {sessions.map(session => (
            <SessionRow
              key={session.sessionUuid}
              session={session}
              onPinChange={onPinChange}
              onOpenSession={onOpenSession}
              onCopySessionId={onCopySessionId}
              {...(onShare ? { onShare } : {})}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const MAX_INLINE_CHIPS = 4

function DirectoryChipStrip({
  groups,
  isolatedCwd,
  projectDisplayPath,
  onSelect,
}: {
  groups: Array<{ cwd: string; sessions: Session[] }>
  isolatedCwd: string | null
  projectDisplayPath: string | null
  onSelect: (cwd: string | null) => void
}) {
  const totalSessions = groups.reduce((sum, g) => sum + g.sessions.length, 0)
  const top = groups.slice(0, MAX_INLINE_CHIPS)
  let inline = top
  if (
    isolatedCwd !== null
    && !top.some(g => g.cwd === isolatedCwd)
    && groups.some(g => g.cwd === isolatedCwd)
  ) {
    const active = groups.find(g => g.cwd === isolatedCwd)!
    inline = [...top.slice(0, MAX_INLINE_CHIPS - 1), active]
  }
  const inlineSet = new Set(inline.map(g => g.cwd))
  const overflow = groups.filter(g => !inlineSet.has(g.cwd))

  return (
    <div data-testid="project-directory-chips" className="mt-2 flex items-center gap-1 flex-wrap">
      <DirectoryChip
        active={isolatedCwd === null}
        label="All"
        count={totalSessions}
        onClick={() => onSelect(null)}
      />
      {inline.map(g => {
        const { name } = formatCwdLabel(g.cwd, projectDisplayPath)
        return (
          <DirectoryChip
            key={g.cwd}
            active={isolatedCwd === g.cwd}
            label={name}
            title={g.cwd === '(unknown)' ? undefined : g.cwd}
            count={g.sessions.length}
            onClick={() => onSelect(g.cwd)}
          />
        )
      })}
      {overflow.length > 0 && (
        <Menu
          align="left"
          testId="project-directory-overflow"
          trigger={({ open, toggle }) => (
            <button
              type="button"
              data-testid="project-directory-overflow-trigger"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={toggle}
              className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface/60 dark:hover:bg-dark-surface/60 transition-colors"
            >
              <span>+{overflow.length} more</span>
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden className="text-warm-faint dark:text-dark-muted">
                <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          items={overflow.map(g => {
            const { name } = formatCwdLabel(g.cwd, projectDisplayPath)
            return {
              label: `${name} · ${g.sessions.length}`,
              active: isolatedCwd === g.cwd,
              onSelect: () => onSelect(g.cwd),
            }
          })}
        />
      )}
    </div>
  )
}

function DirectoryChip({
  active,
  label,
  count,
  title,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  title?: string | undefined
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid="project-directory-chip"
      data-active={active ? 'true' : undefined}
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`inline-flex items-center gap-1.5 h-6 px-2 rounded text-[11px] font-medium transition-colors ${
        active
          ? 'bg-warm-surface2 dark:bg-dark-surface2 text-warm-text dark:text-dark-text'
          : 'text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface/60 dark:hover:bg-dark-surface/60'
      }`}
    >
      <span className="truncate max-w-[120px]">{label}</span>
      <span className="font-mono tabular-nums text-[10px] text-warm-faint dark:text-dark-muted">
        {count}
      </span>
    </button>
  )
}

function cwdOf(s: Session): string {
  return s.cwd && s.cwd.length > 0 ? s.cwd : '(unknown)'
}

function formatCwdLabel(cwd: string, projectDisplayPath: string | null): { name: string; tail: string } {
  if (cwd === '(unknown)') return { name: 'no cwd', tail: '' }
  const parts = cwd.split('/').filter(Boolean)
  if (parts.length === 0) return { name: cwd, tail: '' }
  const name = parts[parts.length - 1]!
  if (projectDisplayPath && cwd === projectDisplayPath) {
    return { name, tail: 'project root' }
  }
  if (projectDisplayPath && cwd.startsWith(projectDisplayPath + '/')) {
    const rel = cwd.slice(projectDisplayPath.length + 1).split('/').filter(Boolean)
    const parent = rel.slice(0, -1).join('/')
    return { name, tail: parent }
  }
  const parent = parts.slice(0, -1).join('/')
  return { name, tail: parent ? '/' + parent : '' }
}
