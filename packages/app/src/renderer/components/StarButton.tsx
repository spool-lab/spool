import { Star } from 'lucide-react'
import type { StarKind } from '@spool-lab/core'

type Size = 'sm' | 'md'

type Props = {
  uuid: string
  isStarred: boolean
  onToggle: (kind: StarKind, uuid: string, next: boolean) => void
  size?: Size
  /** Set when the button is rendered inside an `<a>` — prevents the anchor from navigating. */
  insideAnchor?: boolean
  testId?: string
}

export default function StarButton({
  uuid,
  isStarred,
  onToggle,
  size = 'sm',
  insideAnchor = false,
  testId,
}: Props) {
  const iconSize = size === 'md' ? 15 : 13
  const box = size === 'md' ? 'h-6 w-6' : 'w-5 h-5'

  return (
    <button
      onClick={(e) => {
        if (insideAnchor) e.preventDefault()
        e.stopPropagation()
        onToggle('session', uuid, !isStarred)
      }}
      title={isStarred ? 'Unstar' : 'Star for quick access'}
      aria-label={isStarred ? 'Unstar session' : 'Star session'}
      aria-pressed={isStarred}
      {...(testId ? { 'data-testid': testId } : {})}
      data-starred={isStarred ? '1' : '0'}
      className={[
        'flex-none flex items-center justify-center rounded transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
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
