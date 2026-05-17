import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Loader2 } from 'lucide-react'

export type ExportFormat = 'png' | 'pdf' | 'md' | 'spool'

type FormatDef = {
  k: ExportFormat
  /** Translation key for the dropdown menu label. */
  labelKey: string
  /** Translation key for the dropdown sub-copy (mono). */
  subKey: string
}

const FORMATS: FormatDef[] = [
  { k: 'png', labelKey: 'shareEditorPanel.download_png_label', subKey: 'shareEditorPanel.download_png_sub' },
  { k: 'pdf', labelKey: 'shareEditorPanel.download_pdf_label', subKey: 'shareEditorPanel.download_pdf_sub' },
  { k: 'md', labelKey: 'shareEditorPanel.download_md_label', subKey: 'shareEditorPanel.download_md_sub' },
  { k: 'spool', labelKey: 'shareEditorPanel.download_spool_label', subKey: 'shareEditorPanel.download_spool_sub' },
]

type Props = {
  saving: boolean
  onExport: (fmt: ExportFormat) => void
}

export function DownloadButton({ saving, onExport }: Props) {
  const { t } = useTranslation()
  const tx = t as unknown as (k: string, o?: Record<string, unknown>) => string
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

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

  const pick = (k: ExportFormat) => {
    setOpen(false)
    if (saving) return
    onExport(k)
  }

  return (
    <div
      ref={rootRef}
      className="relative flex flex-none"
      data-testid="share-editor-download"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        type="button"
        data-testid="share-editor-download-trigger"
        onClick={() => setOpen(o => !o)}
        disabled={saving}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('shareEditorPanel.download_button')}
        className="inline-flex items-center gap-1.5 h-6 px-2 rounded text-[13px] font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {saving
          ? <Loader2 size={13} strokeWidth={1.75} className="animate-spin" aria-hidden />
          : <Download size={13} strokeWidth={1.75} aria-hidden />}
        <span>{t('shareEditorPanel.download_button')}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-[260px] rounded-md bg-warm-bg dark:bg-dark-bg border border-warm-border dark:border-dark-border shadow-lg p-1 z-20"
        >
          {FORMATS.map(f => (
            <button
              key={f.k}
              type="button"
              data-testid={`share-editor-download-option-${f.k}`}
              role="menuitem"
              onClick={() => pick(f.k)}
              className="w-full flex items-start gap-2 text-left px-2.5 py-2 rounded-[5px] transition-colors hover:bg-warm-surface dark:hover:bg-dark-surface"
            >
              <span className="min-w-0 flex flex-col gap-0.5">
                <span className="text-xs font-medium leading-none whitespace-nowrap text-warm-text dark:text-dark-text">
                  {tx(f.labelKey)}
                </span>
                <span className="font-mono text-[11px] text-warm-muted dark:text-dark-muted leading-snug">
                  {tx(f.subKey)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export { FORMATS as DOWNLOAD_FORMATS }
