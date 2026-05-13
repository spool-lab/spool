import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@spool-lab/core'
import SessionRow from './SessionRow.js'

type Props = {
  onSelectProject: (identityKey: string) => void
  onOpenSession: (uuid: string) => void
  onCopySessionId: (source: Session['source']) => void
  onShare?: (uuid: string) => void
}

type DateBucket = {
  label: string
  sessions: Session[]
}

export default function LibraryLanding({ onOpenSession, onCopySessionId, onShare }: Props) {
  const [pinnedSessions, setPinnedSessions] = useState<Session[]>([])
  const [recentSessions, setRecentSessions] = useState<Session[] | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      window.spool.listPinnedSessions(),
      window.spool.listSessions(200),
    ])
      .then(([pinned, recent]) => {
        if (cancelled) return
        const pinnedUuids = new Set(pinned.map(s => s.sessionUuid))
        setPinnedSessions(pinned)
        setRecentSessions(recent.filter(s => !pinnedUuids.has(s.sessionUuid)))
      })
      .catch(() => {
        if (!cancelled) {
          setPinnedSessions([])
          setRecentSessions([])
        }
      })
    return () => { cancelled = true }
  }, [reloadKey])

  useEffect(() => {
    function bump() { setReloadKey(k => k + 1) }
    window.addEventListener('spool:pin-change', bump)
    return () => window.removeEventListener('spool:pin-change', bump)
  }, [])

  function handlePinChange(sessionUuid: string, pinned: boolean) {
    if (pinned) {
      const candidate = recentSessions?.find(s => s.sessionUuid === sessionUuid)
      if (candidate) {
        setRecentSessions(prev => (prev ?? []).filter(s => s.sessionUuid !== sessionUuid))
        setPinnedSessions(prev => [candidate, ...prev])
      }
    } else {
      setPinnedSessions(prev => prev.filter(s => s.sessionUuid !== sessionUuid))
    }
    setReloadKey(k => k + 1)
  }

  const buckets = useMemo(
    () => (recentSessions ? bucketByDate(recentSessions) : []),
    [recentSessions],
  )
  const totalSessions = (pinnedSessions.length) + (recentSessions?.length ?? 0)

  return (
    <div data-testid="library-landing" className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto pb-12 [mask-image:linear-gradient(to_bottom,black_calc(100%_-_24px),transparent)]">
        {recentSessions === null ? (
          <SessionRowsSkeleton count={6} />
        ) : totalSessions === 0 ? (
          <p className="px-6 py-6 text-sm text-warm-faint dark:text-dark-muted">
            No sessions yet. Run <code className="font-mono bg-warm-surface dark:bg-dark-surface px-1 rounded">spool sync</code> to index your AI sessions.
          </p>
        ) : (
          <>
            {pinnedSessions.length > 0 && (
              <CollapsibleSection
                label={`PINNED · ${pinnedSessions.length} ${pinnedSessions.length === 1 ? 'session' : 'sessions'}`}
                testId="library-pinned"
              >
                <div>
                  {pinnedSessions.map(session => (
                    <SessionRow
                      key={session.sessionUuid}
                      session={session}
                      pinned
                      showProject
                      onPinChange={handlePinChange}
                      onOpenSession={onOpenSession}
                      onCopySessionId={onCopySessionId}
                      {...(onShare ? { onShare } : {})}
                    />
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {buckets.map(bucket => (
              <CollapsibleSection
                key={bucket.label}
                label={bucket.label}
                testId="library-bucket"
                dataAttr={{ 'data-bucket': bucket.label }}
              >
                {bucket.sessions.map(session => (
                  <SessionRow
                    key={session.sessionUuid}
                    session={session}
                    showProject
                    bucket={bucket.label}
                    onPinChange={handlePinChange}
                    onOpenSession={onOpenSession}
                    onCopySessionId={onCopySessionId}
                    {...(onShare ? { onShare } : {})}
                  />
                ))}
              </CollapsibleSection>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

export function CollapsibleSection({
  label,
  children,
  testId,
  dataAttr,
  defaultOpen = true,
}: {
  label: string
  children: ReactNode
  testId?: string
  dataAttr?: Record<string, string>
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div data-testid={testId} {...(dataAttr ?? {})}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="group w-full flex items-center gap-1.5 px-6 pt-3 pb-1 text-[10px] font-semibold tracking-[0.08em] text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors duration-75 select-none"
      >
        <span>{label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden
          className={`flex-none transition-all opacity-30 group-hover:opacity-100 ${open ? 'rotate-90' : ''}`}
        >
          <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && children}
    </div>
  )
}

function SessionRowsSkeleton({ count }: { count: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-5 py-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="h-4 w-12 rounded bg-warm-surface2 dark:bg-dark-surface2 opacity-60 animate-pulse" />
              <div className="h-4 w-1/2 rounded bg-warm-surface2 dark:bg-dark-surface2 opacity-60 animate-pulse" />
            </div>
            <div className="h-3 w-1/3 rounded bg-warm-surface2 dark:bg-dark-surface2 opacity-60 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function bucketSessionsByDate(sessions: Session[]): DateBucket[] {
  return bucketByDate(sessions)
}

function bucketByDate(sessions: Session[]): DateBucket[] {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86400000
  const startOfWeek = startOfToday - 6 * 86400000
  const startOfMonth = startOfToday - 30 * 86400000

  const today: Session[] = []
  const yesterday: Session[] = []
  const earlierWeek: Session[] = []
  const earlierMonth: Session[] = []
  const older: Session[] = []

  for (const session of sessions) {
    const t = Date.parse(session.startedAt)
    if (Number.isNaN(t)) {
      older.push(session)
      continue
    }
    if (t >= startOfToday) today.push(session)
    else if (t >= startOfYesterday) yesterday.push(session)
    else if (t >= startOfWeek) earlierWeek.push(session)
    else if (t >= startOfMonth) earlierMonth.push(session)
    else older.push(session)
  }

  const buckets: DateBucket[] = []
  if (today.length > 0) buckets.push({ label: 'TODAY', sessions: today })
  if (yesterday.length > 0) buckets.push({ label: 'YESTERDAY', sessions: yesterday })
  if (earlierWeek.length > 0) buckets.push({ label: 'EARLIER THIS WEEK', sessions: earlierWeek })
  if (earlierMonth.length > 0) buckets.push({ label: 'EARLIER THIS MONTH', sessions: earlierMonth })
  if (older.length > 0) buckets.push({ label: 'OLDER', sessions: older })
  return buckets
}
