import { useCallback, useEffect, useRef } from 'react'

type Props = {
  visible: boolean
  focusNonce: number
  resultNonce: number
  query: string
  matches: number
  activeMatchOrdinal: number
  onChange: (query: string) => void
  onNext: () => void
  onPrevious: () => void
  onClose: () => void
}

export default function SessionFindBar({
  visible,
  focusNonce,
  resultNonce,
  query,
  matches,
  activeMatchOrdinal,
  onChange,
  onNext,
  onPrevious,
  onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const selectionRef = useRef<{ start: number; end: number } | null>(null)
  const previousShortcutLabel = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘←' : 'Ctrl+←'
  const nextShortcutLabel = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘→' : 'Ctrl+→'

  const rememberSelection = useCallback((input: HTMLInputElement) => {
    const start = input.selectionStart ?? input.value.length
    const end = input.selectionEnd ?? start
    selectionRef.current = { start, end }
  }, [])

  const focusInput = useCallback((mode: 'end' | 'preserve') => {
    const input = inputRef.current
    if (!input) return

    input.focus()

    if (mode === 'preserve' && selectionRef.current) {
      const start = Math.min(selectionRef.current.start, input.value.length)
      const end = Math.min(selectionRef.current.end, input.value.length)
      input.setSelectionRange(start, end)
      return
    }

    const caret = input.value.length
    input.setSelectionRange(caret, caret)
    selectionRef.current = { start: caret, end: caret }
  }, [])

  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => {
      focusInput('end')
    })
  }, [visible, focusNonce, focusInput])

  useEffect(() => {
    if (!visible) return
    const input = inputRef.current
    if (!input || document.activeElement === input) return
    requestAnimationFrame(() => {
      focusInput('preserve')
    })
  }, [visible, resultNonce, focusInput])

  if (!visible) return null

  const hasQuery = query.trim().length > 0
  const hasMatches = matches > 0
  const statusLabel = !hasQuery
    ? 'Type to find in this session'
    : hasMatches
      ? `${activeMatchOrdinal} / ${matches}`
      : 'No matches'

  return (
    <div className="flex items-center gap-2 border-b border-warm-border dark:border-dark-border px-4 py-2 bg-warm-surface/70 dark:bg-dark-surface/70 backdrop-blur-sm">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) => {
          rememberSelection(event.currentTarget)
          onChange(event.target.value)
        }}
        onClick={(event) => rememberSelection(event.currentTarget)}
        onKeyUp={(event) => rememberSelection(event.currentTarget)}
        onSelect={(event) => rememberSelection(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (event.shiftKey) {
              onPrevious()
            } else {
              onNext()
            }
            rememberSelection(event.currentTarget)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
        placeholder="Find in session…"
        className="min-w-0 flex-1 rounded-full border border-warm-border dark:border-dark-border bg-warm-bg/90 dark:bg-dark-bg px-3 py-1.5 text-sm text-warm-text dark:text-dark-text outline-none placeholder:text-warm-faint dark:placeholder:text-dark-muted transition-[border-color,box-shadow,background-color] focus:border-accent/45 dark:focus:border-accent-dark/55 focus:bg-white dark:focus:bg-dark-surface2 focus:shadow-[0_0_0_3px_rgba(200,90,0,0.08)] dark:focus:shadow-[0_0_0_3px_rgba(240,112,32,0.12)]"
        autoComplete="off"
        spellCheck={false}
        data-testid="session-find-input"
      />
      <span
        className="min-w-24 text-right text-xs text-warm-muted dark:text-dark-muted"
        data-testid="session-find-status"
      >
        {statusLabel}
      </span>
      <button
        type="button"
        onClick={onPrevious}
        disabled={!hasQuery || !hasMatches}
        className="rounded-full border border-warm-border dark:border-dark-border px-2 py-1 text-xs text-warm-muted dark:text-dark-muted transition-colors enabled:hover:text-warm-text enabled:hover:border-accent enabled:dark:hover:text-dark-text disabled:opacity-40"
        aria-label={`Previous match (${previousShortcutLabel})`}
        title={`Previous match (${previousShortcutLabel})`}
      >
        Prev
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={!hasQuery || !hasMatches}
        className="rounded-full border border-warm-border dark:border-dark-border px-2 py-1 text-xs text-warm-muted dark:text-dark-muted transition-colors enabled:hover:text-warm-text enabled:hover:border-accent enabled:dark:hover:text-dark-text disabled:opacity-40"
        aria-label={`Next match (${nextShortcutLabel})`}
        title={`Next match (${nextShortcutLabel})`}
      >
        Next
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded-full border border-warm-border dark:border-dark-border px-2 py-1 text-xs text-warm-muted dark:text-dark-muted transition-colors hover:text-warm-text hover:border-accent dark:hover:text-dark-text"
        aria-label="Close find in session"
      >
        Close
      </button>
    </div>
  )
}
