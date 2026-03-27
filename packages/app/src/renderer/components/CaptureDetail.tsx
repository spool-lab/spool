import type { CaptureResult } from '@spool/core'

interface Props {
  capture: CaptureResult
  onBack: () => void
}

export default function CaptureDetail({ capture, onBack }: Props) {
  const handleOpenOriginal = () => {
    window.open(capture.url, '_blank')
  }

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={onBack}
          className="text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.04em]">
          via OpenCLI
        </span>
      </div>

      {/* Title */}
      <h2 className="text-lg font-semibold text-warm-text dark:text-dark-text mb-2">
        {capture.title}
      </h2>

      {/* Metadata */}
      <div className="flex items-center gap-3 mb-4 text-xs text-warm-muted dark:text-dark-muted">
        {capture.author && (
          <span>by {capture.author}</span>
        )}
        <span className="px-1.5 py-0.5 bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border rounded-[4px] font-mono text-[10px]">
          {capture.platform}
        </span>
        <span className="font-mono tabular-nums">
          {new Date(capture.capturedAt).toLocaleDateString()}
        </span>
      </div>

      {/* URL */}
      <a
        href={capture.url}
        onClick={(e) => { e.preventDefault(); handleOpenOriginal() }}
        className="block text-xs font-mono text-accent dark:text-accent-dark hover:underline mb-5 truncate"
      >
        {capture.url}
      </a>

      {/* Content */}
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <div
          className="text-sm font-mono text-warm-text dark:text-dark-text leading-relaxed whitespace-pre-wrap"
          dangerouslySetInnerHTML={{ __html: capture.snippet }}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 mt-6 pt-4 border-t border-warm-border dark:border-dark-border">
        <button
          onClick={handleOpenOriginal}
          className="px-3 py-1.5 text-xs font-medium text-accent dark:text-accent-dark border border-accent/30 dark:border-accent-dark/30 rounded-[6px] hover:bg-accent-bg dark:hover:bg-[#2A1800] transition-colors"
        >
          Open Original
        </button>
      </div>
    </div>
  )
}
