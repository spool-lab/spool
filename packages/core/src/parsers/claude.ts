import { readFileSync } from 'node:fs'
import type { ParseSessionResult, ParsedSession, ParsedMessage } from '../types.js'

interface ContentItem {
  type: string
  text?: string
  name?: string
  input?: unknown
}

export function loadClaudeSession(filePath: string): ParseSessionResult {
  const raw = readFileSync(filePath, 'utf8')
  const lines = raw.split('\n').filter(l => l.trim().length > 0)
  const messages: ParsedMessage[] = []
  let sessionUuid = ''
  let cwd = ''
  let model = ''
  let customTitle = ''

  const SKIP_TYPES = new Set([
    'file-history-snapshot',
    'progress',
    'queue-operation',
    'last-prompt',
  ])

  for (const line of lines) {
    let record: Record<string, unknown>
    try {
      record = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    const type = record['type'] as string | undefined
    if (!type || SKIP_TYPES.has(type)) continue

    if (!sessionUuid && record['sessionId']) sessionUuid = record['sessionId'] as string
    if (!cwd && record['cwd']) cwd = record['cwd'] as string

    if (type === 'custom-title') {
      const ct = record['customTitle'] as string | undefined
      if (ct) customTitle = ct
      continue
    }

    if (type === 'assistant') {
      const msg = record['message'] as Record<string, unknown> | undefined
      if (msg?.['model']) model = msg['model'] as string
    }

    if (type === 'summary') {
      const summaryText = record['summary'] as string | undefined
      if (summaryText) {
        messages.push({
          uuid: (record['uuid'] as string | undefined) ?? `summary-${messages.length}`,
          parentUuid: (record['parentUuid'] as string | null | undefined) ?? null,
          role: 'system',
          contentText: summaryText.trim(),
          timestamp: record['timestamp'] as string,
          isSidechain: Boolean(record['isSidechain']),
          toolNames: [],
          seq: messages.length,
        })
      }
      continue
    }

    const msgObj = record['message'] as Record<string, unknown> | undefined
    if (!msgObj) continue

    const role = msgObj['role'] as string | undefined
    if (role !== 'user' && role !== 'assistant') continue

    const contentRaw = msgObj['content']
    const contentText = extractText(contentRaw)
    const toolNames = extractToolNames(contentRaw)

    // Skip empty messages (e.g. tool result placeholders with no text)
    if (!contentText && toolNames.length === 0) continue

    messages.push({
      uuid: (record['uuid'] as string | undefined) ?? `msg-${messages.length}`,
      parentUuid: (record['parentUuid'] as string | null | undefined) ?? null,
      role: role as 'user' | 'assistant',
      contentText,
      timestamp: record['timestamp'] as string,
      isSidechain: Boolean(record['isSidechain']),
      toolNames,
      seq: messages.length,
    })
  }

  if (messages.length === 0) return { kind: 'skipped' }

  // Use cwd from messages if not in top-level fields
  if (!cwd) {
    for (const m of messages) {
      // cwd is on the record level, not message level — already captured above
    }
  }

  const firstUserMsg = messages.find(m => m.role === 'user' && m.contentText.length > 0 && !m.isSidechain)
  const title = customTitle
    || (firstUserMsg
      ? firstUserMsg.contentText.replace(/<[^>]+>/g, '').trim().slice(0, 120)
      : '(no title)')

  const timestamps = messages.map(m => m.timestamp).filter(Boolean).sort()

  return {
    kind: 'parsed',
    session: {
      source: 'claude',
      sessionUuid: sessionUuid || filePath,
      filePath,
      title,
      cwd,
      model,
      startedAt: timestamps[0] ?? new Date().toISOString(),
      endedAt: timestamps[timestamps.length - 1] ?? new Date().toISOString(),
      messages,
    },
  }
}

export function parseClaudeSession(filePath: string): ParsedSession | null {
  try {
    const result = loadClaudeSession(filePath)
    return result.kind === 'parsed' ? result.session : null
  } catch {
    return null
  }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') {
    return content
      .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
      .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
      .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .replace(/<[^>]+>/g, '')
      .trim()
  }
  if (!Array.isArray(content)) return ''
  return (content as ContentItem[])
    .filter(item => item.type === 'text')
    .map(item => item.text ?? '')
    .join('\n')
    .trim()
}

function extractToolNames(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  return (content as ContentItem[])
    .filter(item => item.type === 'tool_use' && item.name)
    .map(item => item.name!)
}

/** Decode a Claude project slug to a display path.
 *  e.g. '-Users-claw-code-spool' → '/Users/claw/code/spool'
 *  Note: lossy for paths containing hyphens — prefer cwd from session records.
 */
export function decodeProjectSlug(slug: string): string {
  if (!slug.startsWith('-')) return slug
  return '/' + slug.slice(1).replace(/-/g, '/')
}
