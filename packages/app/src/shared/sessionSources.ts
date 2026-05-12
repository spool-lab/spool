const SESSION_SOURCE_META = {
  claude: {
    label: 'Claude Code',
    shortLabel: 'claude',
    color: '#6B5B8A',
    colorDark: '#9B8BBF',
  },
  codex: {
    label: 'Codex CLI',
    shortLabel: 'codex',
    color: '#2F7A4A',
    colorDark: '#7AC78F',
  },
  gemini: {
    label: 'Gemini CLI',
    shortLabel: 'gemini',
    color: '#4285F4',
    colorDark: '#7AA8E0',
  },
} as const

export function getSessionSourceColor(source: string): string {
  return SESSION_SOURCE_META[source as keyof typeof SESSION_SOURCE_META]?.color ?? '#888888'
}

export function getSessionSourceColorDark(source: string): string {
  return SESSION_SOURCE_META[source as keyof typeof SESSION_SOURCE_META]?.colorDark ?? '#A8A8A0'
}

export function getSessionSourceLabel(source: string): string {
  return SESSION_SOURCE_META[source as keyof typeof SESSION_SOURCE_META]?.label ?? source
}

export function getSessionSourceShortLabel(source: string): string {
  return SESSION_SOURCE_META[source as keyof typeof SESSION_SOURCE_META]?.shortLabel ?? source
}
