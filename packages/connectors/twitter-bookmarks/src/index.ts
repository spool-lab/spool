import type {
  Connector,
  ConnectorCapabilities,
  AuthStatus,
  PageResult,
  FetchContext,
  Cookie,
} from '@spool-lab/connector-sdk'
import { SyncError, SyncErrorCode } from '@spool-lab/connector-sdk'
import { fetchBookmarkPage } from './graphql-fetch.js'

interface TwitterAuth {
  csrfToken: string
  cookieHeader: string
}

function buildAuth(cookies: Cookie[]): TwitterAuth | null {
  const ct0 = cookies.find(c => c.name === 'ct0')
  if (!ct0) return null
  const authToken = cookies.find(c => c.name === 'auth_token')
  const parts = [`ct0=${ct0.value}`]
  if (authToken) parts.push(`auth_token=${authToken.value}`)
  return { csrfToken: ct0.value, cookieHeader: parts.join('; ') }
}

export default class TwitterBookmarksConnector implements Connector {
  readonly id = 'twitter-bookmarks'
  readonly platform = 'twitter'
  readonly label = 'X Bookmarks'
  readonly description = 'Your saved tweets on X'
  readonly color = '#1DA1F2'
  readonly ephemeral = false

  private cachedAuth: TwitterAuth | null = null

  constructor(private readonly caps: ConnectorCapabilities) {}

  async checkAuth(): Promise<AuthStatus> {
    try {
      await this.readAuth()
      return { ok: true }
    } catch (err) {
      if (err instanceof SyncError) {
        return {
          ok: false,
          error: err.code,
          message: err.message,
          hint: err.message,
        }
      }
      return {
        ok: false,
        error: SyncErrorCode.AUTH_UNKNOWN,
        message: err instanceof Error ? err.message : String(err),
        hint: 'Check that Chrome is installed and you are logged into X.',
      }
    }
  }

  async fetchPage(ctx: FetchContext): Promise<PageResult> {
    if (!this.cachedAuth) {
      this.cachedAuth = await this.readAuth()
    }

    try {
      const result = await this.caps.log.span(
        'fetchPage',
        () => fetchBookmarkPage(this.cachedAuth!.csrfToken, ctx.cursor, {
          cookieHeader: this.cachedAuth!.cookieHeader,
          fetch: this.caps.fetch,
          signal: ctx.signal!,
        }),
        { attributes: { 'twitter.phase': ctx.phase, 'twitter.cursor': ctx.cursor ?? 'initial' } },
      )

      return { items: result.items, nextCursor: result.nextCursor }
    } catch (err) {
      // Invalidate cached auth on session expiry so next cycle re-reads cookies
      if (err instanceof SyncError && err.needsReauth) {
        this.cachedAuth = null
      }
      throw err
    }
  }

  private async readAuth(): Promise<TwitterAuth> {
    const xCookies = await this.caps.cookies.get({ browser: 'chrome', url: 'https://x.com' })
    const auth = buildAuth(xCookies)
    if (auth) return auth

    // Fallback: twitter.com domain (some accounts still use this)
    const twCookies = await this.caps.cookies.get({ browser: 'chrome', url: 'https://twitter.com' })
    const fallback = buildAuth(twCookies)
    if (fallback) return fallback

    throw new SyncError(
      SyncErrorCode.AUTH_NOT_LOGGED_IN,
      'No ct0 CSRF cookie found for x.com or twitter.com in Chrome. Log into X in Chrome and retry.',
    )
  }
}
