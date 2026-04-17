import type { Session } from '@spool-lab/core'
import { getSessionSourceColor } from '../../shared/sessionSources.js'

interface Props {
  sessions: Session[]
  onOpenSession: (uuid: string) => void
}

export default function RecentSessions({ sessions, onOpenSession }: Props) {
  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-400 gap-2 pb-12">
        <p className="text-sm">No sessions indexed yet.</p>
        <p className="text-xs opacity-60">Run <code className="font-mono bg-neutral-100 dark:bg-neutral-800 px-1 rounded">spool sync</code> to index your sessions.</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-2">
        <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-2">Recent</p>
      </div>
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {sessions.map((session) => (
          <SessionRow key={session.sessionUuid} session={session} onOpen={onOpenSession} />
        ))}
      </div>
    </div>
  )
}

function SessionRow({ session, onOpen }: { session: Session; onOpen: (uuid: string) => void }) {
  const date = formatDate(session.startedAt)
  const project = session.projectDisplayName

  return (
    <button
      onClick={() => onOpen(session.sessionUuid)}
      className="w-full text-left px-4 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors flex items-start gap-3"
    >
      <div className="flex-none mt-0.5">
        <SourceDot source={session.source} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-neutral-800 dark:text-neutral-200 truncate">
          {session.title ?? '(no title)'}
        </p>
        <p className="text-xs text-neutral-400 mt-0.5">
          {project} · {date} · {session.messageCount} msgs
        </p>
      </div>
    </button>
  )
}

function SourceDot({ source }: { source: string }) {
  return (
    <div
      className="w-2 h-2 rounded-full mt-1"
      style={{ background: getSessionSourceColor(source) }}
    />
  )
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
    if (diffDays === 0) return 'today'
    if (diffDays === 1) return 'yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString()
  } catch {
    return iso.slice(0, 10)
  }
}
