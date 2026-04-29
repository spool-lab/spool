import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@spool-lab/core'
import SessionRow from './SessionRow.js'

type Props = {
  onSelectProject: (identityKey: string) => void
  onOpenSession: (uuid: string) => void
  onCopySessionId: (source: Session['source']) => void
}

type DateBucket = {
  label: string
  sessions: Session[]
}

export default function LibraryLanding({ onOpenSession, onCopySessionId }: Props) {
  const [pinnedSessions, setPinnedSessions] = useState<Session[]>([])
  const [recentSessions, setRecentSessions] = useState<Session[] | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setRecentSessions(null)
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

  const buckets = recentSessions ? bucketByDate(recentSessions) : []
  const totalSessions = (pinnedSessions.length) + (recentSessions?.length ?? 0)

  return (
    <div data-testid="library-landing" className="flex flex-col h-full overflow-hidden">
      <div className="px-6 pt-3 pb-3 flex-none">
        <h1 className="text-xl font-semibold tracking-tight text-warm-text dark:text-dark-text">
          AI Session Library
        </h1>
        <p className="mt-0.5 text-xs text-warm-muted dark:text-dark-muted">
          All your AI conversations, organized by your code projects.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto pb-12">
        {recentSessions === null ? (
          <p className="px-6 py-6 text-sm text-warm-faint dark:text-dark-muted">Loading…</p>
        ) : totalSessions === 0 ? (
          <p className="px-6 py-6 text-sm text-warm-faint dark:text-dark-muted">
            No sessions yet. Run <code className="font-mono bg-warm-surface dark:bg-dark-surface px-1 rounded">spool sync</code> to index your AI sessions.
          </p>
        ) : (
          <>
            {pinnedSessions.length > 0 && (
              <CollapsibleSection
                label={`PINNED · ${pinnedSessions.length} ${pinnedSessions.length === 1 ? 'session' : 'sessions'}`}
                accent
                testId="library-pinned"
              >
                <div className="bg-accent/[0.02] dark:bg-accent-dark/[0.02]">
                  {pinnedSessions.map(session => (
                    <SessionRow
                      key={session.sessionUuid}
                      session={session}
                      pinned
                      showProject
                      onPinChange={handlePinChange}
                      onOpenSession={onOpenSession}
                      onCopySessionId={onCopySessionId}
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
                    onPinChange={handlePinChange}
                    onOpenSession={onOpenSession}
                    onCopySessionId={onCopySessionId}
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
  accent = false,
  children,
  testId,
  dataAttr,
  defaultOpen = true,
}: {
  label: string
  accent?: boolean
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
        className={`group w-full flex items-center gap-1.5 px-6 py-2 text-[10px] font-semibold tracking-[0.08em] text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors select-none ${
          accent ? 'bg-accent/[0.04] dark:bg-accent-dark/[0.04]' : ''
        }`}
      >
        <span>{label}</span>
        <svg
          width="9"
          height="9"
          viewBox="0 0 9 9"
          fill="none"
          aria-hidden
          className={`flex-none transition-all opacity-0 group-hover:opacity-100 ${open ? 'rotate-90' : ''}`}
        >
          <path d="M3 1.5L6 4.5L3 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && children}
    </div>
  )
}

function bucketByDate(sessions: Session[]): DateBucket[] {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86400000
  const startOfWeek = startOfToday - 6 * 86400000

  const today: Session[] = []
  const yesterday: Session[] = []
  const earlierWeek: Session[] = []
  const earlier: Session[] = []

  for (const session of sessions) {
    const t = Date.parse(session.startedAt)
    if (Number.isNaN(t)) {
      earlier.push(session)
      continue
    }
    if (t >= startOfToday) today.push(session)
    else if (t >= startOfYesterday) yesterday.push(session)
    else if (t >= startOfWeek) earlierWeek.push(session)
    else earlier.push(session)
  }

  const buckets: DateBucket[] = []
  if (today.length > 0) buckets.push({ label: 'TODAY', sessions: today })
  if (yesterday.length > 0) buckets.push({ label: 'YESTERDAY', sessions: yesterday })
  if (earlierWeek.length > 0) buckets.push({ label: 'EARLIER THIS WEEK', sessions: earlierWeek })
  if (earlier.length > 0) buckets.push({ label: 'EARLIER', sessions: earlier })
  return buckets
}

export function SearchTrigger({
  onClick,
  label = 'Search…',
  fullWidth = false,
}: {
  onClick: () => void
  label?: string
  fullWidth?: boolean
}) {
  return (
    <button
      type="button"
      data-testid="search-trigger"
      onClick={onClick}
      className={`flex items-center gap-2 h-8 rounded-md border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg px-2.5 text-xs text-warm-muted dark:text-dark-muted hover:border-accent/50 hover:text-warm-text dark:hover:text-dark-text transition-colors ${fullWidth ? 'w-full' : ''}`}
    >
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="flex-none">
        <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5" />
        <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="flex-1 text-left truncate">{label}</span>
      <kbd className="font-mono text-[10px] px-1 rounded border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface flex-none">⌘K</kbd>
    </button>
  )
}
