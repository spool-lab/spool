import { useEffect, useRef, useState, type ReactNode } from 'react'

type MenuItem = {
  label: string
  icon?: ReactNode
  onSelect: () => void
  active?: boolean
  disabled?: boolean
}

type Props = {
  trigger: (params: { open: boolean; toggle: () => void }) => ReactNode
  items: MenuItem[]
  align?: 'left' | 'right'
  testId?: string
}

export default function Menu({ trigger, items, align = 'right', testId }: Props) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative inline-block" data-testid={testId}>
      {trigger({ open, toggle: () => setOpen(o => !o) })}
      {open && (
        <div
          role="menu"
          className={`absolute z-50 top-full mt-1 min-w-[160px] rounded-lg border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface shadow-lg overflow-hidden ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
          onClick={(event) => event.stopPropagation()}
        >
          {items.map((item, index) => (
            <button
              key={index}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={(event) => {
                event.stopPropagation()
                if (item.disabled) return
                item.onSelect()
                setOpen(false)
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                item.active
                  ? 'text-accent dark:text-accent-dark bg-accent/10 dark:bg-accent-dark/10'
                  : 'text-warm-text dark:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {item.icon && <span className="flex-none w-3.5 h-3.5 flex items-center justify-center">{item.icon}</span>}
              <span className="flex-1 truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
