import type { CapturedItem } from './captured-item.js'

interface ParseOptions {
  platform: string
  contentType?: string
}

function parseOneItem(raw: Record<string, unknown>, opts: ParseOptions): CapturedItem {
  // Flatten GitHub starred repos: { starred_at, repo: {...} } → flat object
  if (raw['repo'] && typeof raw['repo'] === 'object' && 'html_url' in (raw['repo'] as object)) {
    const repo = raw['repo'] as Record<string, unknown>
    const starredAt = raw['starred_at'] as string | undefined
    raw = { ...repo, starred_at: starredAt ?? repo['created_at'] }
  }

  const url = String(raw['html_url'] ?? raw['link'] ?? raw['url'] ?? '')
  const title = String(raw['title'] ?? raw['name'] ?? raw['full_name'] ?? '')
  const contentText = String(
    raw['content'] ?? raw['description'] ?? raw['text'] ?? raw['body']
    ?? raw['selftext'] ?? raw['summary'] ?? '',
  )

  const authorRaw = raw['author'] ?? raw['user'] ?? raw['owner'] ?? raw['username'] ?? raw['screen_name'] ?? null
  let author: string | null = null
  if (typeof authorRaw === 'string') {
    author = authorRaw
  } else if (authorRaw && typeof authorRaw === 'object' && 'login' in (authorRaw as any)) {
    author = String((authorRaw as any).login)
  }

  const capturedAt = String(
    raw['starred_at'] ?? raw['created_at'] ?? raw['date'] ?? raw['timestamp']
    ?? raw['pushed_at'] ?? new Date().toISOString(),
  )

  const platformId = raw['id'] ?? raw['platform_id'] ?? null
  const thumbnailUrl = raw['thumbnail'] ?? raw['thumbnail_url'] ?? raw['avatar_url'] ?? null

  return {
    url,
    title,
    contentText: contentText || title,
    author,
    platform: opts.platform,
    platformId: platformId != null ? String(platformId) : null,
    contentType: opts.contentType ?? 'page',
    thumbnailUrl: typeof thumbnailUrl === 'string' ? thumbnailUrl : null,
    metadata: {},
    capturedAt,
    rawJson: JSON.stringify(raw),
  }
}

export function parseCliJsonOutput(stdout: string, platform: string, contentType?: string): CapturedItem[] {
  const opts: ParseOptions = { platform, contentType }
  const trimmed = stdout.trim()
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed.map(item => parseOneItem(item, opts))
    }
    return [parseOneItem(parsed as Record<string, unknown>, opts)]
  } catch {}

  // Newline-delimited JSON fallback
  const items: CapturedItem[] = []
  for (const line of trimmed.split('\n')) {
    const l = line.trim()
    if (!l) continue
    try {
      items.push(parseOneItem(JSON.parse(l) as Record<string, unknown>, opts))
    } catch {}
  }
  return items
}
