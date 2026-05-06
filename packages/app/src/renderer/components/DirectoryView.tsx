import { useEffect, useState } from 'react'
import type { Session, ProjectSessionSortOrder } from '@spool-lab/core'
import SessionRow from './SessionRow.js'
import Menu from './Menu.js'

type Props = {
  slug: string
  displayPath: string
  onOpenSession: (uuid: string) => void
  onCopySessionId: (source: Session['source']) => void
}

const SORT_OPTIONS: { value: ProjectSessionSortOrder; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'most_messages', label: 'Most messages' },
  { value: 'title', label: 'Title' },
]

export default function DirectoryView({ slug, displayPath, onOpenSession, onCopySessionId }: Props) {
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [sortOrder, setSortOrder] = useState<ProjectSessionSortOrder>('recent')

  useEffect(() => {
    setSessions(null)
  }, [slug, sortOrder])

  useEffect(() => {
    let cancelled = false
    window.spool.listSessionsBySlug(slug, { sortOrder })
      .then(s => { if (!cancelled) setSessions(s) })
      .catch(() => { if (!cancelled) setSessions([]) })
    return () => { cancelled = true }
  }, [slug, sortOrder])

  const dirName = displayPath.split('/').filter(Boolean).pop() ?? displayPath

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-6 pt-6 pb-3 flex-none">
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-sm truncate" title={displayPath}>{dirName}</h2>
          <p className="font-mono text-[11px] text-warm-muted dark:text-dark-muted truncate mt-0.5" title={displayPath}>
            {displayPath}
          </p>
        </div>
        <Menu
          align="right"
          trigger={({ open, toggle }) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              className="flex-none text-[11px] text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors"
            >
              {SORT_OPTIONS.find(o => o.value === sortOrder)?.label ?? 'Recent'} ▾
            </button>
          )}
          items={SORT_OPTIONS.map(o => ({
            label: o.label,
            active: sortOrder === o.value,
            onSelect: () => setSortOrder(o.value),
          }))}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 scrollbar-none">
        {sessions === null ? (
          <div className="space-y-1.5 pt-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-warm-surface dark:bg-dark-surface animate-pulse opacity-60" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-warm-faint dark:text-dark-muted pt-4">No sessions</p>
        ) : (
          <div className="space-y-1">
            {sessions.map(s => (
              <SessionRow
                key={s.sessionUuid}
                session={s}
                onOpenSession={onOpenSession}
                onCopySessionId={onCopySessionId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
