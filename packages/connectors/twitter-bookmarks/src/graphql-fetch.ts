import type { FetchCapability, CapturedItem } from '@spool/connector-sdk'
import { SyncError, SyncErrorCode, abortableSleep } from '@spool/connector-sdk'

// ── Constants ───────────────────────────────────────────────────────────────

const X_PUBLIC_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

const BOOKMARKS_QUERY_ID = 'Z9GWmP0kP2dajyckAaDUBw'
const BOOKMARKS_OPERATION = 'Bookmarks'

const GRAPHQL_FEATURES = {
  graphql_timeline_v2_bookmark_timeline: true,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_uc_gql_enabled: true,
  vibe_api_enabled: true,
  responsive_web_text_conversations_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  responsive_web_media_download_video_enabled: false,
}

// ── URL & Headers ───────────────────────────────────────────────────────────

function buildUrl(cursor?: string): string {
  const variables: Record<string, unknown> = { count: 20 }
  if (cursor) variables.cursor = cursor
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(GRAPHQL_FEATURES),
  })
  return `https://x.com/i/api/graphql/${BOOKMARKS_QUERY_ID}/${BOOKMARKS_OPERATION}?${params}`
}

function buildHeaders(csrfToken: string, cookieHeader?: string): Record<string, string> {
  return {
    authorization: `Bearer ${X_PUBLIC_BEARER}`,
    'x-csrf-token': csrfToken,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'content-type': 'application/json',
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    cookie: cookieHeader ?? `ct0=${csrfToken}`,
  }
}

// ── Response Parsing ────────────────────────────────────────────────────────

export interface BookmarkPageResult {
  items: CapturedItem[]
  nextCursor: string | null
}

function convertTweetToItem(tweetResult: any, now: string): CapturedItem | null {
  const tweet = tweetResult.tweet ?? tweetResult
  const legacy = tweet?.legacy
  if (!legacy) return null

  const tweetId = legacy.id_str ?? tweet?.rest_id
  if (!tweetId) return null

  const userResult = tweet?.core?.user_results?.result
  const authorHandle =
    userResult?.core?.screen_name ?? userResult?.legacy?.screen_name
  const authorName =
    userResult?.core?.name ?? userResult?.legacy?.name
  const authorProfileImageUrl =
    userResult?.avatar?.image_url ??
    userResult?.legacy?.profile_image_url_https ??
    userResult?.legacy?.profile_image_url

  const mediaEntities =
    legacy?.extended_entities?.media ?? legacy?.entities?.media ?? []
  const media: string[] = mediaEntities
    .map((m: any) => m.media_url_https ?? m.media_url)
    .filter(Boolean)
  const mediaObjects = mediaEntities.map((m: any) => ({
    type: m.type,
    url: m.media_url_https ?? m.media_url,
    expandedUrl: m.expanded_url,
    width: m.original_info?.width,
    height: m.original_info?.height,
    altText: m.ext_alt_text,
  }))

  const urlEntities = legacy?.entities?.urls ?? []
  const links: string[] = urlEntities
    .map((u: any) => u.expanded_url)
    .filter((u: string | undefined) => u && !u.includes('t.co'))

  const authorSnapshot = userResult
    ? {
        id: userResult.rest_id,
        handle: authorHandle,
        name: authorName,
        profileImageUrl: authorProfileImageUrl,
        bio: userResult?.legacy?.description,
        followerCount: userResult?.legacy?.followers_count,
        followingCount: userResult?.legacy?.friends_count,
        isVerified: Boolean(
          userResult?.is_blue_verified ?? userResult?.legacy?.verified,
        ),
        location:
          typeof userResult?.location === 'object'
            ? userResult.location.location
            : userResult?.legacy?.location,
      }
    : undefined

  const engagement = {
    likeCount: legacy.favorite_count,
    repostCount: legacy.retweet_count,
    replyCount: legacy.reply_count,
    quoteCount: legacy.quote_count,
    bookmarkCount: legacy.bookmark_count,
    viewCount: tweet?.views?.count ? Number(tweet.views.count) : undefined,
  }

  const text = legacy.full_text ?? legacy.text ?? ''
  const url = `https://x.com/${authorHandle ?? '_'}/status/${tweetId}`

  return {
    url,
    title: text.length > 120 ? text.slice(0, 117) + '...' : text,
    contentText: text,
    author: authorHandle ?? null,
    platform: 'twitter',
    platformId: tweetId,
    contentType: 'tweet',
    thumbnailUrl: authorProfileImageUrl ?? null,
    metadata: {
      authorSnapshot,
      engagement,
      media,
      mediaObjects,
      links,
      language: legacy.lang,
      conversationId: legacy.conversation_id_str,
      inReplyToStatusId: legacy.in_reply_to_status_id_str,
      quotedStatusId: legacy.quoted_status_id_str,
      postedAt: legacy.created_at,
      sourceApp: legacy.source,
    },
    capturedAt: legacy.created_at
      ? new Date(legacy.created_at).toISOString()
      : now,
    rawJson: JSON.stringify(tweetResult),
  }
}

