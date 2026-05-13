import { useEffect, useState } from 'react'
import type { Session } from '@spool-lab/core'
import { SourceBadge } from './Badges.js'
import { formatRelativeDate } from '../../shared/formatDate.js'

type Props = {
  onSelect: (sessionUuid: string) => void
  onClose: () => void
}

const PICKER_LIMIT = 50

export default function NewDraftPicker({ onSelect, onClose }: Props) {
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.spool.listSessions(PICKER_LIMIT)
      .then((rows) => {
        if (cancelled) return
        setSessions(rows)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load sessions')
        setSessions([])
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-draft-picker-title"
      data-testid="new-draft-picker"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh] animate-in fade-in duration-150"
    >
      <div
        className="w-full max-w-[520px] max-h-[70vh] rounded-[10px] border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg shadow-xl flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-warm-border dark:border-dark-border">
          <h2
            id="new-draft-picker-title"
            className="text-[13px] font-semibold text-warm-text dark:text-dark-text"
          >
            Start a draft from a session
          </h2>
          <span className="font-mono text-[11px] text-warm-faint dark:text-dark-muted tabular-nums">
            Esc to close
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {sessions === null ? (
            <PickerSkeleton count={6} />
          ) : error ? (
            <p className="px-5 py-8 text-center text-sm text-warm-muted dark:text-dark-muted">
              Couldn't load sessions: {error}
            </p>
          ) : sessions.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-warm-muted dark:text-dark-muted">
              No sessions yet — index some first and they'll show up here.
            </p>
          ) : (
            <ul>
              {sessions.map((session) => (
                <li key={session.sessionUuid}>
                  <PickerRow
                    session={session}
                    onSelect={() => onSelect(session.sessionUuid)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function PickerRow({ session, onSelect }: { session: Session; onSelect: () => void }) {
  const title = session.title?.trim() || '(no title)'
  const date = formatRelativeDate(session.startedAt)
  return (
    <button
      type="button"
      data-testid="new-draft-picker-row"
      data-session-uuid={session.sessionUuid}
      onClick={onSelect}
      className="group w-full flex items-start gap-3 px-5 py-3 text-left hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors duration-75 focus:outline-none focus:bg-warm-surface dark:focus:bg-dark-surface"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <SourceBadge source={session.source} />
          <span className="text-sm font-medium text-warm-text dark:text-dark-text truncate">
            {title}
          </span>
        </div>
        <p className="pl-1.5 text-xs text-warm-faint dark:text-dark-muted truncate">
          <span className="text-warm-muted dark:text-dark-muted">{session.projectDisplayName}</span>
          {' · '}
          {date} · {session.messageCount} {session.messageCount === 1 ? 'msg' : 'msgs'}
        </p>
      </div>
    </button>
  )
}

function PickerSkeleton({ count }: { count: number }) {
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
