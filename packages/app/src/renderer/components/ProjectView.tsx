import { useEffect, useMemo, useState } from 'react'
import type { ProjectGroup, Session, SessionSource, ProjectSessionSortOrder } from '@spool-lab/core'
import SessionRow from './SessionRow.js'
import Menu from './Menu.js'
import { CollapsibleSection } from './LibraryLanding.js'
import { getSessionSourceColor, getSessionSourceLabel } from '../../shared/sessionSources.js'
import { formatRelativeDate } from '../../shared/formatDate.js'

type Props = {
  identityKey: string
  onOpenSession: (uuid: string) => void
  onCopySessionId: (source: Session['source']) => void
}

const SORT_OPTIONS: { value: ProjectSessionSortOrder; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'most_messages', label: 'Most messages' },
  { value: 'title', label: 'Title' },
]

export default function ProjectView({ identityKey, onOpenSession, onCopySessionId }: Props) {
  const [group, setGroup] = useState<ProjectGroup | null>(null)
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [pinnedSessions, setPinnedSessions] = useState<Session[]>([])
  const [sortOrder, setSortOrder] = useState<ProjectSessionSortOrder>('recent')
  const [activeSources, setActiveSources] = useState<Set<SessionSource>>(new Set())
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    setActiveSources(new Set())
    setSortOrder('recent')
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
  const meta = useMemo(() => {
    if (!group) return null
    const lastActivity = group.lastSessionAt ? formatRelativeDate(group.lastSessionAt) : null
    return { count: group.sessionCount, lastActivity, sources: group.sources }
  }, [group])

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
      <div className="flex-none px-6 pt-3 pb-3 border-b border-warm-border dark:border-dark-border">
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
              <span>{meta.count} {meta.count === 1 ? 'session' : 'sessions'}</span>
              {meta.lastActivity && <><span aria-hidden>·</span><span>Updated {meta.lastActivity}</span></>}
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
          <div className="ml-auto">
            <Menu
              align="right"
              testId="project-sort-menu"
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  data-testid="project-sort"
                  data-value={sortOrder}
                  aria-label="Sort sessions"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  onClick={toggle}
                  className="inline-flex items-center gap-1 h-7 px-2 text-xs font-medium text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors"
                >
                  <span>Sort: {SORT_OPTIONS.find(o => o.value === sortOrder)?.label ?? 'Recent'}</span>
                  <svg
                    aria-hidden="true"
                    width="9"
                    height="9"
                    viewBox="0 0 12 12"
                    className="text-warm-faint dark:text-dark-muted"
                    fill="none"
                  >
                    <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
              items={SORT_OPTIONS.map(option => ({
                label: option.label,
                active: sortOrder === option.value,
                onSelect: () => setSortOrder(option.value),
              }))}
            />
          </div>
        </div>

      </div>

      <div className="flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%_-_24px),transparent)]">
        {sessions === null ? (
          <div className="px-4 py-8 text-center text-sm text-warm-faint dark:text-dark-muted">
            Loading sessions…
          </div>
        ) : sessions.length === 0 && pinnedSessions.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-warm-muted dark:text-dark-muted">No sessions match these filters.</p>
            {activeSources.size > 0 && (
              <button
                type="button"
                onClick={() => setActiveSources(new Set())}
                className="mt-2 text-xs text-accent hover:underline"
              >
                Clear source filter
              </button>
            )}
          </div>
        ) : (
          <>
            {pinnedSessions.length > 0 && (
              <CollapsibleSection
                label={`PINNED · ${pinnedSessions.length} ${pinnedSessions.length === 1 ? 'session' : 'sessions'}`}
                accent
                testId="project-view-pinned"
              >
                <div className="bg-accent/[0.02] dark:bg-accent-dark/[0.02]">
                  {pinnedSessions.map(session => (
                    <SessionRow
                      key={session.sessionUuid}
                      session={session}
                      pinned
                      onPinChange={handlePinChange}
                      onOpenSession={onOpenSession}
                      onCopySessionId={onCopySessionId}
                    />
                  ))}
                </div>
              </CollapsibleSection>
            )}
            {pinnedSessions.length > 0 && sessions.length > 0 ? (
              <CollapsibleSection label="RECENT" testId="project-view-recent">
                {sessions.map(session => (
                  <SessionRow
                    key={session.sessionUuid}
                    session={session}
                    onPinChange={handlePinChange}
                    onOpenSession={onOpenSession}
                    onCopySessionId={onCopySessionId}
                  />
                ))}
              </CollapsibleSection>
            ) : (
              <div data-testid="project-view-recent">
                {sessions.map(session => (
                  <SessionRow
                    key={session.sessionUuid}
                    session={session}
                    onPinChange={handlePinChange}
                    onOpenSession={onOpenSession}
                    onCopySessionId={onCopySessionId}
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
