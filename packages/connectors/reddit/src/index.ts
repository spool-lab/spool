import type {
  Connector,
  ConnectorCapabilities,
  AuthStatus,
  PageResult,
  FetchContext,
} from '@spool-lab/connector-sdk'
import { SyncError, SyncErrorCode } from '@spool-lab/connector-sdk'
import { buildAuth, fetchUsername, fetchListingPage } from './fetch.js'

interface RedditSession {
  cookieHeader: string
  username: string
}

async function readCookieHeader(caps: ConnectorCapabilities): Promise<string> {
  const cookies = await caps.cookies.get({ browser: 'chrome', url: 'https://reddit.com' })
  const auth = buildAuth(cookies)
  if (!auth) {
    throw new SyncError(
      SyncErrorCode.AUTH_NOT_LOGGED_IN,
      'No reddit_session cookie found in Chrome. Log into reddit.com in Chrome and retry.',
    )
  }
  return auth.cookieHeader
}

abstract class RedditListingConnector implements Connector {
  abstract readonly id: string
  abstract readonly label: string
  abstract readonly description: string
  abstract readonly listing: 'saved' | 'upvoted'

  readonly platform = 'reddit'
  readonly color = '#FF4500'
  readonly ephemeral = false

  private cached: RedditSession | null = null

  constructor(protected readonly caps: ConnectorCapabilities) {}

  async checkAuth(): Promise<AuthStatus> {
    try {
      await readCookieHeader(this.caps)
      return { ok: true }
    } catch (err) {
      if (err instanceof SyncError) {
        return { ok: false, error: err.code, message: err.message, hint: err.message }
      }
      return {
        ok: false,
        error: SyncErrorCode.AUTH_UNKNOWN,
        message: err instanceof Error ? err.message : String(err),
        hint: 'Check that Chrome is installed and you are logged into reddit.com.',
      }
    }
  }

  async fetchPage(ctx: FetchContext): Promise<PageResult> {
    const signal = ctx.signal ?? new AbortController().signal
    try {
      if (!this.cached) {
        const cookieHeader = await readCookieHeader(this.caps)
        const client = { cookieHeader, fetch: this.caps.fetch, signal }
        this.cached = { cookieHeader, username: await fetchUsername(client) }
      }
      const client = { cookieHeader: this.cached.cookieHeader, fetch: this.caps.fetch, signal }

      const page = await this.caps.log.span(
        'fetchPage',
        () => fetchListingPage(this.listing, this.cached!.username, ctx.cursor, client),
        { attributes: { 'reddit.listing': this.listing, 'reddit.phase': ctx.phase, 'reddit.cursor': ctx.cursor ?? 'initial' } },
      )

      if (ctx.phase === 'forward' && ctx.sinceItemId) {
        const anchorIdx = page.items.findIndex(i => i.platformId === ctx.sinceItemId)
        if (anchorIdx >= 0) {
          return { items: page.items.slice(0, anchorIdx), nextCursor: null }
        }
      }

      return page
    } catch (err) {
      if (err instanceof SyncError && err.needsReauth) this.cached = null
      throw err
    }
  }
}

export class RedditSavedConnector extends RedditListingConnector {
  readonly id = 'reddit-saved'
  readonly label = 'Reddit Saved'
  readonly description = 'Posts and comments you saved on Reddit'
  readonly listing = 'saved'
}

export class RedditUpvotedConnector extends RedditListingConnector {
  readonly id = 'reddit-upvoted'
  readonly label = 'Reddit Upvoted'
  readonly description = 'Posts you upvoted on Reddit'
  readonly listing = 'upvoted'
}

export const connectors = [RedditSavedConnector, RedditUpvotedConnector]
