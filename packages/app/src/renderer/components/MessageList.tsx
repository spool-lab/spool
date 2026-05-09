import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
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
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)

  const idToIndex = useMemo(() => {
    const map = new Map<number, number>()
    messages.forEach((m, i) => map.set(m.id, i))
    return map
  }, [messages])

  // Captured once at mount: Virtuoso reads this before its first paint, so the
  // target row is already centered when the user sees the list. Subsequent
  // target changes (same session, different match) flow through the imperative
  // scrollToMessageId handle. Cross-session navigation is expected to remount
  // this component (parent should pass `key={sessionUuid}`), which re-engages
  // initialTopMostItemIndex with the fresh target.
  const initialIndex = useMemo(() => {
    if (targetMessageId == null) return undefined
    const idx = idToIndex.get(targetMessageId)
    return idx == null ? undefined : { index: idx, align: 'center' as const }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeHandle(ref, () => ({
    scrollToMessageId(id) {
      const idx = idToIndex.get(id)
      if (idx == null) return
      virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center' })
    },
  }), [idToIndex])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-warm-faint dark:text-dark-muted">
        <p className="text-sm">No messages to display.</p>
      </div>
    )
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      data={messages}
      computeItemKey={(_index, msg) => msg.id}
      {...(initialIndex ? { initialTopMostItemIndex: initialIndex } : {})}
      increaseViewportBy={400}
      data-testid="message-list-scroll"
      className="flex-1 [mask-image:linear-gradient(to_bottom,black_calc(100%_-_24px),transparent)]"
      itemContent={(index, msg) => {
        const matchState = showFindBar ? messageFindRanges.get(msg.id) : undefined
        const containsActive = matchState != null
          && activeMatchIndex >= matchState.offset
          && activeMatchIndex < matchState.offset + matchState.ranges.length
        const isTarget = msg.id === targetMessageId

        return (
          <div
            data-index={index}
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
      }}
    />
  )
})

export default MessageList
