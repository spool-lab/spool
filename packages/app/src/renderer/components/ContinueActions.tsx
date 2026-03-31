import { useState } from 'react'
import type { FragmentResult } from '@spool/core'

type Props = {
  result: FragmentResult
  onOpenSession: (uuid: string) => void
  onCopySessionId: (source: FragmentResult['source']) => void
}

export default function ContinueActions({ result, onOpenSession, onCopySessionId }: Props) {
  const [copied, setCopied] = useState(false)
  const [resuming, setResuming] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(result.sessionUuid)
    onCopySessionId(result.source)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function handleResume() {
    setResuming(true)
    await window.spool.resumeCLI(result.sessionUuid, result.source, result.cwd)
    setTimeout(() => setResuming(false), 1000)
  }

  return (
    <div className="flex items-center gap-1 mt-2">
      <ActionButton onClick={handleCopy} title="Copy session ID for CLI resume">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          {copied ? (
            <path d="M2 7L5 10L11 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          ) : (
            <>
              <rect x="4.5" y="4.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M8.5 4.5V3C8.5 2.17 7.83 1.5 7 1.5H3C2.17 1.5 1.5 2.17 1.5 3V7C1.5 7.83 2.17 8.5 3 8.5H4.5" stroke="currentColor" strokeWidth="1.2"/>
            </>
          )}
        </svg>
        Copy Session ID
      </ActionButton>

      {result.source === 'claude' && (
        <ActionButton onClick={handleResume} title="Resume this session in Terminal">
          {resuming ? (
            <>
              <svg className="animate-spin" width="13" height="13" viewBox="0 0 13 13" fill="none">
                <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20" strokeDashoffset="7"/>
              </svg>
              Opening...
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M2.5 2.5L6.5 6.5L2.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M7.5 10.5H10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Resume in CLI
            </>
          )}
        </ActionButton>
      )}

      <ActionButton onClick={() => onOpenSession(result.sessionUuid)} title="View full session">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M1.5 6.5C1.5 6.5 3.5 2.5 6.5 2.5C9.5 2.5 11.5 6.5 11.5 6.5C11.5 6.5 9.5 10.5 6.5 10.5C3.5 10.5 1.5 6.5 1.5 6.5Z" stroke="currentColor" strokeWidth="1.2"/>
          <circle cx="6.5" cy="6.5" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
        View session
      </ActionButton>
    </div>
  )
}

function ActionButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded px-2 py-1 transition-colors"
    >
      {children}
    </button>
  )
}
