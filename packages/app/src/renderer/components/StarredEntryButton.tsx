import { Star } from 'lucide-react'

type Props = {
  count: number
  active: boolean
  onClick: () => void
}

export default function StarredEntryButton({ count, active, onClick }: Props) {
  const hasCount = count > 0
  const highlighted = active || hasCount
  return (
    <button
      onClick={onClick}
      title={active ? 'Back to search' : `Starred (${count})`}
      aria-label={active ? 'Return to search' : 'View starred sessions'}
      aria-pressed={active}
      data-testid="starred-entry"
      className={[
        'flex items-center gap-1 h-7 rounded-full transition-colors flex-none select-none',
        hasCount ? 'px-2.5' : 'px-1.5',
        active
          ? 'bg-accent/10 dark:bg-accent-dark/10 text-accent dark:text-accent-dark'
          : 'text-warm-muted dark:text-dark-muted hover:text-accent dark:hover:text-accent-dark hover:bg-warm-surface dark:hover:bg-dark-surface',
      ].join(' ')}
    >
      <Star
        size={13}
        strokeWidth={1.8}
        fill={highlighted ? 'currentColor' : 'none'}
        className={highlighted ? 'flex-none text-accent dark:text-accent-dark' : 'flex-none'}
      />
      {hasCount && <span className="text-[11px] font-medium tabular-nums leading-none">{count}</span>}
    </button>
  )
}
