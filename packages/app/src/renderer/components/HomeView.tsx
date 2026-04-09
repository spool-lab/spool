import type { FragmentResult } from '@spool/core'
import SearchBar, { type SearchMode } from './SearchBar.js'
import { getSessionSourceColor } from '../../shared/sessionSources.js'

interface Props {
  query: string
  onChange: (q: string) => void
  onSubmit: () => void
  onSelectSuggestion: (uuid: string) => void
  suggestions: FragmentResult[]
  isSearching: boolean
  hasSettledQuery: boolean
  isDev: boolean
  claudeCount: number | null
  codexCount: number | null
  geminiCount: number | null
  captureSources: Array<{ label: string; count: number }>
  mode: SearchMode
  onModeChange?: ((mode: SearchMode) => void) | undefined
  onConnectClick: () => void
}

export default function HomeView({ query, onChange, onSubmit, onSelectSuggestion, suggestions, isSearching, hasSettledQuery, isDev, claudeCount, codexCount, geminiCount, captureSources, mode, onModeChange, onConnectClick }: Props) {
  const showPreview = query.trim().length > 0
  const previewState = suggestions.length > 0
    ? 'results'
    : ((isSearching || !hasSettledQuery) ? 'loading' : 'empty')

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 pb-10 gap-0">
      <h1 className="text-[48px] font-bold tracking-[-0.04em] leading-none mb-2 select-none">
        Spool<span className="text-accent">.</span>
      </h1>
      <p className="text-sm text-warm-muted dark:text-dark-muted mb-8 select-none">
        A local search engine for your thinking.
      </p>
      {isDev && (
        <div className="mb-4 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-accent dark:text-accent-dark">
          dev build
        </div>
      )}
      <div className="w-full max-w-[520px] mb-5 relative">
        <SearchBar
          query={query}
          onChange={onChange}
          onSubmit={onSubmit}
          isSearching={isSearching}
          variant="home"
          mode={mode}
          {...(onModeChange ? { onModeChange } : {})}
        />
        {mode === 'fast' && (
          <p className="mt-2 px-3 text-[11px] text-warm-faint dark:text-dark-muted select-none">
            Space = all terms. Quotes = exact phrase.
          </p>
        )}
        {showPreview && (
          <div
            className={[
              'absolute top-full left-0 right-0 mt-1.5 rounded-2xl border border-warm-border dark:border-dark-border',
              'bg-warm-bg/95 dark:bg-dark-bg/95 backdrop-blur-sm shadow-lg overflow-hidden z-10',
              'transition-[opacity,transform,box-shadow] duration-180 opacity-100 translate-y-0',
            ].join(' ')}
          >
            <div className={`transition-opacity duration-180 ${isSearching ? 'opacity-95' : 'opacity-100'}`}>
              {previewState === 'results' && suggestions.slice(0, 3).map(s => (
                <button
                  key={s.sessionUuid}
                  onClick={() => onSelectSuggestion(s.sessionUuid)}
                  className="w-full text-left px-4 py-2.5 flex items-center gap-3
                             hover:bg-warm-surface dark:hover:bg-dark-surface
                             transition-[background-color,color] duration-150"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-none"
                    style={{ background: getSessionSourceColor(s.source) }}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-warm-text dark:text-dark-text truncate">
                      {s.sessionTitle ?? '(no title)'}
                    </span>
                    <span className="block text-xs text-warm-faint dark:text-dark-muted truncate">
                      {s.project}
                      {s.matchCount > 1 && ` · ${s.matchCount} matches`}
                    </span>
                  </span>
                </button>
              ))}
              {previewState === 'loading' && (
                <div className="px-4 py-3 flex items-center gap-3 text-sm text-warm-muted dark:text-dark-muted">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent dark:bg-accent-dark animate-pulse" />
                  <span>Searching sessions…</span>
                </div>
              )}
              {previewState === 'empty' && (
                <div className="px-4 py-3 text-sm text-warm-muted dark:text-dark-muted">
                  No quick matches yet.
                </div>
              )}
            </div>
            <button
              onClick={onSubmit}
              className="w-full text-left px-4 py-2.5 border-t border-warm-border dark:border-dark-border
                         text-xs text-accent dark:text-accent-dark font-medium
                         hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors"
            >
              {isSearching ? 'Updating results…' : `See all results for “${query}”`}
            </button>
          </div>
        )}
      </div>
      <SourceChips claudeCount={claudeCount} codexCount={codexCount} geminiCount={geminiCount} captureSources={captureSources} onConnectClick={onConnectClick} />
    </div>
  )
}

interface SourceChipsProps {
  claudeCount: number | null
  codexCount: number | null
  geminiCount: number | null
  captureSources: Array<{ label: string; count: number }>
  onConnectClick: () => void
}

function SourceChips({ claudeCount, codexCount, geminiCount, captureSources, onConnectClick }: SourceChipsProps) {
  const sources = [
    { id: 'claude', label: 'Claude Chats', color: '#6B5B8A', count: claudeCount },
    { id: 'codex',  label: 'Codex Chats',  color: '#1A6B3C', count: codexCount },
    { id: 'gemini', label: 'Gemini Chats', color: '#4285F4', count: geminiCount },
    ...captureSources.map((s, i) => ({
      id: `capture-${i}`,
      label: s.label,
      color: '#C85A00',
      count: s.count as number | null,
    })),
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
      <button
        onClick={onConnectClick}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full
                   border border-dashed border-warm-border2 dark:border-dark-border
                   text-xs text-warm-faint dark:text-dark-muted select-none
                   hover:text-accent dark:hover:text-accent-dark hover:border-accent/40 dark:hover:border-accent-dark/40 transition-colors cursor-pointer"
      >
        <span>+ Connect</span>
      </button>
    </div>
  )
}
