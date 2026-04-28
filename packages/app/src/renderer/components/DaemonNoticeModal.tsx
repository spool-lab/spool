import { useState } from 'react'
import daemonIconUrl from '../assets/daemon-icon.png'

interface Props {
  onClose: () => void
}

export default function DaemonNoticeModal({ onClose }: Props) {
  const [busy, setBusy] = useState<'install' | 'dismiss' | null>(null)

  const handleAction = async (action: 'install' | 'dismiss') => {
    if (busy) return
    setBusy(action)
    try {
      await window.spool.daemonNoticeAction(action)
    } finally {
      onClose()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="daemon-notice-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 animate-in fade-in duration-150"
    >
      <div className="w-full max-w-[440px] rounded-[12px] border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg shadow-xl overflow-hidden">
        <div className="px-7 pt-7 pb-5">
          <div className="mb-5 flex items-center justify-center">
            <img
              src={daemonIconUrl}
              alt=""
              aria-hidden="true"
              width={72}
              height={72}
              className="w-[72px] h-[72px] rounded-[16px] select-none pointer-events-none"
              draggable={false}
            />
          </div>
          <h2
            id="daemon-notice-title"
            className="text-center text-base font-semibold text-warm-text dark:text-dark-text mb-2"
          >
            Connectors moved to Spool Daemon
          </h2>
          <p className="text-center text-[13px] leading-relaxed text-warm-muted dark:text-dark-muted">
            Spool now focuses on AI sessions. Twitter, GitHub, Reddit, Hacker News and other
            platform connectors live in{' '}
            <span className="font-medium text-warm-text dark:text-dark-text whitespace-nowrap">
              Spool Daemon
            </span>
            , a sibling app. Synced platform data has been removed from Spool — install Daemon
            to keep using connectors.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-warm-border dark:border-dark-border bg-warm-surface/40 dark:bg-dark-surface/40">
          <button
            type="button"
            onClick={() => handleAction('dismiss')}
            disabled={busy !== null}
            className="px-3.5 h-8 rounded-[6px] text-[12px] font-medium text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            Maybe later
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => handleAction('install')}
            disabled={busy !== null}
            className="px-3.5 h-8 rounded-[6px] text-[12px] font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {busy === 'install' ? 'Opening…' : 'Get Spool Daemon'}
          </button>
        </div>
      </div>
    </div>
  )
}

