import { useState } from 'react'
import { MoreHorizontal, Eye, SquareTerminal } from 'lucide-react'
import type { FragmentResult } from '@spool-lab/core'
import Menu from './Menu.js'
import { getSessionResumeCommand } from '../../shared/resumeCommand.js'

type Props = {
  result: FragmentResult
  onOpenSession: (uuid: string, messageId?: number) => void
  onCopySessionId: (source: FragmentResult['source']) => void
}

export default function ContinueActions({ result, onOpenSession, onCopySessionId }: Props) {
  const [copiedId, setCopiedId] = useState(false)
  const [copiedCommand, setCopiedCommand] = useState(false)
  const [resuming, setResuming] = useState(false)
  const resumeCommand = getSessionResumeCommand(result.source, result.sessionUuid)

  async function handleCopyId() {
    await navigator.clipboard.writeText(result.sessionUuid)
    onCopySessionId(result.source)
    setCopiedId(true)
    setTimeout(() => setCopiedId(false), 1500)
  }

  async function handleResume() {
    setResuming(true)
    await window.spool.resumeCLI(result.sessionUuid, result.source, result.cwd)
    setTimeout(() => setResuming(false), 1000)
  }

  async function handleCopyCommand() {
    if (!resumeCommand) return
    await navigator.clipboard.writeText(resumeCommand)
    setCopiedCommand(true)
    setTimeout(() => setCopiedCommand(false), 1500)
  }

  const menuItems = [
    {
      label: 'View session',
      icon: <EyeIcon />,
      onSelect: () => onOpenSession(result.sessionUuid, result.messageId),
    },
    ...(resumeCommand ? [{
      label: resuming ? 'Opening Terminal…' : 'Open in Terminal',
      icon: resuming ? <SpinnerIcon /> : <TerminalIcon />,
      onSelect: () => { void handleResume() },
      disabled: resuming,
    }] : []),
    ...(resumeCommand ? [{
      label: copiedCommand ? 'Copied resume command' : 'Copy resume command',
      icon: <CommandIcon />,
      onSelect: () => { void handleCopyCommand() },
    }] : []),
    {
      label: copiedId ? 'Copied session ID' : 'Copy session ID',
      icon: <CopyIcon />,
      onSelect: () => { void handleCopyId() },
    },
  ]

  return (
    <Menu
      align="right"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation()
            toggle()
          }}
          className="flex-none self-center inline-flex items-center justify-center w-6 h-6 rounded text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2 transition-colors"
        >
          <MoreHorizontal size={14} strokeWidth={1.8} aria-hidden />
        </button>
      )}
      items={menuItems}
    />
  )
}

function EyeIcon() {
  return <Eye size={14} strokeWidth={1.5} aria-hidden />
}

function TerminalIcon() {
  return <SquareTerminal size={14} strokeWidth={1.5} aria-hidden />
}

function CommandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.5L5 7L3 9.5" />
      <path d="M6.5 10H11.5" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="5" y="5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 5V3.5C9 2.67 8.33 2 7.5 2H3.5C2.67 2 2 2.67 2 3.5V7.5C2 8.33 2.67 9 3.5 9H5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="animate-spin">
      <circle cx="7" cy="7" r="5.25" stroke="currentColor" strokeWidth="1.5" fill="none" strokeOpacity="0.3" />
      <path d="M7 1.75A5.25 5.25 0 0112.25 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}
