import { useEffect, useState } from 'react'
import type { ManualInstall } from '@spool-lab/core'

interface Props {
  open: boolean
  onClose: () => void
  manual: ManualInstall
  prereqName: string
  onCheck?: () => Promise<void> | void
}

export function ManualInstallModal({ open, onClose, manual, prereqName, onCheck }: Props) {
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const openDownload = () => window.spool?.connectors?.openExternal(manual.downloadUrl)

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-warm-bg dark:bg-dark-bg rounded-lg border border-warm-border dark:border-dark-border p-5 w-[480px] max-w-[92vw]"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-sm font-medium text-warm-text dark:text-dark-text mb-1">Install {prereqName}</h2>
        <p className="text-xs text-warm-muted dark:text-dark-muted mb-3">
          This extension isn&apos;t on the Chrome Web Store yet. Manual install takes about two minutes.
        </p>
        <div className="mb-3 flex gap-2">
          <button onClick={openDownload} className="text-[11px] text-accent dark:text-accent-dark hover:underline">
            Download extension
          </button>
          <button
            onClick={() => navigator.clipboard.writeText('chrome://extensions')}
            className="text-[11px] text-accent dark:text-accent-dark hover:underline"
          >
            Copy chrome://extensions URL
          </button>
        </div>
        <ol className="text-xs text-warm-text dark:text-dark-text space-y-2 mb-3 list-decimal pl-5">
          {manual.steps.map((stepText: string, i: number) => (
            <li key={i}>{stepText}</li>
          ))}
        </ol>
        <p className="text-[10px] text-warm-faint dark:text-dark-faint mb-3">
          Keep the folder in place — moving or deleting it will break the extension.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-xs text-warm-muted dark:text-dark-muted px-3 py-1.5 rounded">
            Close
          </button>
          {onCheck && (
            <button
              onClick={async () => {
                setChecking(true)
                try { await onCheck() } finally { setChecking(false) }
              }}
              disabled={checking}
              className="text-xs text-white px-3 py-1.5 rounded bg-accent disabled:opacity-50"
            >
              {checking ? 'Checking…' : 'Check now'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
