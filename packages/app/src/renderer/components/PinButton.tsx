import { useState } from 'react'

type Props = {
  sessionUuid: string
  pinned: boolean
  onChange?: (pinned: boolean) => void
  size?: 'sm' | 'md'
}

export default function PinButton({ sessionUuid, pinned, onChange, size = 'sm' }: Props) {
  const [busy, setBusy] = useState(false)

  async function toggle(event: React.MouseEvent | React.KeyboardEvent) {
    event.stopPropagation()
    if (busy) return
    setBusy(true)
    const next = !pinned
    onChange?.(next)
    try {
      if (next) await window.spool.pinSession(sessionUuid)
      else await window.spool.unpinSession(sessionUuid)
    } catch {
      onChange?.(pinned)
    } finally {
      setBusy(false)
    }
  }

  const dim = size === 'md' ? 'w-8 h-8' : 'w-6 h-6'
  const icon = size === 'md' ? 16 : 11

  return (
    <button
      type="button"
      data-testid="pin-button"
      data-pinned={pinned ? '1' : '0'}
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') toggle(event)
      }}
      title={pinned ? 'Unpin from project' : 'Pin to project'}
      aria-label={pinned ? 'Unpin from project' : 'Pin to project'}
      aria-pressed={pinned}
      className={`inline-flex items-center justify-center ${dim} rounded transition-colors ${
        pinned
          ? 'text-accent dark:text-accent-dark hover:bg-warm-surface2 dark:hover:bg-dark-surface2'
          : 'text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text'
      } disabled:cursor-not-allowed`}
      disabled={busy}
    >
      <PinIcon size={icon} filled={pinned} />
    </button>
  )
}

function PinIcon({ size, filled }: { size: number; filled: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 1.5 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4" />
      <path d="M9 15l-4.5 4.5" />
      <path d="M14.5 4l5.5 5.5" />
    </svg>
  )
}
