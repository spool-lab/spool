import { forwardRef, useImperativeHandle, useRef, useEffect, useMemo, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Message } from '@spool-lab/core'
import MessageBubble, { type FindRange } from './MessageBubble.js'

export interface MessageListHandle {
  scrollToMessageId: (id: number) => void
}

interface MatchState {
  ranges: FindRange[]
  offset: number
}

interface Props {
  messages: Message[]
  isDark: boolean
  showFindBar: boolean
  messageFindRanges: Map<number, MatchState>
  activeMatchIndex: number
  onActiveMatchRef: (node: HTMLElement | null) => void
  targetMessageId?: number | null
  showTargetHighlight: boolean
}

const MessageList = forwardRef<MessageListHandle, Props>(function MessageList(
  { messages, isDark, showFindBar, messageFindRanges, activeMatchIndex, onActiveMatchRef, targetMessageId, showTargetHighlight },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const idToIndex = useMemo(() => {
    const map = new Map<number, number>()
    messages.forEach((m, i) => map.set(m.id, i))
    return map
  }, [messages])

  const estimateSize = useCallback((index: number) => {
    const m = messages[index]
    if (!m) return 80
    if (m.role === 'system') return 44
    const len = m.contentText?.length ?? 0
    return Math.min(800, Math.max(80, Math.ceil(len / 60) * 22 + 64))
  }, [messages])

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: 6,
    getItemKey: (index) => messages[index]?.id ?? index,
  })

  useImperativeHandle(ref, () => ({
    scrollToMessageId(id) {
      const idx = idToIndex.get(id)
      if (idx == null) return
      virtualizer.scrollToIndex(idx, { align: 'center' })
    },
  }), [virtualizer, idToIndex])

  // When the message set changes (e.g., session swap), reset scroll to top and re-measure.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    virtualizer.measure()
  }, [messages, virtualizer])

  const items = virtualizer.getVirtualItems()

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%_-_24px),transparent)]"
      data-testid="message-list-scroll"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {items.map((virtualRow) => {
          const msg = messages[virtualRow.index]
          if (!msg) return null
          const matchState = showFindBar ? messageFindRanges.get(msg.id) : undefined
          const containsActive = matchState != null
            && activeMatchIndex >= matchState.offset
            && activeMatchIndex < matchState.offset + matchState.ranges.length
          const isTarget = msg.id === targetMessageId

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                transform: `translateY(${virtualRow.start}px)`,
                width: '100%',
              }}
              {...(isTarget ? { 'data-testid': 'target-message' } : {})}
              {...(isTarget && showTargetHighlight ? { 'data-highlighted': '1' } : {})}
              className={`border-b border-warm-border/50 dark:border-dark-border/50 transition-colors duration-700 ${
                isTarget && showTargetHighlight ? 'bg-accent/10 dark:bg-accent-dark/10' : ''
              }`}
            >
              <MessageBubble
                message={msg}
                isDark={isDark}
                {...(matchState ? { findRanges: matchState.ranges, matchIndexOffset: matchState.offset } : {})}
                activeMatchIndex={containsActive ? activeMatchIndex : -1}
                {...(containsActive ? { onActiveMatchRef } : {})}
              />
            </div>
          )
        })}
      </div>
      {messages.length === 0 && (
        <div className="flex items-center justify-center h-32 text-warm-faint dark:text-dark-muted">
          <p className="text-sm">No messages to display.</p>
        </div>
      )}
    </div>
  )
})

export default MessageList
