import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { Message } from '@spool-lab/core'
import MessageBubble, { type FindRange } from './MessageBubble.js'

type DividerLabel = (iso: string, now: Date) => string

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

/** A virtualised row is either an actual message or a day-divider header. */
type Row =
  | { kind: 'msg'; msg: Message; showAvatar: boolean }
  | { kind: 'divider'; key: string; isoDay: string; label: string }

/** Stable per-local-day key used for divider grouping + dedup. */
function localDayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function makeDividerLabel(today: string, yesterday: string, locale: string | undefined): DividerLabel {
  return (iso, now) => {
    const d = new Date(iso)
    if (sameLocalDay(d, now)) return today
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    if (sameLocalDay(d, y)) return yesterday
    const opts: Intl.DateTimeFormatOptions =
      d.getFullYear() === now.getFullYear()
        ? { weekday: 'short', month: 'short', day: 'numeric' }
        : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
    return new Intl.DateTimeFormat(locale, opts).format(d)
  }
}

/** Build the virtualised row list. A divider is inserted whenever the
 *  message's local day differs from the previous row, including before the
 *  very first message. `showAvatar` is pre-computed here so itemContent
 *  stays cheap and so role-grouping resets across day boundaries (the
 *  first message after a divider always shows its avatar). */
function buildRows(messages: Message[], label: DividerLabel): Row[] {
  const rows: Row[] = []
  let prevDay: string | null = null
  let prevMsg: Message | null = null
  const now = new Date()
  for (const msg of messages) {
    const day = localDayKey(msg.timestamp)
    if (day !== prevDay) {
      rows.push({
        kind: 'divider',
        key: `div-${day}`,
        isoDay: day,
        label: label(msg.timestamp, now),
      })
      prevDay = day
      prevMsg = null
    }
    const showAvatar =
      !prevMsg || prevMsg.role !== msg.role || prevMsg.role === 'system'
    rows.push({ kind: 'msg', msg, showAvatar })
    prevMsg = msg
  }
  return rows
}

const MessageList = forwardRef<MessageListHandle, Props>(function MessageList(
  { messages, isDark, showFindBar, messageFindRanges, activeMatchIndex, onActiveMatchRef, targetMessageId, showTargetHighlight },
  ref,
) {
  const { t, i18n } = useTranslation()
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)

  const dividerLabel = useMemo(
    () => makeDividerLabel(t('session.divider_today'), t('session.divider_yesterday'), i18n.language),
    [t, i18n.language],
  )
  const rows = useMemo(() => buildRows(messages, dividerLabel), [messages, dividerLabel])

  // Maps a message id to its row index. Row indices include day dividers,
  // so this is the only correct way to translate "scroll to message X" into
  // a Virtuoso index after dividers are inserted.
  const idToRowIndex = useMemo(() => {
    const map = new Map<number, number>()
    rows.forEach((row, i) => {
      if (row.kind === 'msg') map.set(row.msg.id, i)
    })
    return map
  }, [rows])

  // Captured once at mount: Virtuoso reads this before its first paint, so the
  // target row is already centered when the user sees the list. Subsequent
  // target changes (same session, different match) flow through the imperative
  // scrollToMessageId handle. Cross-session navigation is expected to remount
  // this component (parent should pass `key={sessionUuid}`), which re-engages
  // initialTopMostItemIndex with the fresh target.
  const initialIndex = useMemo(() => {
    if (targetMessageId == null) return undefined
    const idx = idToRowIndex.get(targetMessageId)
    return idx == null ? undefined : { index: idx, align: 'center' as const }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeHandle(ref, () => ({
    scrollToMessageId(id) {
      const idx = idToRowIndex.get(id)
      if (idx == null) return
      virtuosoRef.current?.scrollIntoView({ index: idx, align: 'center', behavior: 'auto' })
    },
  }), [idToRowIndex])

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
      data={rows}
      computeItemKey={(_index, row) => row.kind === 'msg' ? `m-${row.msg.id}` : row.key}
      defaultItemHeight={64}
      {...(initialIndex ? { initialTopMostItemIndex: initialIndex } : {})}
      increaseViewportBy={400}
      data-testid="message-list-scroll"
      className="flex-1 [mask-image:linear-gradient(to_bottom,black_calc(100%_-_24px),transparent)]"
      itemContent={(index, row) => {
        if (row.kind === 'divider') {
          return (
            <div
              data-index={index}
              data-testid="day-divider"
              data-day={row.isoDay}
              className="px-6 pt-5 pb-2 flex items-center gap-3 select-none"
            >
              <span className="flex-1 h-px bg-warm-border dark:bg-dark-border" />
              <span className="text-[10px] font-semibold tracking-[0.08em] uppercase text-warm-faint dark:text-dark-muted">
                {row.label}
              </span>
              <span className="flex-1 h-px bg-warm-border dark:bg-dark-border" />
            </div>
          )
        }
        const msg = row.msg
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
            className={`transition-colors duration-700 ${
              isTarget && showTargetHighlight ? 'bg-accent/10 dark:bg-accent-dark/10' : ''
            }`}
          >
            <MessageBubble
              message={msg}
              isDark={isDark}
              showAvatar={row.showAvatar}
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
