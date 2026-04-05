const RESUME_COMMAND_PREFIXES: Record<string, string> = {
  claude: 'claude --resume',
  codex: 'codex resume',
}

export function getSessionResumeCommandPrefix(source: string): string | null {
  return RESUME_COMMAND_PREFIXES[source] ?? null
}

export function getSessionResumeCommand(source: string, sessionUuid: string): string | null {
  const prefix = getSessionResumeCommandPrefix(source)
  if (!prefix) return null
  return `${prefix} ${shellQuote(sessionUuid)}`
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
