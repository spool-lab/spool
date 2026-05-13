import { useState } from 'react'
import { SquareTerminal, MoreHorizontal, Copy, Loader2, BookText } from 'lucide-react'
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
  bucket?: string
  onPinChange?: (uuid: string, pinned: boolean) => void
  onOpenSession: (uuid: string) => void
  onCopySessionId: (source: Session['source']) => void
  onShare?: (uuid: string) => void
}

export default function SessionRow({ session, pinned = false, showProject = false, bucket, onPinChange, onOpenSession, onCopySessionId, onShare }: Props) {
  const [resuming, setResuming] = useState(false)

  const title = session.title?.trim() || '(no title)'
  const date = formatRelativeDate(session.startedAt, { bucket })
  const model = compactModel(session.model)

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
      className="group flex items-start gap-3 px-5 py-3 hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors duration-75 cursor-pointer focus:outline-none focus:bg-warm-surface dark:focus:bg-dark-surface"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <SourceBadge source={session.source} />
          <span className="text-sm font-medium text-warm-text dark:text-dark-text truncate">
            {title}
          </span>
        </div>
        <p className="pl-1.5 text-xs text-warm-faint dark:text-dark-muted truncate">
          {showProject && (
            <>
              <span className="text-warm-muted dark:text-dark-muted">{session.projectDisplayName}</span>
              {' · '}
            </>
          )}
          {date} · {session.messageCount} {session.messageCount === 1 ? 'msg' : 'msgs'}
          {model && ` · ${model}`}
        </p>
      </div>

      <div className="flex-none flex items-center gap-1 -mt-0.5" onClick={(e) => e.stopPropagation()}>
        <span
          className={
            pinned
              ? 'opacity-70 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity'
              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity'
          }
        >
          <PinButton
            sessionUuid={session.sessionUuid}
            pinned={pinned}
            onChange={(next) => onPinChange?.(session.sessionUuid, next)}
          />
        </span>
        <span className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-has-[[aria-expanded=true]]:opacity-100 transition-opacity">
          <Menu
            align="right"
            trigger={({ open, toggle }) => (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={toggle}
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={open}
                className="inline-flex items-center justify-center w-5 h-5 rounded text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors duration-75"
              >
                <MoreHorizontal size={13} strokeWidth={1.6} aria-hidden />
              </button>
            )}
            items={[
              ...(onShare ? [{
                label: 'Open in share editor',
                icon: <BookText size={14} strokeWidth={1.6} aria-hidden />,
                onSelect: () => onShare(session.sessionUuid),
              }] : []),
              {
                label: resuming ? 'Opening…' : 'Resume in Terminal',
                icon: resuming
                  ? <Loader2 size={14} strokeWidth={1.6} className="animate-spin" aria-hidden />
                  : <SquareTerminal size={14} strokeWidth={1.6} aria-hidden />,
                onSelect: () => { void handleResume() },
                disabled: resuming,
              },
              ...(resumeCommand ? [{
                label: 'Copy resume command',
                icon: <Copy size={14} strokeWidth={1.6} aria-hidden />,
                onSelect: () => { void handleCopyCommand() },
              }] : []),
              {
                label: 'Copy session ID',
                icon: <Copy size={14} strokeWidth={1.6} aria-hidden />,
                onSelect: () => { void handleCopyId() },
              },
            ]}
          />
        </span>
      </div>
    </div>
  )
}

function compactModel(model: string | null | undefined): string {
  if (!model) return ''
  const m = model.match(/^claude-(opus|sonnet|haiku)(?:-(\d+))?(?:-(\d+))?$/)
  if (!m) return model
  const name = m[1]!
  const major = m[2]
  const minor = m[3]
  if (minor) return `${name} ${major}.${minor}`
  if (major) return `${name} ${major}`
  return name
}

