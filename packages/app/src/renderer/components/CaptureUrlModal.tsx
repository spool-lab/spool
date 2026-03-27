import { useState, useEffect, useRef, useCallback } from 'react'

const SUPPORTED_PLATFORMS = [
  'twitter.com', 'github.com', 'youtube.com', 'reddit.com',
  'news.ycombinator.com', 'zhihu.com', 'substack.com',
]

interface Props {
  onClose: () => void
  onCaptured: () => void
}

function detectPlatformFromUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    for (const domain of SUPPORTED_PLATFORMS) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) return domain
    }
  } catch {}
  return null
}

export default function CaptureUrlModal({ onClose, onCaptured }: Props) {
  const [url, setUrl] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [captured, setCaptured] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const platform = url.trim() ? detectPlatformFromUrl(url.trim()) : null
  const isValidUrl = (() => {
    try { new URL(url.trim()); return true } catch { return false }
  })()

  const handleCapture = useCallback(async () => {
    if (!window.spool?.opencli || !isValidUrl) return
    setCapturing(true)
    setError(null)
    try {
      const result = await window.spool.opencli.captureUrl(url.trim())
      if (result.ok) {
        setCaptured(true)
        setTimeout(() => {
          onCaptured()
          onClose()
        }, 1200)
      } else {
        setError(result.error ?? 'Capture failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCapturing(false)
    }
  }, [url, isValidUrl, onCaptured, onClose])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && isValidUrl && !capturing) {
      handleCapture()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-[520px] bg-warm-bg dark:bg-dark-bg border border-warm-border dark:border-dark-border rounded-[10px] shadow-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-5">
          <h2 className="text-lg font-semibold text-warm-text dark:text-dark-text mb-1">
            Capture a URL
          </h2>
          <p className="text-sm text-warm-muted dark:text-dark-muted mb-5">
            Paste any link — Spool will fetch and index it via OpenCLI.
          </p>

          {/* URL Input */}
          <input
            ref={inputRef}
            type="url"
            value={url}
            onChange={e => { setUrl(e.target.value); setCaptured(false); setError(null) }}
            onKeyDown={handleKeyDown}
            placeholder="https://twitter.com/..."
            className="w-full px-4 py-3 bg-warm-surface dark:bg-dark-surface border border-warm-border2 dark:border-dark-border2 rounded-[8px] text-sm font-mono text-warm-text dark:text-dark-text placeholder:text-warm-faint dark:placeholder:text-dark-faint focus:outline-none focus:border-accent dark:focus:border-accent-dark transition-colors"
          />

          {/* Preview card */}
          {isValidUrl && url.trim() && (
            <div className="mt-3 flex items-center gap-3 px-4 py-3 bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border rounded-[8px]">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-warm-text dark:text-dark-text truncate">
                  {url.trim()}
                </p>
                <p className="text-xs text-warm-faint dark:text-dark-muted font-mono truncate">
                  {(() => { try { return new URL(url.trim()).hostname } catch { return '' } })()}
                </p>
              </div>
              {platform && (
                <span className="px-2 py-1 text-[10px] font-medium bg-warm-surface2 dark:bg-dark-surface2 border border-warm-border dark:border-dark-border rounded-[4px] text-warm-muted dark:text-dark-muted flex-none">
                  {platform.replace('.com', '').replace('news.ycombinator', 'hackernews')}
                </span>
              )}
            </div>
          )}

          {error && (
            <p className="mt-2 text-xs text-red-500">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 mt-5">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-warm-muted dark:text-dark-muted border border-warm-border dark:border-dark-border rounded-[6px] hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCapture}
              disabled={!isValidUrl || capturing || captured}
              className="px-4 py-2 text-sm font-medium text-white bg-accent dark:bg-accent-dark rounded-[6px] hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
            >
              {captured ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Captured
                </>
              ) : capturing ? (
                'Capturing...'
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                  Capture &amp; Index
                </>
              )}
            </button>
          </div>
        </div>

        {/* Supported platforms */}
        <div className="px-6 py-4 border-t border-warm-border dark:border-dark-border">
          <p className="text-[11px] text-warm-faint dark:text-dark-muted mb-2">Supported via OpenCLI</p>
          <div className="flex flex-wrap gap-1.5">
            {SUPPORTED_PLATFORMS.map(p => (
              <span
                key={p}
                className="px-2 py-1 text-[10px] font-mono text-warm-muted dark:text-dark-muted bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border rounded-[4px]"
              >
                {p}
              </span>
            ))}
            <span className="px-2 py-1 text-[10px] font-mono text-warm-faint dark:text-dark-muted bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border rounded-[4px]">
              + 40 more
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
