import type { ReactNode } from 'react'
import type { Message } from '@spool-lab/core'

export type FindRange = {
  start: number
  end: number
}

interface Props {
  message: Message
  findRanges?: FindRange[] | undefined
  matchIndexOffset?: number | undefined
  activeMatchIndex?: number | undefined
  onActiveMatchRef?: ((node: HTMLElement | null) => void) | undefined
}

export default function MessageBubble({
  message,
  findRanges = [],
  matchIndexOffset = 0,
  activeMatchIndex = -1,
  onActiveMatchRef,
}: Props) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const contentText = message.contentText || (isSystem ? '(summary)' : '')

  if (isSystem) {
    return (
      <div className="px-6 py-2">
        <div className="bg-neutral-100 dark:bg-neutral-800/60 rounded px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400 italic">
          {renderHighlightedText(contentText, findRanges, matchIndexOffset, activeMatchIndex, onActiveMatchRef)}
        </div>
      </div>
    )
  }

  return (
    <div className={`px-6 py-2 ${isUser ? '' : ''}`}>
      <div className="flex items-start gap-2">
        <div className={`flex-none w-5 h-5 rounded-full mt-0.5 flex items-center justify-center text-[9px] font-bold ${
          isUser
            ? 'bg-blue-500 text-white'
            : 'bg-neutral-700 text-white dark:bg-neutral-300 dark:text-neutral-900'
        }`}>
          {isUser ? 'U' : 'A'}
        </div>
        <div className="flex-1 min-w-0">
          {message.toolNames.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1">
              {message.toolNames.map((name) => (
                <span key={name} className="text-[10px] font-mono bg-neutral-100 dark:bg-neutral-800 text-neutral-500 px-1.5 py-0.5 rounded">
                  {name}
                </span>
              ))}
            </div>
          )}
          <p className="text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed whitespace-pre-wrap break-words select-text cursor-text">
            {message.contentText
              ? renderHighlightedText(contentText, findRanges, matchIndexOffset, activeMatchIndex, onActiveMatchRef)
              : <span className="text-neutral-400 italic">(tool use)</span>}
          </p>
          <p className="text-[10px] text-neutral-400 mt-1">{formatTime(message.timestamp)}</p>
        </div>
      </div>
    </div>
  )
}

function renderHighlightedText(
  text: string,
  ranges: FindRange[],
  matchIndexOffset: number,
  activeMatchIndex: number,
  onActiveMatchRef?: ((node: HTMLElement | null) => void) | undefined,
): ReactNode {
  if (!ranges.length) return text

  const parts: ReactNode[] = []
  let cursor = 0

  ranges.forEach((range, localIndex) => {
    if (range.start > cursor) {
      parts.push(text.slice(cursor, range.start))
    }

    const matchText = text.slice(range.start, range.end)
    const globalIndex = matchIndexOffset + localIndex
    const isActive = globalIndex === activeMatchIndex

    parts.push(
      <mark
        key={`${globalIndex}-${range.start}-${range.end}`}
        ref={isActive ? onActiveMatchRef ?? null : null}
        data-testid={isActive ? 'session-find-active-match' : undefined}
        className="font-semibold transition-colors"
        style={{ color: 'var(--color-accent)', background: 'transparent' }}
      >
        {matchText}
      </mark>,
    )

    cursor = range.end
  })

  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }

  return parts
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString() } catch { return '' }
}