export function parseBookmarksResponse(json: any, now?: string): BookmarkPageResult {
  const ts = now ?? new Date().toISOString()
  const instructions =
    json?.data?.bookmark_timeline_v2?.timeline?.instructions ?? []
  const entries: any[] = []
  for (const inst of instructions) {
    if (inst.type === 'TimelineAddEntries' && Array.isArray(inst.entries)) {
      entries.push(...inst.entries)
    }
  }

  const items: CapturedItem[] = []
  let nextCursor: string | null = null

  for (const entry of entries) {
    if (entry.entryId?.startsWith('cursor-bottom')) {
      nextCursor = entry.content?.value ?? null
      continue
    }

    const tweetResult = entry?.content?.itemContent?.tweet_results?.result
    if (!tweetResult) continue

    const item = convertTweetToItem(tweetResult, ts)
    if (item) items.push(item)
  }

  return { items, nextCursor }
}

// ── Fetch with Retry ────────────────────────────────────────────────────────

export async function fetchBookmarkPage(
  csrfToken: string,
  cursor: string | null,
  opts: {
    cookieHeader: string
    fetch: FetchCapability
    signal: AbortSignal
  },
): Promise<BookmarkPageResult> {
  const { cookieHeader, fetch: fetchFn, signal } = opts
  let lastError: Error | undefined

  for (let attempt = 0; attempt < 4; attempt++) {
    if (signal.aborted) {
      throw signal.reason
    }

    let response: Response
    try {
      response = await fetchFn(
        buildUrl(cursor ?? undefined),
        { headers: buildHeaders(csrfToken, cookieHeader), signal },
      )
    } catch (err) {
      if (signal.aborted) {
        throw signal.reason
      }
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
      const waitSec = Math.min(15 * Math.pow(2, attempt), 120)
      lastError = new Error(`Rate limited (429) on attempt ${attempt + 1}`)
      await abortableSleep(waitSec * 1000, signal)
      continue
    }

    if (response.status >= 500) {
      lastError = new Error(`Server error (${response.status}) on attempt ${attempt + 1}`)
      await abortableSleep(5000 * (attempt + 1), signal)
      continue
    }

    if (response.status === 401 || response.status === 403) {
      throw new SyncError(
        SyncErrorCode.AUTH_SESSION_EXPIRED,
        `X API returned ${response.status}. Your session may have expired.`,
      )
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new SyncError(
        SyncErrorCode.API_UNEXPECTED_STATUS,
        `X GraphQL API returned ${response.status}: ${text.slice(0, 300)}`,
      )
    }

    let json: unknown
    try {
      json = await response.json()
    } catch (err) {
      throw new SyncError(
        SyncErrorCode.API_PARSE_ERROR,
        'Failed to parse X GraphQL response as JSON',
        err,
      )
    }

    try {
      return parseBookmarksResponse(json)
    } catch (err) {
      throw new SyncError(
        SyncErrorCode.API_PARSE_ERROR,
        `Failed to parse bookmarks from GraphQL response: ${err instanceof Error ? err.message : String(err)}`,
        err,
      )
    }
  }

  if (lastError?.message.includes('429')) {
    throw new SyncError(SyncErrorCode.API_RATE_LIMITED, 'Rate limited after 4 retry attempts.')
  }
  throw new SyncError(SyncErrorCode.API_SERVER_ERROR, 'Server errors after 4 retry attempts.')
}
