import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpToLine, Loader2 } from 'lucide-react'

export type ExportFormat = 'png' | 'pdf' | 'md' | 'spool'

type FormatDef = {
  k: ExportFormat
  /** Translation key for the dropdown menu label. */
  labelKey: string
  /** Translation key for the screen-reader / aria label. */
  btnKey: string
  /** Translation key for the dropdown sub-copy (mono). */
  subKey: string
}

const FORMATS: FormatDef[] = [
  { k: 'png', labelKey: 'shareEditorPanel.download_png_label', btnKey: 'shareEditorPanel.download_png_btn', subKey: 'shareEditorPanel.download_png_sub' },
  { k: 'pdf', labelKey: 'shareEditorPanel.download_pdf_label', btnKey: 'shareEditorPanel.download_pdf_btn', subKey: 'shareEditorPanel.download_pdf_sub' },
  { k: 'md', labelKey: 'shareEditorPanel.download_md_label', btnKey: 'shareEditorPanel.download_md_btn', subKey: 'shareEditorPanel.download_md_sub' },
  { k: 'spool', labelKey: 'shareEditorPanel.download_spool_label', btnKey: 'shareEditorPanel.download_spool_btn', subKey: 'shareEditorPanel.download_spool_sub' },
]

const STORAGE_KEY = 'spool:share:lastFormat'

function loadInitial(): ExportFormat {
  if (typeof window === 'undefined') return 'pdf'
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (FORMATS.some(f => f.k === raw)) return raw as ExportFormat
  return 'pdf'
}

type Props = {
  saving: boolean
  onExport: (fmt: ExportFormat) => void
}

export function DownloadButton({ saving, onExport }: Props) {
  const { t } = useTranslation()
  const tx = t as unknown as (k: string, o?: Record<string, unknown>) => string
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
    onExport(format)
  }

  return (
    <div
      ref={rootRef}
      className="relative flex flex-none"
      data-testid="share-editor-download"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Primary action: always "Download". The button width never
       *  reflows on format switch or while saving — only the icon
       *  swaps (Download → spinner) and the OS tooltip carries the
       *  format detail for users who hover. The current format is
       *  visible in the dropdown (rendered with a checkmark on the
       *  active row) rather than on the trigger itself. */}
      <button
        type="button"
        data-testid="share-editor-download-trigger"
        data-format={format}
        onClick={trigger}
        disabled={saving}
        aria-label={t('shareEditorPanel.download_ariaPrimary', { label: tx(current.labelKey) })}
        className="inline-flex items-center gap-1.5 h-6 px-2 rounded-l text-[13px] font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {saving
          ? <Loader2 size={13} strokeWidth={1.75} className="animate-spin" aria-hidden />
          : <ArrowUpToLine size={13} strokeWidth={1.75} aria-hidden />}
        <span>{t('shareEditorPanel.download_button')}</span>
      </button>
      {/* Format chooser — caret-only opener. Keeps "action" (Download)
       *  and "selection" (format) as distinct, narrow click targets;
       *  the trigger never widens because the secondary button is
       *  fixed-content. */}
      <button
        type="button"
        data-testid="share-editor-download-caret"
        onClick={() => setOpen(o => !o)}
        aria-label={t('shareEditorPanel.download_ariaCaret', { label: tx(current.labelKey) })}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={saving}
        className="inline-flex items-center justify-center h-6 w-5 rounded-r text-white bg-accent dark:bg-accent-dark border-l border-white/10 hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
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
                data-testid={`share-editor-download-option-${f.k}`}
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
                    {tx(f.labelKey)}
                  </span>
                  <span className="font-mono text-[11px] text-warm-muted dark:text-dark-muted leading-snug">
                    {tx(f.subKey)}
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
