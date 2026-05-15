import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MessagesSquare as LibraryIcon } from 'lucide-react'
import type { Session } from '@spool-lab/core'
import SessionRow from './SessionRow.js'
import { FeaturedEmptyState } from './EmptyState.js'

type BucketKey = 'today' | 'yesterday' | 'earlierWeek' | 'earlierMonth' | 'older'

type Props = {
  onSelectProject: (identityKey: string) => void
  onOpenSession: (uuid: string) => void
  onCopySessionId: (source: Session['source']) => void
  onShare?: (uuid: string) => void
}

type DateBucket = {
  /** Stable identity for keys, data attrs, and bucket prop drilling. */
  key: BucketKey
  /** Already-localized display label for headers/aria. */
  label: string
  sessions: Session[]
}

export default function LibraryLanding({ onOpenSession, onCopySessionId, onShare }: Props) {
  const { t } = useTranslation()
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

  // Cast the typed t() down to a loose `(string) => string` so it can be
  // passed to `bucketByDate`, which is called from contexts (tests,
  // SearchOverlay) that don't share the resource literal-union type.
  const tLoose: TranslateFn = (key) => (t as unknown as (k: string) => string)(key)
  const buckets = useMemo(
    () => (recentSessions ? bucketByDate(recentSessions, tLoose) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recentSessions, t],
  )
  const totalSessions = (pinnedSessions.length) + (recentSessions?.length ?? 0)

  return (
    <div data-testid="library-landing" className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto pb-12 [mask-image:linear-gradient(to_bottom,black_calc(100%_-_24px),transparent)]">
        {recentSessions === null ? (
          <SessionRowsSkeleton count={6} />
        ) : totalSessions === 0 ? (
          <FeaturedEmptyState
            icon={<LibraryIcon size={22} strokeWidth={1.5} />}
            title={t('library.empty_title')}
            hint={t('library.empty_body')}
          />
        ) : (
          <>
            {pinnedSessions.length > 0 && (
              <CollapsibleSection
                label={t('library.section_pinned', { count: pinnedSessions.length })}
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
                key={bucket.key}
                label={bucket.label}
                testId="library-bucket"
                dataAttr={{ 'data-bucket': bucket.key }}
              >
                {bucket.sessions.map(session => (
                  <SessionRow
                    key={session.sessionUuid}
                    session={session}
                    showProject
                    bucket={bucket.key}
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

type TranslateFn = (key: string) => string

export function bucketSessionsByDate(sessions: Session[], t?: TranslateFn): DateBucket[] {
  // Default labels — callers that don't have a translator (e.g. tests) get
  // the English bucket names so existing assertions keep matching.
  const fallback: TranslateFn = (key: string) => {
    switch (key) {
      case 'library.bucket_today': return 'TODAY'
      case 'library.bucket_yesterday': return 'YESTERDAY'
      case 'library.bucket_earlierWeek': return 'EARLIER THIS WEEK'
      case 'library.bucket_earlierMonth': return 'EARLIER THIS MONTH'
      case 'library.bucket_older': return 'OLDER'
      default: return key
    }
  }
  return bucketByDate(sessions, t ?? fallback)
}

function bucketByDate(sessions: Session[], t: TranslateFn): DateBucket[] {
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
  if (today.length > 0) buckets.push({ key: 'today', label: t('library.bucket_today'), sessions: today })
  if (yesterday.length > 0) buckets.push({ key: 'yesterday', label: t('library.bucket_yesterday'), sessions: yesterday })
  if (earlierWeek.length > 0) buckets.push({ key: 'earlierWeek', label: t('library.bucket_earlierWeek'), sessions: earlierWeek })
  if (earlierMonth.length > 0) buckets.push({ key: 'earlierMonth', label: t('library.bucket_earlierMonth'), sessions: earlierMonth })
  if (older.length > 0) buckets.push({ key: 'older', label: t('library.bucket_older'), sessions: older })
  return buckets
}
