import { useState } from 'react'
import type { Session } from '@spool-lab/core'
import { SourceBadge } from './Badges.js'
import PinButton from './PinButton.js'
import { formatRelativeDate } from '../../shared/formatDate.js'

type Props = {
  session: Session
  pinned?: boolean
  showProject?: boolean
  onPinChange?: (uuid: string, pinned: boolean) => void
  onOpenSession: (uuid: string) => void
  onCopySessionId: (source: Session['source']) => void
}

export default function SessionRow({ session, pinned = false, showProject = false, onPinChange, onOpenSession, onCopySessionId }: Props) {
  const [resuming, setResuming] = useState(false)
  const [copied, setCopied] = useState(false)

  const title = session.title?.trim() || '(no title)'
  const date = formatRelativeDate(session.startedAt)

  function handleOpen() {
    onOpenSession(session.sessionUuid)
  }

  async function handleResume(event: React.MouseEvent) {
    event.stopPropagation()
    setResuming(true)
    await window.spool.resumeCLI(session.sessionUuid, session.source, session.cwd ?? undefined)
    setTimeout(() => setResuming(false), 1000)
  }

  async function handleCopyId(event: React.MouseEvent) {
    event.stopPropagation()
    await navigator.clipboard.writeText(session.sessionUuid)
    onCopySessionId(session.source)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      data-testid="session-row"
      data-session-uuid={session.sessionUuid}
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleOpen()
        }
      }}
      className="group flex items-center gap-3 px-4 py-3 hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors border-b border-warm-border dark:border-dark-border cursor-pointer focus:outline-none focus:bg-warm-surface dark:focus:bg-dark-surface"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <SourceBadge source={session.source} />
          <span className="text-sm font-medium text-warm-text dark:text-dark-text truncate">
            {title}
          </span>
        </div>
        <p className="text-xs text-warm-faint dark:text-dark-muted truncate">
          {showProject && <span className="text-warm-muted dark:text-dark-muted">{session.projectDisplayName} · </span>}
          {date} · {session.messageCount} {session.messageCount === 1 ? 'message' : 'messages'}
          {session.model && ` · ${session.model}`}
        </p>
      </div>

      <div className="flex-none flex items-center gap-1">
        <span className={pinned ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity'}>
          <PinButton
            sessionUuid={session.sessionUuid}
            pinned={pinned}
            onChange={(next) => onPinChange?.(session.sessionUuid, next)}
          />
        </span>
        <span className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center gap-1">
          <button
            type="button"
            onClick={handleResume}
            title="Resume in terminal"
            aria-label="Resume in terminal"
            disabled={resuming}
            className="inline-flex items-center justify-center w-7 h-7 rounded text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {resuming ? <SpinnerIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            onClick={handleCopyId}
            title="Copy session ID"
            aria-label="Copy session ID"
            className="inline-flex items-center justify-center w-7 h-7 rounded text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </span>
      </div>
    </div>
  )
}

function PlayIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor">
      <path d="M3.5 2.5L10 6.5L3.5 10.5V2.5Z" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8.5 4.5V3C8.5 2.17 7.83 1.5 7 1.5H3C2.17 1.5 1.5 2.17 1.5 3V7C1.5 7.83 2.17 8.5 3 8.5H4.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M3 7L5.5 9.5L10 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" className="animate-spin">
      <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeOpacity="0.3" />
      <path d="M6.5 1.5A5 5 0 0111.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}
