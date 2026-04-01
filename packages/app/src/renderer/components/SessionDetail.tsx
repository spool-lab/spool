import { useEffect, useState, useRef } from 'react'
import type { Session, Message } from '@spool/core'
import MessageBubble from './MessageBubble.js'

type Props = {
  sessionUuid: string
  targetMessageId?: number | null
  onCopySessionId: (source: Session['source']) => void
}

export default function SessionDetail({ sessionUuid, targetMessageId, onCopySessionId }: Props) {
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [highlightedId, setHighlightedId] = useState<number | null>(null)
  const targetRef = useRef<HTMLDivElement | null>(null)

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
      targetRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedId(targetMessageId)
      const timer = setTimeout(() => setHighlightedId(null), 2000)
      return () => clearTimeout(timer)
    }
  }, [loading, targetMessageId])

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
    <div className="flex flex-col h-full">
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

        <button
          onClick={handleCopySessionId}
          title="Copy session ID for CLI resume"
          className="flex items-center gap-1.5 self-end text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded px-2.5 py-1 transition-colors flex-none"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <rect x="4.5" y="4.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M8.5 4.5V3C8.5 2.17 7.83 1.5 7 1.5H3C2.17 1.5 1.5 2.17 1.5 3V7C1.5 7.83 2.17 8.5 3 8.5H4.5" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
          Copy Session ID
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto divide-y divide-neutral-50 dark:divide-neutral-800/50">
        {messages.map((msg) => (
          <div
            key={msg.id}
            ref={msg.id === targetMessageId ? targetRef : undefined}
            className={`transition-colors duration-700 ${
              msg.id === highlightedId
                ? 'bg-accent/10 dark:bg-accent-dark/10'
                : ''
            }`}
          >
            <MessageBubble message={msg} />
          </div>
        ))}
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
