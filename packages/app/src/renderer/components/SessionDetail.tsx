import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session, Message, StarKind } from '@spool-lab/core'
import MessageBubble, { type FindRange } from './MessageBubble.js'
import SessionFindBar from './SessionFindBar.js'
import StarButton from './StarButton.js'

type Props = {
  sessionUuid: string
  targetMessageId?: number | null
  onCopySessionId: (source: Session['source']) => void
  isStarred: boolean
  onToggleStar: (kind: StarKind, uuid: string, next: boolean) => void
}

export default function SessionDetail({ sessionUuid, targetMessageId, onCopySessionId, isStarred, onToggleStar }: Props) {
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
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
      <div className="flex items-center justify-center h-full text-neutral-400">
        <p className="text-sm">Loading...</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-400">
        <p className="text-sm">Session not found.</p>
      </div>
    )
  }

  async function handleCopySessionId() {
    if (!session) return
    await navigator.clipboard.writeText(session.sessionUuid)
    onCopySessionId(session.source)
  }

  return (
    <div className="flex flex-col h-full" data-testid="session-detail">
      {/* Session header */}
      <div className="flex items-end justify-between gap-3 flex-none px-4 py-2 border-b border-neutral-100 dark:border-neutral-800">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-neutral-500 truncate">{session.projectDisplayPath}</p>
          <p className="text-sm text-neutral-800 dark:text-neutral-200 mt-0.5 truncate">{session.title ?? '(no title)'}</p>
          <p className="text-xs text-neutral-400 mt-0.5">
            {formatDate(session.startedAt)} · {session.messageCount} messages
            {session.model && ` · ${session.model}`}
          </p>
        </div>

        <div className="flex items-end gap-1.5 flex-none self-end">
          <StarButton
            kind="session"
            uuid={sessionUuid}
            isStarred={isStarred}
            onToggle={onToggleStar}
            size="md"
            testId="session-star"
          />
          <button
            onClick={handleCopySessionId}
            title="Copy session ID for CLI resume"
            className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded px-2.5 py-1 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <rect x="4.5" y="4.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M8.5 4.5V3C8.5 2.17 7.83 1.5 7 1.5H3C2.17 1.5 1.5 2.17 1.5 3V7C1.5 7.83 2.17 8.5 3 8.5H4.5" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
            Copy Session ID
          </button>
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
      <div className="flex-1 overflow-y-auto divide-y divide-neutral-50 dark:divide-neutral-800/50">
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
          <div className="flex items-center justify-center h-32 text-neutral-400">
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
