import { useState } from 'react'
import type { Session } from '@spool-lab/core'
import { SourceBadge } from './Badges.js'
import PinButton from './PinButton.js'
import Menu from './Menu.js'
import { formatRelativeDate } from '../../shared/formatDate.js'
import { getSessionResumeCommand } from '../../shared/resumeCommand.js'

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

  const title = session.title?.trim() || '(no title)'
  const date = formatRelativeDate(session.startedAt)

  function handleOpen() {
    onOpenSession(session.sessionUuid)
  }

  async function handleResume() {
    setResuming(true)
    await window.spool.resumeCLI(session.sessionUuid, session.source, session.cwd ?? undefined)
    setTimeout(() => setResuming(false), 1000)
  }

  async function handleCopyId() {
    await navigator.clipboard.writeText(session.sessionUuid)
    onCopySessionId(session.source)
  }

  const resumeCommand = getSessionResumeCommand(session.source, session.sessionUuid)
  async function handleCopyCommand() {
    if (!resumeCommand) return
    await navigator.clipboard.writeText(resumeCommand)
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
      className="group flex items-start gap-3 px-6 py-3 hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors border-b border-warm-border dark:border-dark-border cursor-pointer focus:outline-none focus:bg-warm-surface dark:focus:bg-dark-surface"
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

      <div className="flex-none flex items-center gap-1 -mt-0.5" onClick={(e) => e.stopPropagation()}>
        <span className={pinned ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity'}>
          <PinButton
            sessionUuid={session.sessionUuid}
            pinned={pinned}
            onChange={(next) => onPinChange?.(session.sessionUuid, next)}
          />
        </span>
        <span className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <Menu
            align="right"
            trigger={({ toggle }) => (
              <button
                type="button"
                onClick={toggle}
                title="More actions"
                aria-label="More actions"
                className="inline-flex items-center justify-center w-7 h-7 rounded text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <circle cx="3" cy="7" r="1.2" />
                  <circle cx="7" cy="7" r="1.2" />
                  <circle cx="11" cy="7" r="1.2" />
                </svg>
              </button>
            )}
            items={[
              {
                label: resuming ? 'Opening…' : 'Resume in Terminal',
                icon: resuming ? <SpinnerIcon /> : <PlayIcon />,
                onSelect: () => { void handleResume() },
                disabled: resuming,
              },
              ...(resumeCommand ? [{
                label: 'Copy resume command',
                icon: <TerminalIcon />,
                onSelect: () => { void handleCopyCommand() },
              }] : []),
              {
                label: 'Copy session ID',
                icon: <CopyIcon />,
                onSelect: () => { void handleCopyId() },
              },
            ]}
          />
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

function TerminalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4L4.5 6.5L2.5 9" />
      <path d="M6 9.5H10.5" />
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

function SpinnerIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" className="animate-spin">
      <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeOpacity="0.3" />
      <path d="M6.5 1.5A5 5 0 0111.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}
