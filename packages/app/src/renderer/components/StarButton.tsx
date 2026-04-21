import { Star } from 'lucide-react'
import type { StarKind } from '@spool-lab/core'

type Size = 'sm' | 'md'

type Props = {
  kind: StarKind
  uuid: string
  isStarred: boolean
  onToggle: (kind: StarKind, uuid: string, next: boolean) => void
  /** sm = 12px icon (inline in rows), md = 15px (detail header / unstar shortcut). */
  size?: Size
  /** Set when the button is rendered inside an `<a>` — prevents the anchor from navigating. */
  insideAnchor?: boolean
  /** Testid to attach. */
  testId?: string
}

export default function StarButton({
  kind,
  uuid,
  isStarred,
  onToggle,
  size = 'sm',
  insideAnchor = false,
  testId,
}: Props) {
  const iconSize = size === 'md' ? 15 : 12
  const box = size === 'md' ? 'h-[26px] w-[26px]' : 'w-5 h-5'
  const label = kind === 'capture' ? 'capture' : 'session'

  return (
    <button
      onClick={(e) => {
        if (insideAnchor) e.preventDefault()
        e.stopPropagation()
        onToggle(kind, uuid, !isStarred)
      }}
      title={isStarred ? 'Unstar' : 'Star for quick access'}
      aria-label={isStarred ? `Unstar ${label}` : `Star ${label}`}
      aria-pressed={isStarred}
      {...(testId ? { 'data-testid': testId } : {})}
      data-starred={isStarred ? '1' : '0'}
      className={[
        'flex-none flex items-center justify-center rounded transition-colors',
        box,
        isStarred
          ? 'text-accent dark:text-accent-dark hover:opacity-70'
          : 'text-warm-faint dark:text-dark-muted hover:text-accent dark:hover:text-accent-dark',
      ].join(' ')}
    >
      <Star
        size={iconSize}
        strokeWidth={1.8}
        {...(isStarred ? { fill: 'currentColor' } : {})}
      />
    </button>
  )
}
