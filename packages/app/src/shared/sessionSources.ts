const SESSION_SOURCE_META = {
  claude: {
    label: 'Claude Code',
    shortLabel: 'claude',
    color: '#6B5B8A',
  },
  codex: {
    label: 'Codex CLI',
    shortLabel: 'codex',
    color: '#1A6B3C',
  },
  gemini: {
    label: 'Gemini CLI',
    shortLabel: 'gemini',
    color: '#4285F4',
  },
} as const

export function getSessionSourceColor(source: string): string {
  return SESSION_SOURCE_META[source as keyof typeof SESSION_SOURCE_META]?.color ?? '#888888'
}

export function getSessionSourceLabel(source: string): string {
  return SESSION_SOURCE_META[source as keyof typeof SESSION_SOURCE_META]?.label ?? source
}

export function getSessionSourceShortLabel(source: string): string {
  return SESSION_SOURCE_META[source as keyof typeof SESSION_SOURCE_META]?.shortLabel ?? source
}
