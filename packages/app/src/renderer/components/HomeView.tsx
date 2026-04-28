import type { FragmentResult, SearchResult } from '@spool-lab/core'
import SearchBar, { type SearchMode } from './SearchBar.js'
import { getSessionSourceColor } from '../../shared/sessionSources.js'

type FragmentSuggestion = FragmentResult & { kind: 'fragment' }

interface Props {
  query: string
  onChange: (q: string) => void
  onSubmit: () => void
  onSelectSuggestion: (uuid: string, messageId?: number) => void
  suggestions: SearchResult[]
  isSearching: boolean
  hasSettledQuery: boolean
  isDev: boolean
  claudeCount: number | null
  codexCount: number | null
  geminiCount: number | null
  mode: SearchMode
  onModeChange?: ((mode: SearchMode) => void) | undefined
}

export default function HomeView({ query, onChange, onSubmit, onSelectSuggestion, suggestions, isSearching, hasSettledQuery, isDev, claudeCount, codexCount, geminiCount, mode, onModeChange }: Props) {
  const fragmentSuggestions = suggestions.filter((s): s is FragmentSuggestion => s.kind === 'fragment')
  const showPreview = query.trim().length > 0
  const previewState = fragmentSuggestions.length > 0
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
              {previewState === 'results' && fragmentSuggestions.slice(0, 3).map(s => (
                <FragmentSuggestionRow key={`frag-${s.sessionUuid}`} result={s} onSelect={onSelectSuggestion} />
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
      <SourceChips claudeCount={claudeCount} codexCount={codexCount} geminiCount={geminiCount} />
    </div>
  )
}

function SuggestionDot({ color }: { color: string }) {
  // h-5 matches text-sm line-height (20px) so the dot aligns to the
  // first line's vertical center instead of the 2-line block center.
  return (
    <span className="flex items-center h-5 flex-none">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
    </span>
  )
}

function FragmentSuggestionRow({ result, onSelect }: {
  result: FragmentSuggestion
  onSelect: (uuid: string, messageId?: number) => void
}) {
  const snippet = result.snippet.replace(/<mark>/g, '<strong>').replace(/<\/mark>/g, '</strong>')
  return (
    <button
      data-testid="home-suggestion"
      data-kind="fragment"
      onClick={() => onSelect(result.sessionUuid, result.messageId)}
      className="w-full text-left px-4 py-2.5 flex items-start gap-3
                 hover:bg-warm-surface dark:hover:bg-dark-surface
                 transition-[background-color,color] duration-150"
    >
      <SuggestionDot color={getSessionSourceColor(result.source)} />
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-warm-text dark:text-dark-text truncate">
          {result.sessionTitle ?? '(no title)'}
        </span>
        <span
          className="block text-xs text-warm-faint dark:text-dark-muted truncate
                     [&>strong]:font-semibold [&>strong]:text-accent dark:[&>strong]:text-accent-dark"
          dangerouslySetInnerHTML={{ __html: snippet }}
        />
      </span>
    </button>
  )
}

interface SourceChipsProps {
  claudeCount: number | null
  codexCount: number | null
  geminiCount: number | null
}

function SourceChips({ claudeCount, codexCount, geminiCount }: SourceChipsProps) {
  const sources = [
    { id: 'claude', label: 'Claude Chats', color: '#6B5B8A', count: claudeCount },
    { id: 'codex',  label: 'Codex Chats',  color: '#1A6B3C', count: codexCount },
    { id: 'gemini', label: 'Gemini Chats', color: '#4285F4', count: geminiCount },
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
    </div>
  )
}
