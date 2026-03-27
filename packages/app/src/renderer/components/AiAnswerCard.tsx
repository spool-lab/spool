import type { FragmentResult } from '@spool/core'

interface Props {
  answer: string
  streaming: boolean
  agentName: string
  sources: FragmentResult[]
  error?: string | null
  onResume?: () => void
}

export default function AiAnswerCard({ answer, streaming, agentName, sources, error, onResume }: Props) {
  if (!answer && !streaming && !error) return null

  return (
    <div className="mx-4 mt-3 mb-1 bg-accent-bg dark:bg-[#2A1800] border border-warm-border2 dark:border-dark-border rounded-[10px] border-l-[3px] border-l-accent dark:border-l-accent-dark px-4 py-3.5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-accent dark:text-accent-dark tracking-[0.05em] uppercase">
          <SparklesIcon />
          {agentName} says
        </span>
        <span className="ml-auto text-[10px] font-mono bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border px-2 py-0.5 rounded text-warm-muted dark:text-dark-muted">
          via ACP · local · {agentName}
        </span>
      </div>

      {/* Body */}
      {error ? (
        <p className="text-[13px] text-red-600 dark:text-red-400 leading-relaxed">{error}</p>
      ) : (
        <p className="text-[13px] text-warm-text dark:text-dark-text leading-[1.65] mb-2.5 whitespace-pre-wrap">
          {answer}
          {streaming && <span className="inline-block w-1.5 h-4 bg-accent dark:bg-accent-dark ml-0.5 animate-pulse align-text-bottom" />}
        </p>
      )}

      {/* Source chips */}
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {sources.slice(0, 6).map((s, i) => (
            <span
              key={`${s.sessionUuid}-${i}`}
              className="text-[11px] font-mono px-2 py-0.5 rounded bg-warm-bg dark:bg-dark-bg border border-warm-border dark:border-dark-border text-warm-muted dark:text-dark-muted"
            >
              → {s.source} · {s.startedAt.slice(5, 10)}
            </span>
          ))}
        </div>
      )}

      {/* CTA */}
      {!streaming && answer && (
        <button
          onClick={onResume}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-accent dark:text-accent-dark bg-transparent border border-accent dark:border-accent-dark rounded-md px-3 py-1.5 cursor-pointer hover:bg-accent-bg dark:hover:bg-[#2A1800] transition-colors"
        >
          Continue in {agentName} →
        </button>
      )}
    </div>
  )
}

function SparklesIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/>
    </svg>
  )
}
