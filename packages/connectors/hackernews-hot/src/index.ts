import type {
  Connector,
  ConnectorCapabilities,
  AuthStatus,
  PageResult,
  FetchContext,
  CapturedItem,
} from '@spool-lab/connector-sdk'
import { SyncError, SyncErrorCode } from '@spool-lab/connector-sdk'

const HN_API = 'https://hacker-news.firebaseio.com/v0'
const TOP_N = 30

interface HNStory {
  id: number
  type: string
  by?: string
  time: number
  title: string
  url?: string
  text?: string
  score: number
  descendants?: number
}

export default class HackerNewsHotConnector implements Connector {
  readonly id = 'hackernews-hot'
  readonly platform = 'hackernews'
  readonly label = 'Hacker News Hot'
  readonly description = 'Top stories on Hacker News right now'
  readonly color = '#FF6600'
  readonly ephemeral = true

  constructor(private readonly caps: ConnectorCapabilities) {}

  async checkAuth(): Promise<AuthStatus> {
    return { ok: true }
  }

  async fetchPage(ctx: FetchContext): Promise<PageResult> {
    const ids = await this.fetchTopStoryIds(ctx.signal)
    const stories = await this.fetchStories(ids.slice(0, TOP_N), ctx.signal)
    const items: CapturedItem[] = stories.map(story => ({
      url: story.url ?? `https://news.ycombinator.com/item?id=${story.id}`,
      title: story.title,
      contentText: story.text ?? story.title,
      author: story.by ?? null,
      platform: 'hackernews',
      platformId: String(story.id),
      contentType: 'story',
      thumbnailUrl: null,
      metadata: {
        score: story.score,
        descendants: story.descendants ?? 0,
        type: story.type,
      },
      capturedAt: new Date(story.time * 1000).toISOString(),
      rawJson: JSON.stringify(story),
    }))
    return { items, nextCursor: null }
  }

  private async fetchTopStoryIds(signal?: AbortSignal): Promise<number[]> {
    const res = await this.caps.fetch(`${HN_API}/topstories.json`, { signal })
    if (!res.ok) {
      throw new SyncError(
        res.status >= 500 ? SyncErrorCode.API_SERVER_ERROR : SyncErrorCode.API_UNEXPECTED_STATUS,
        `HN API returned ${res.status}`,
      )
    }
    return await res.json() as number[]
  }

  private async fetchStories(ids: number[], signal?: AbortSignal): Promise<HNStory[]> {
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const res = await this.caps.fetch(`${HN_API}/item/${id}.json`, { signal })
        if (!res.ok) {
          this.caps.log.warn('failed to fetch HN item', {
            id,
            status: res.status,
            error: res.status === 429 ? 'rate limited' : `HTTP ${res.status}`,
          })
          return null
        }
        return await res.json() as HNStory
      }),
    )
    const stories: HNStory[] = []
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        stories.push(r.value)
      } else if (r.status === 'rejected') {
        this.caps.log.warn('failed to fetch HN item', { error: String(r.reason) })
      }
    }
    return stories
  }
}
