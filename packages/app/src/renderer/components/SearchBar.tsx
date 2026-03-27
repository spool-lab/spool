import { useEffect, useRef } from 'react'

interface Props {
  query: string
  onChange: (q: string) => void
  onBack?: () => void
  isSearching: boolean
}

export default function SearchBar({ query, onChange, onBack, isSearching }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className="flex items-center gap-2">
      {onBack && (
        <button
          onClick={onBack}
          className="flex-none text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
          aria-label="Back to search"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}
      <div className="relative flex-1">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
          {isSearching ? (
            <svg className="animate-spin" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="30" strokeDashoffset="10"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M11 11L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search my thinking…"
          className="w-full bg-neutral-100 dark:bg-neutral-800 rounded-full pl-9 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#C85A00]/30 dark:focus:ring-[#F07020]/30 placeholder:text-neutral-400"
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button
            onClick={() => onChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
