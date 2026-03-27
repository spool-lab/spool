import type { FragmentResult } from '@spool/core'
import SearchBar, { type SearchMode } from './SearchBar.js'

interface Props {
  query: string
  onChange: (q: string) => void
  onSubmit: () => void
  onSelectSuggestion: (uuid: string) => void
  suggestions: FragmentResult[]
  isSearching: boolean
  claudeCount: number | null
  codexCount: number | null
  mode: SearchMode
  onModeChange: (mode: SearchMode) => void
}

export default function HomeView({ query, onChange, onSubmit, onSelectSuggestion, suggestions, isSearching, claudeCount, codexCount, mode, onModeChange }: Props) {
  const showSuggestions = query.trim().length > 0 && suggestions.length > 0

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 pb-10 gap-0">
      <h1 className="text-[48px] font-bold tracking-[-0.04em] leading-none mb-2 select-none">
        Spool<span className="text-accent">.</span>
      </h1>
      <p className="text-sm text-warm-muted dark:text-dark-muted mb-8 select-none">
        A local search engine for your thinking.
      </p>
      <div className="w-full max-w-[520px] mb-5 relative">
        <SearchBar
          query={query}
          onChange={onChange}
          onSubmit={onSubmit}
          isSearching={isSearching}
          variant="home"
          mode={mode}
          onModeChange={onModeChange}
        />
        {showSuggestions && (
          <div className="absolute top-full left-0 right-0 mt-1.5 rounded-2xl border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg shadow-lg overflow-hidden z-10">
            {suggestions.slice(0, 3).map(s => (
              <button
                key={s.sessionUuid}
                onClick={() => onSelectSuggestion(s.sessionUuid)}
                className="w-full text-left px-4 py-2.5 flex items-center gap-3
                           hover:bg-warm-surface dark:hover:bg-dark-surface
                           transition-colors"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-none"
                  style={{ background: s.source === 'claude' ? '#6B5B8A' : '#1A6B3C' }}
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-warm-text dark:text-dark-text truncate">
                    {s.sessionTitle ?? '(no title)'}
                  </span>
                  <span className="block text-xs text-warm-faint dark:text-dark-muted truncate">
                    {s.project}
                  </span>
                </span>
              </button>
            ))}
            <button
              onClick={onSubmit}
              className="w-full text-left px-4 py-2.5 border-t border-warm-border dark:border-dark-border
                         text-xs text-accent dark:text-accent-dark font-medium
                         hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors"
            >
              See all results for &ldquo;{query}&rdquo;
            </button>
          </div>
        )}
      </div>
      <SourceChips claudeCount={claudeCount} codexCount={codexCount} />
    </div>
  )
}

interface SourceChipsProps {
  claudeCount: number | null
  codexCount: number | null
}

function SourceChips({ claudeCount, codexCount }: SourceChipsProps) {
  const sources = [
    { id: 'claude', label: 'Claude Chats', color: '#6B5B8A', count: claudeCount },
    { id: 'codex',  label: 'Codex Chats',  color: '#1A6B3C', count: codexCount },
  ]

  return (
    <div className="flex items-center gap-2 flex-wrap justify-center">
      {sources.map(src => (
        <div
          key={src.id}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full
                     bg-warm-surface dark:bg-dark-surface
                     border border-warm-border dark:border-dark-border
                     text-xs text-warm-muted dark:text-dark-muted select-none"
        >
          <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: src.color }} />
          <span className="font-medium">{src.label}</span>
          <span className="text-warm-faint dark:text-dark-muted tabular-nums">
            {src.count === null ? '…' : src.count}
          </span>
        </div>
      ))}
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full
                   border border-dashed border-warm-border2 dark:border-dark-border
                   text-xs text-warm-faint dark:text-dark-muted select-none"
      >
        <span>+ Connect</span>
      </div>
    </div>
  )
}
