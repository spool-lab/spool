import type { FetchCapability, Cookie, CapturedItem } from '@spool/connector-sdk'
import { SyncError, SyncErrorCode, abortableSleep } from '@spool/connector-sdk'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'

const PAGE_SIZE = 100
const RELEVANT_COOKIE_NAMES = new Set(['reddit_session', 'loid', 'token_v2', 'edgebucket'])

export interface RedditAuth {
  cookieHeader: string
}

export function buildAuth(cookies: Cookie[]): RedditAuth | null {
  const parts: string[] = []
  let hasSession = false
  for (const c of cookies) {
    if (!RELEVANT_COOKIE_NAMES.has(c.name)) continue
    if (c.name === 'reddit_session') hasSession = true
    parts.push(`${c.name}=${c.value}`)
  }
  return hasSession ? { cookieHeader: parts.join('; ') } : null
}

export interface RedditClient {
  cookieHeader: string
  fetch: FetchCapability
  signal: AbortSignal
}

interface RedditThing {
  kind: string
  data: Record<string, any>
}

interface RedditListing {
  data: {
    after: string | null
    children: RedditThing[]
  }
}

export interface RedditPage {
  items: CapturedItem[]
  nextCursor: string | null
}

function headers(cookieHeader: string): Record<string, string> {
  return {
    cookie: cookieHeader,
    'user-agent': USER_AGENT,
    accept: 'application/json',
  }
}

async function fetchJson(url: string, client: RedditClient): Promise<unknown> {
  const { cookieHeader, fetch: fetchFn, signal } = client
  let lastCause: 'rate-limit' | 'server-error' | null = null

  for (let attempt = 0; attempt < 4; attempt++) {
    if (signal.aborted) throw signal.reason

    let response: Response
    try {
      response = await fetchFn(url, { headers: headers(cookieHeader), signal })
    } catch (err) {
      if (signal.aborted) throw signal.reason
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('ENOTFOUND') || message.includes('ENETUNREACH')) {
        throw new SyncError(SyncErrorCode.NETWORK_OFFLINE, message, err)
      }
      if (message.includes('ETIMEDOUT') || message.includes('timeout')) {
        throw new SyncError(SyncErrorCode.NETWORK_TIMEOUT, message, err)
      }
      throw new SyncError(SyncErrorCode.CONNECTOR_ERROR, message, err)
    }

    if (response.status === 429) {
      lastCause = 'rate-limit'
      await abortableSleep(Math.min(15 * Math.pow(2, attempt), 120) * 1000, signal)
      continue
    }
    if (response.status >= 500) {
      lastCause = 'server-error'
      await abortableSleep(5000 * (attempt + 1), signal)
      continue
    }
    if (response.status === 401 || response.status === 403) {
      throw new SyncError(
        SyncErrorCode.AUTH_SESSION_EXPIRED,
        `Reddit returned ${response.status}. Your session may have expired — open reddit.com in Chrome and log in again.`,
      )
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new SyncError(
        SyncErrorCode.API_UNEXPECTED_STATUS,
        `Reddit returned ${response.status}: ${text.slice(0, 300)}`,
      )
    }

    try {
      return await response.json()
    } catch (err) {
      throw new SyncError(SyncErrorCode.API_PARSE_ERROR, 'Failed to parse Reddit response as JSON', err)
    }
  }

  throw new SyncError(
    lastCause === 'rate-limit' ? SyncErrorCode.API_RATE_LIMITED : SyncErrorCode.API_SERVER_ERROR,
    `${lastCause === 'rate-limit' ? 'Rate limited' : 'Server errors'} after 4 retry attempts.`,
  )
}

export async function fetchUsername(client: RedditClient): Promise<string> {
  const json = (await fetchJson('https://old.reddit.com/api/me.json', client)) as any
  const name = json?.data?.name
  if (typeof name !== 'string' || !name) {
    throw new SyncError(
      SyncErrorCode.AUTH_NOT_LOGGED_IN,
      'Reddit did not return a username — you may not be logged in. Open reddit.com in Chrome, log in, then retry.',
    )
  }
  return name
}

// Reddit uses sentinel strings like 'self', 'default', 'nsfw', 'spoiler', 'image'
// in the thumbnail field when there is no preview. Filter those out.
function validThumbnail(url: unknown): string | null {
  if (typeof url !== 'string') return null
  if (!url.startsWith('http')) return null
  return url
}

function thingToItem(thing: RedditThing): CapturedItem | null {
  const d = thing.data
  const platformId = typeof d.name === 'string' ? d.name : null
  if (!platformId) return null

  const permalink = typeof d.permalink === 'string' ? `https://www.reddit.com${d.permalink}` : null
  const capturedAt = typeof d.created_utc === 'number'
    ? new Date(d.created_utc * 1000).toISOString()
    : new Date().toISOString()
  const author = typeof d.author === 'string' ? d.author : null

  const baseMetadata = {
    subreddit: d.subreddit,
    subredditPrefixed: d.subreddit_name_prefixed,
    score: d.score,
    permalink,
  }

  if (thing.kind === 't3') {
    const title = typeof d.title === 'string' ? d.title : '(untitled)'
    const selftext = typeof d.selftext === 'string' ? d.selftext : ''
    const externalUrl = typeof d.url === 'string' ? d.url : null
    return {
      url: externalUrl ?? permalink ?? `https://www.reddit.com/${platformId}`,
      title,
      contentText: selftext || title,
      author,
      platform: 'reddit',
      platformId,
      contentType: 'post',
      thumbnailUrl: validThumbnail(d.thumbnail),
      metadata: {
        ...baseMetadata,
        numComments: d.num_comments,
        externalUrl,
        isSelf: d.is_self,
        over18: d.over_18,
        domain: d.domain,
      },
      capturedAt,
      rawJson: JSON.stringify(thing),
    }
  }

  if (thing.kind === 't1') {
    const body = typeof d.body === 'string' ? d.body : ''
    const linkTitle = typeof d.link_title === 'string' ? d.link_title : ''
    const title = body.length > 120 ? body.slice(0, 117) + '...' : body || linkTitle || '(comment)'
    return {
      url: permalink ?? `https://www.reddit.com/${platformId}`,
      title,
      contentText: body,
      author,
      platform: 'reddit',
      platformId,
      contentType: 'comment',
      thumbnailUrl: null,
      metadata: {
        ...baseMetadata,
        linkTitle,
        linkId: d.link_id,
        linkPermalink: d.link_permalink,
      },
      capturedAt,
      rawJson: JSON.stringify(thing),
    }
  }

  return null
}

function parseListing(json: unknown): RedditPage {
  const listing = json as RedditListing | undefined
  const children = listing?.data?.children ?? []
  const items: CapturedItem[] = []
  for (const thing of children) {
    const item = thingToItem(thing)
    if (item) items.push(item)
  }
  return { items, nextCursor: listing?.data?.after ?? null }
}

export async function fetchListingPage(
  listing: 'saved' | 'upvoted',
  username: string,
  cursor: string | null,
  client: RedditClient,
): Promise<RedditPage> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), raw_json: '1' })
  if (cursor) params.set('after', cursor)
  const url = `https://old.reddit.com/user/${encodeURIComponent(username)}/${listing}.json?${params}`
  return parseListing(await fetchJson(url, client))
}
