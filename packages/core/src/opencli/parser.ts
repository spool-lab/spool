import type { CapturedItem } from '../types.js'

/** Known platform domain mappings */
const DOMAIN_PLATFORM_MAP: Record<string, string> = {
  'twitter.com': 'twitter',
  'x.com': 'twitter',
  'github.com': 'github',
  'youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'reddit.com': 'reddit',
  'news.ycombinator.com': 'hackernews',
  'zhihu.com': 'zhihu',
  'bilibili.com': 'bilibili',
  'substack.com': 'substack',
  'medium.com': 'medium',
  'stackoverflow.com': 'stackoverflow',
  'notion.so': 'notion',
  'discord.com': 'discord',
  'weibo.com': 'weibo',
  'xiaohongshu.com': 'xiaohongshu',
  'douban.com': 'douban',
  'pixiv.net': 'pixiv',
  'tiktok.com': 'tiktok',
  'instagram.com': 'instagram',
  'facebook.com': 'facebook',
  'linkedin.com': 'linkedin',
  'douyin.com': 'douyin',
  'jike.city': 'jike',
  'okjike.com': 'jike',
  'v2ex.com': 'v2ex',
  'dev.to': 'devto',
  'lobste.rs': 'lobsters',
  'wikipedia.org': 'wikipedia',
  'store.steampowered.com': 'steam',
  'arxiv.org': 'arxiv',
}

/** Infer content type from platform */
const PLATFORM_CONTENT_TYPE: Record<string, string> = {
  twitter: 'tweet',
  github: 'repo',
  youtube: 'video',
  reddit: 'post',
  hackernews: 'post',
  bilibili: 'video',
  tiktok: 'video',
  douyin: 'video',
  weibo: 'post',
  xiaohongshu: 'post',
  zhihu: 'post',
  jike: 'post',
  douban: 'review',
  v2ex: 'post',
  devto: 'article',
  lobsters: 'post',
  substack: 'article',
  medium: 'article',
  linkedin: 'post',
  instagram: 'post',
  facebook: 'post',
  notion: 'page',
  stackoverflow: 'post',
  wikipedia: 'article',
  steam: 'page',
}

/** Detect platform from URL domain. */
export function detectPlatform(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    // Check exact match first, then suffix match
    if (DOMAIN_PLATFORM_MAP[hostname]) return DOMAIN_PLATFORM_MAP[hostname]
    for (const [domain, platform] of Object.entries(DOMAIN_PLATFORM_MAP)) {
      if (hostname.endsWith(`.${domain}`) || hostname === domain) return platform
    }
  } catch {}
  return 'web'
}

/**
 * Parse OpenCLI JSON output into a CapturedItem.
 *
 * OpenCLI outputs vary by platform, but generally include:
 * - title / name
 * - url / link
 * - content / description / text
 * - author / user / username
 * - created_at / date / timestamp
 */
export function parseOpenCLIItem(
  raw: Record<string, unknown>,
  platform: string,
  sourceUrl?: string,
): CapturedItem {
  // Flatten GitHub starred repos: {starred_at, repo: {...}} → flat repo with starred_at
  if (raw['repo'] && typeof raw['repo'] === 'object' && 'html_url' in (raw['repo'] as object)) {
    const repo = raw['repo'] as Record<string, unknown>
    const starredAt = raw['starred_at'] as string | undefined
    raw = { ...repo, starred_at: starredAt ?? repo['created_at'] }
  }

  const url = String(raw['url'] ?? raw['link'] ?? raw['html_url'] ?? sourceUrl ?? '')
  const title = String(raw['title'] ?? raw['name'] ?? raw['full_name'] ?? '')
  const contentText = String(
    raw['content'] ?? raw['description'] ?? raw['text'] ?? raw['body']
    ?? raw['selftext'] ?? raw['summary'] ?? '',
  )
  const author = (raw['author'] ?? raw['user'] ?? raw['owner'] ?? raw['username'] ?? raw['screen_name'] ?? null) as string | null
  const capturedAt = String(
    raw['starred_at'] ?? raw['created_at'] ?? raw['date'] ?? raw['timestamp']
    ?? raw['pushed_at'] ?? new Date().toISOString(),
  )
  const platformId = (raw['id'] ?? raw['platform_id'] ?? null) as string | null
  const thumbnailUrl = (raw['thumbnail'] ?? raw['thumbnail_url'] ?? raw['avatar_url'] ?? null) as string | null

  const contentType = PLATFORM_CONTENT_TYPE[platform] ?? 'page'

  // Preserve the full raw JSON for future re-parsing
  const { content: _c, description: _d, text: _t, body: _b, ...metadata } = raw

  return {
    url,
    title,
    contentText: contentText || title,
    author: typeof author === 'string' ? author : (author && typeof author === 'object' && 'login' in (author as any)) ? String((author as any).login) : null,
    platform,
    platformId: platformId != null ? String(platformId) : null,
    contentType,
    thumbnailUrl: typeof thumbnailUrl === 'string' ? thumbnailUrl : null,
    metadata: metadata as Record<string, unknown>,
    capturedAt,
    rawJson: JSON.stringify(raw),
  }
}

/**
 * Parse the output of `opencli <platform> <command> -f json`.
 * Output may be a JSON array or newline-delimited JSON objects.
 */
export function parseOpenCLIOutput(stdout: string, platform: string): CapturedItem[] {
  const trimmed = stdout.trim()
  if (!trimmed) return []

  // Try JSON array first
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed.map(item => parseOpenCLIItem(item, platform))
    }
    // Single object
    return [parseOpenCLIItem(parsed as Record<string, unknown>, platform)]
  } catch {}

  // Try newline-delimited JSON
  const items: CapturedItem[] = []
  for (const line of trimmed.split('\n')) {
    const l = line.trim()
    if (!l) continue
    try {
      const parsed = JSON.parse(l)
      items.push(parseOpenCLIItem(parsed as Record<string, unknown>, platform))
    } catch {
      // skip non-JSON lines
    }
  }
  return items
}
