import { useEffect, useMemo, useState } from 'react'
import type { ProjectGroup, Session, SessionSource, ProjectSessionSortOrder } from '@spool-lab/core'
import SessionRow from './SessionRow.js'
import { SearchTrigger } from './LibraryLanding.js'
import { getSessionSourceColor, getSessionSourceLabel } from '../../shared/sessionSources.js'
import { formatRelativeDate } from '../../shared/formatDate.js'

type Props = {
  identityKey: string
  onOpenSession: (uuid: string) => void
  onCopySessionId: (source: Session['source']) => void
  onOpenSearch?: () => void
}

const SORT_OPTIONS: { value: ProjectSessionSortOrder; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'most_messages', label: 'Most messages' },
  { value: 'title', label: 'Title' },
]

export default function ProjectView({ identityKey, onOpenSession, onCopySessionId, onOpenSearch }: Props) {
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
    setSessions(null)
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
      <div className="flex-none px-6 pt-5 pb-3 border-b border-warm-border dark:border-dark-border">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-warm-text dark:text-dark-text">
            {group?.displayName ?? identityKey}
          </h1>
          {onOpenSearch && <SearchTrigger onClick={onOpenSearch} />}
        </div>
        {meta && (
          <p className="mt-1 text-xs text-warm-muted dark:text-dark-muted flex items-center gap-2 flex-wrap">
            <span>{meta.count} {meta.count === 1 ? 'session' : 'sessions'}</span>
            {meta.lastActivity && <><span aria-hidden>·</span><span>Updated {meta.lastActivity}</span></>}
            {meta.sources.length > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="flex items-center gap-1.5">
                  {meta.sources.map(src => (
                    <span key={src} className="flex items-center gap-1">
                      <span
                        aria-hidden
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: getSessionSourceColor(src) }}
                      />
                      <span>{getSessionSourceLabel(src)}</span>
                    </span>
                  ))}
                </span>
              </>
            )}
          </p>
        )}

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {availableSources.length > 1 && (
            <div className="flex items-center gap-1" role="group" aria-label="Filter by source">
              {availableSources.map(src => {
                const active = activeSources.has(src)
                return (
                  <button
                    key={src}
                    type="button"
                    data-testid="source-filter-pill"
                    data-source={src}
                    aria-pressed={active}
                    onClick={() => toggleSource(src)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      active
                        ? 'border-accent bg-accent/10 text-warm-text dark:text-dark-text'
                        : 'border-warm-border dark:border-dark-border text-warm-muted dark:text-dark-muted hover:border-accent/50'
                    }`}
                  >
                    {getSessionSourceLabel(src)}
                  </button>
                )
              })}
            </div>
          )}

          <div className="ml-auto relative">
            <select
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as ProjectSessionSortOrder)}
              aria-label="Sort sessions"
              data-testid="project-sort"
              className="appearance-none h-8 rounded-full border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface pl-3 pr-9 text-xs font-medium text-warm-text dark:text-dark-text outline-none transition-colors hover:border-accent/50 focus:border-accent"
            >
              {SORT_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <svg
              aria-hidden="true"
              viewBox="0 0 12 12"
              className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-warm-muted dark:text-dark-muted"
              fill="none"
            >
              <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
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
              <div data-testid="project-view-pinned">
                <div className="px-4 py-2 text-[10px] font-semibold tracking-[0.08em] text-warm-faint dark:text-dark-muted bg-accent/[0.04] dark:bg-accent-dark/[0.04]">
                  PINNED · {pinnedSessions.length} {pinnedSessions.length === 1 ? 'session' : 'sessions'}
                </div>
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
              </div>
            )}
            <div data-testid="project-view-recent">
              {pinnedSessions.length > 0 && sessions.length > 0 && (
                <div className="px-4 py-2 text-[10px] font-semibold tracking-[0.08em] text-warm-faint dark:text-dark-muted">
                  RECENT
                </div>
              )}
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
          </>
        )}
      </div>
    </div>
  )
}
