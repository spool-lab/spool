import type { ReactNode } from 'react'

interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
  hideLabel?: boolean
  testId?: string
}

interface Props<T extends string> {
  value: T
  onChange: (value: T) => void
  options: Array<SegmentedOption<T>>
  compact?: boolean
  ariaLabel?: string
}

export default function SegmentedPill<T extends string>({
  value,
  onChange,
  options,
  compact = false,
  ariaLabel,
}: Props<T>) {
  return (
    <div
      className="flex bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border rounded-[20px] p-[2px] gap-[1px]"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          data-testid={option.testId}
          onClick={() => onChange(option.value)}
          className={[
            'flex items-center gap-1 rounded-[16px] text-[11px] font-medium cursor-pointer border-none transition-all duration-[120ms]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-0',
            compact ? 'px-2 py-[3px]' : 'px-2.5 py-1',
            value === option.value
              ? 'bg-warm-bg dark:bg-dark-bg text-warm-text dark:text-dark-text shadow-sm'
              : 'bg-transparent text-warm-muted dark:text-dark-muted',
          ].join(' ')}
        >
          {option.icon}
          {!option.hideLabel && <span>{option.label}</span>}
        </button>
      ))}
    </div>
  )
}
