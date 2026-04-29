import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session, Message } from '@spool-lab/core'
import MessageBubble, { type FindRange } from './MessageBubble.js'
import SessionFindBar from './SessionFindBar.js'
import PinButton from './PinButton.js'
import Menu from './Menu.js'
import { getSessionResumeCommand } from '../../shared/resumeCommand.js'
import { getSessionSourceColor, getSessionSourceShortLabel } from '../../shared/sessionSources.js'
import { formatRelativeDate } from '../../shared/formatDate.js'

type Props = {
  sessionUuid: string
  targetMessageId?: number | null
  onCopySessionId: (source: Session['source']) => void
  onBack?: () => void
}

export default function SessionDetail({ sessionUuid, targetMessageId, onCopySessionId, onBack }: Props) {
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [pinned, setPinned] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [commandCopied, setCommandCopied] = useState(false)
  const [showFindBar, setShowFindBar] = useState(false)
  const [showTargetHighlight, setShowTargetHighlight] = useState(false)
  const [findFocusNonce, setFindFocusNonce] = useState(0)
  const [findResultNonce, setFindResultNonce] = useState(0)
  const [findQuery, setFindQuery] = useState('')
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const targetRef = useRef<HTMLDivElement | null>(null)
  const activeFindMatchRef = useRef<HTMLElement | null>(null)
  const isMacLike = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

  const normalizedFindQuery = findQuery.trim().toLocaleLowerCase()
  const {
    messageFindRanges,
    totalFindMatches,
  } = useMemo(() => {
    let offset = 0
    const rangesByMessage = new Map<number, { ranges: FindRange[]; offset: number }>()

    for (const message of messages) {
      const ranges = normalizedFindQuery
        ? getFindRanges(message.contentText || (message.role === 'system' ? '(summary)' : ''), normalizedFindQuery)
        : []
      rangesByMessage.set(message.id, { ranges, offset })
      offset += ranges.length
    }

    return {
      messageFindRanges: rangesByMessage,
      totalFindMatches: offset,
    }
  }, [messages, normalizedFindQuery])

  const activeMatchOrdinal = totalFindMatches > 0 ? activeMatchIndex + 1 : 0

  const clearFind = useCallback(() => {
    setFindQuery('')
    setActiveMatchIndex(0)
  }, [])

  const closeFindBar = useCallback(() => {
    setShowFindBar(false)
    clearFind()
  }, [clearFind])

  const runFind = useCallback((query: string) => {
    setFindQuery(query)
    setActiveMatchIndex(0)
  }, [])

  const findNext = useCallback(() => {
    if (totalFindMatches === 0) return
    setActiveMatchIndex((value) => (value + 1) % totalFindMatches)
  }, [totalFindMatches])

  const findPrevious = useCallback(() => {
    if (totalFindMatches === 0) return
    setActiveMatchIndex((value) => (value - 1 + totalFindMatches) % totalFindMatches)
  }, [totalFindMatches])

  useEffect(() => {
    setLoading(true)
    window.spool.getSession(sessionUuid).then((result) => {
      if (result) {
        setSession(result.session)
        setMessages(result.messages)
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [sessionUuid])

  useEffect(() => {
    let cancelled = false
    window.spool.getPinnedUuids()
      .then(uuids => { if (!cancelled) setPinned(uuids.includes(sessionUuid)) })
      .catch(() => { if (!cancelled) setPinned(false) })
    return () => { cancelled = true }
  }, [sessionUuid])

  useEffect(() => {
    if (!loading && targetMessageId && targetRef.current) {
      targetRef.current.scrollIntoView({ behavior: 'instant', block: 'center' })
      setShowTargetHighlight(true)
      const timer = setTimeout(() => setShowTargetHighlight(false), 2000)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [loading, targetMessageId])

  useEffect(() => {
    setShowFindBar(false)
    setFindFocusNonce(0)
    setFindResultNonce(0)
    clearFind()
  }, [sessionUuid, clearFind])

  useEffect(() => {
    if (!normalizedFindQuery || totalFindMatches === 0) {
      setActiveMatchIndex(0)
      return
    }

    setActiveMatchIndex((value) => Math.min(value, totalFindMatches - 1))
  }, [normalizedFindQuery, totalFindMatches])

  useEffect(() => {
    if (!showFindBar) return
    setFindResultNonce((value) => value + 1)
  }, [showFindBar, totalFindMatches, activeMatchIndex])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const hasPrimaryModifier = isMacLike
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey

      const isFindShortcut = (event.metaKey || event.ctrlKey)
        && !event.altKey
        && !event.shiftKey
        && event.key.toLowerCase() === 'f'

      const isFindPreviousShortcut = showFindBar
        && hasPrimaryModifier
        && !event.altKey
        && !event.shiftKey
        && event.key === 'ArrowLeft'

      const isFindNextShortcut = showFindBar
        && hasPrimaryModifier
        && !event.altKey
        && !event.shiftKey
        && event.key === 'ArrowRight'

      if (isFindShortcut) {
        event.preventDefault()
        setShowFindBar(true)
        setFindFocusNonce((value) => value + 1)
        return
      }

      if (isFindPreviousShortcut) {
        event.preventDefault()
        findPrevious()
        return
      }

      if (isFindNextShortcut) {
        event.preventDefault()
        findNext()
        return
      }

      if (event.key === 'Escape' && showFindBar) {
        event.preventDefault()
        closeFindBar()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeFindBar, findNext, findPrevious, isMacLike, showFindBar])

  useEffect(() => {
    if (!showFindBar || totalFindMatches === 0) return
    activeFindMatchRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' })
  }, [showFindBar, activeMatchIndex, totalFindMatches])

  const bindActiveFindMatch = useCallback((node: HTMLElement | null) => {
    activeFindMatchRef.current = node
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-warm-faint dark:text-dark-muted">
        <p className="text-sm">Loading…</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center h-full text-warm-faint dark:text-dark-muted">
        <p className="text-sm">Session not found.</p>
      </div>
    )
  }

  async function handleCopySessionId() {
    if (!session) return
    await navigator.clipboard.writeText(session.sessionUuid)
    onCopySessionId(session.source)
  }

  async function handleCopyCommand() {
    if (!session) return
    const command = getSessionResumeCommand(session.source, session.sessionUuid, session.cwd)
    if (!command) return
    await navigator.clipboard.writeText(command)
    setCommandCopied(true)
    setTimeout(() => setCommandCopied(false), 1500)
  }

  async function handleResume() {
    if (!session) return
    setResuming(true)
    await window.spool.resumeCLI(session.sessionUuid, session.source, session.cwd ?? undefined)
    setTimeout(() => setResuming(false), 1000)
  }

  const resumeCommandAvailable = Boolean(session && getSessionResumeCommand(session.source, session.sessionUuid))

  return (
    <div className="flex flex-col h-full" data-testid="session-detail">
      {/* Session header */}
      <div className="flex-none flex items-start gap-3 px-6 pt-3 pb-3 border-b border-warm-border dark:border-dark-border">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            title="Back"
            className="flex-none mt-1 flex items-center justify-center w-5 h-5 rounded text-warm-muted dark:text-dark-muted hover:bg-warm-surface dark:hover:bg-dark-surface hover:text-warm-text dark:hover:text-dark-text transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
              <path d="M8 3L4 6.5L8 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}

        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-medium text-warm-text dark:text-dark-text truncate" title={session.title ?? undefined}>
            {session.title ?? '(no title)'}
          </h2>

          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-warm-faint dark:text-dark-muted min-w-0">
            <span className="font-mono truncate" title={session.projectDisplayPath}>{session.projectDisplayPath}</span>
            <span aria-hidden>·</span>
            <span className="flex-none">{session.messageCount} {session.messageCount === 1 ? 'message' : 'messages'}</span>
            <span aria-hidden>·</span>
            <span className="flex-none">{formatRelativeDate(session.startedAt)}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1 flex-none">
              <span
                aria-hidden
                className="block w-1.5 h-1.5 rounded-full"
                style={{ background: getSessionSourceColor(session.source) }}
              />
              <span className="font-mono">{getSessionSourceShortLabel(session.source)}</span>
            </span>
          </p>
        </div>

        <div className="flex-none self-end flex items-center gap-1.5">
          <PinButton
            sessionUuid={session.sessionUuid}
            pinned={pinned}
            onChange={setPinned}
          />

          <button
            data-testid="detail-resume"
            onClick={handleResume}
            disabled={resuming}
            title="Resume session in Terminal"
            className="flex items-center gap-1.5 text-xs font-semibold text-white bg-accent hover:bg-accent/90 dark:bg-accent-dark dark:hover:bg-accent-dark/90 rounded-md px-3 py-1.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor">
              <path d="M3 2L9 5.5L3 9V2Z" />
            </svg>
            {resuming ? 'Opening…' : 'Resume in Terminal'}
          </button>

          <Menu
            align="right"
            testId="detail-actions-menu"
            trigger={({ toggle }) => (
              <button
                type="button"
                onClick={toggle}
                title="More actions"
                aria-label="More actions"
                className="inline-flex items-center justify-center w-7 h-7 rounded-md text-warm-muted dark:text-dark-muted hover:bg-warm-surface dark:hover:bg-dark-surface hover:text-warm-text dark:hover:text-dark-text transition-colors"
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
                label: 'Copy session ID',
                onSelect: () => { void handleCopySessionId() },
              },
              ...(resumeCommandAvailable ? [{
                label: commandCopied ? 'Copied!' : 'Copy resume command',
                onSelect: () => { void handleCopyCommand() },
              }] : []),
            ]}
          />
        </div>
      </div>

      <SessionFindBar
        visible={showFindBar}
        focusNonce={findFocusNonce}
        resultNonce={findResultNonce}
        query={findQuery}
        matches={totalFindMatches}
        activeMatchOrdinal={activeMatchOrdinal}
        onChange={runFind}
        onNext={findNext}
        onPrevious={findPrevious}
        onClose={closeFindBar}
      />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto divide-y divide-warm-border/50 dark:divide-dark-border/50">
        {messages.map((msg) => {
          const matchState = messageFindRanges.get(msg.id)

          return (
          <div
            key={msg.id}
            ref={msg.id === targetMessageId ? targetRef : undefined}
            {...(msg.id === targetMessageId ? { 'data-testid': 'target-message' } : {})}
            {...(msg.id === targetMessageId && showTargetHighlight ? { 'data-highlighted': '1' } : {})}
            className={msg.id === targetMessageId
              ? `transition-colors duration-700 ${showTargetHighlight ? 'bg-accent/10 dark:bg-accent-dark/10' : ''}`
              : undefined}
          >
            <MessageBubble
              message={msg}
              findRanges={showFindBar ? matchState?.ranges : undefined}
              matchIndexOffset={matchState?.offset}
              activeMatchIndex={showFindBar ? activeMatchIndex : -1}
              onActiveMatchRef={bindActiveFindMatch}
            />
          </div>
          )
        })}
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-32 text-warm-faint dark:text-dark-muted">
            <p className="text-sm">No messages to display.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleString() } catch { return iso }
}

function getFindRanges(text: string, normalizedQuery: string): FindRange[] {
  if (!normalizedQuery || !text) return []

  const lowerText = text.toLocaleLowerCase()
  const ranges: FindRange[] = []
  let fromIndex = 0

  while (fromIndex < lowerText.length) {
    const index = lowerText.indexOf(normalizedQuery, fromIndex)
    if (index === -1) break
    ranges.push({ start: index, end: index + normalizedQuery.length })
    fromIndex = index + Math.max(normalizedQuery.length, 1)
  }

  return ranges
}
