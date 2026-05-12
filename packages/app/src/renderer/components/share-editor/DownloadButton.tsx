import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'

export type ExportFormat = 'png' | 'pdf' | 'spool'

type FormatDef = {
  k: ExportFormat
  /** Dropdown menu label. */
  l: string
  /** Primary button label when this format is selected. */
  b: string
  /** Dropdown sub-copy (mono). */
  s: string
}

const FORMATS: FormatDef[] = [
  { k: 'png', l: 'PNG image', b: 'Download PNG', s: '3× pixel ratio · social-feed friendly' },
  { k: 'pdf', l: 'PDF', b: 'Download PDF', s: 'A4 paginated · print-ready' },
  { k: 'spool', l: 'Spool file', b: 'Download .spool', s: 'Editable in Spool · keeps your styling' },
]

const STORAGE_KEY = 'spool:share:lastFormat'

function loadInitial(): ExportFormat {
  if (typeof window === 'undefined') return 'pdf'
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === 'png' || raw === 'pdf' || raw === 'spool') return raw
  return 'pdf'
}

type Props = {
  saving: boolean
  onPng: () => void
  onPdf: () => void
  onSpool: () => void
}

export function DownloadButton({ saving, onPng, onPdf, onSpool }: Props) {
  const [format, setFormat] = useState<ExportFormat>(loadInitial)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, format)
  }, [format])

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = FORMATS.find(f => f.k === format) ?? FORMATS[0]!

  const trigger = () => {
    if (saving) return
    if (format === 'png') onPng()
    else if (format === 'pdf') onPdf()
    else onSpool()
  }

  return (
    <div ref={rootRef} className="relative flex flex-none" data-testid="share-editor-download">
      <button
        type="button"
        onClick={trigger}
        disabled={saving}
        title={`${current.b}  ⌘S`}
        className="inline-flex items-center gap-1.5 h-6 px-2 rounded-l text-xs font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <Download size={11} strokeWidth={1.8} />
        <span>{saving ? 'Exporting…' : current.b}</span>
      </button>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="Choose format"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={saving}
        className="inline-flex items-center justify-center h-6 w-5 rounded-r text-white bg-accent dark:bg-accent-dark border-l border-white/25 hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 4l3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-[260px] rounded-md bg-warm-bg dark:bg-dark-bg border border-warm-border dark:border-dark-border shadow-lg p-1 z-20"
        >
          {FORMATS.map(f => {
            const active = f.k === format
            return (
              <button
                key={f.k}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => { setFormat(f.k); setOpen(false) }}
                className={`w-full flex items-start gap-2 text-left px-2.5 py-2 rounded-[5px] transition-colors ${
                  active
                    ? 'bg-accent-bg dark:bg-accent-bg-dark'
                    : 'hover:bg-warm-surface dark:hover:bg-dark-surface'
                }`}
              >
                <span className="w-3 h-3 inline-flex items-center justify-center flex-none mt-[3px]">
                  {active && (
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-accent dark:text-accent-dark"
                    >
                      <path d="M2 6l3 3 5-6" />
                    </svg>
                  )}
                </span>
                <span className="min-w-0 flex flex-col gap-0.5">
                  <span
                    className={`text-xs font-medium leading-none whitespace-nowrap ${
                      active ? 'text-accent dark:text-accent-dark' : 'text-warm-text dark:text-dark-text'
                    }`}
                  >
                    {f.l}
                  </span>
                  <span className="font-mono text-[11px] text-warm-muted dark:text-dark-muted leading-snug">
                    {f.s}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export { FORMATS as DOWNLOAD_FORMATS }
