import type { Connector, AuthStatus, PageResult, FetchContext } from '../types.js'
import { SyncError, SyncErrorCode } from '../types.js'
import { extractChromeXCookies, detectChromeUserDataDir } from '../capabilities/cookies-chrome.js'
import { fetchBookmarkPage } from './graphql-fetch.js'
import type { ChromeCookieResult } from '../capabilities/cookies-chrome.js'

export class TwitterBookmarksConnector implements Connector {
  readonly id = 'twitter-bookmarks'
  readonly platform = 'twitter'
  readonly label = 'X Bookmarks'
  readonly description = 'Your saved tweets on X'
  readonly color = '#1DA1F2'
  readonly ephemeral = false

  private chromeUserDataDir: string | undefined
  private chromeProfileDirectory: string
  private cachedCookies: ChromeCookieResult | null = null
  private fetchFn: typeof globalThis.fetch

  constructor(opts?: {
    chromeUserDataDir?: string
    chromeProfileDirectory?: string
    fetchFn?: typeof globalThis.fetch
  }) {
    this.chromeUserDataDir = opts?.chromeUserDataDir
    this.chromeProfileDirectory = opts?.chromeProfileDirectory ?? 'Default'
    this.fetchFn = opts?.fetchFn ?? globalThis.fetch
  }

  async checkAuth(): Promise<AuthStatus> {
    try {
      const dataDir = this.chromeUserDataDir ?? detectChromeUserDataDir()
      extractChromeXCookies(dataDir, this.chromeProfileDirectory)
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

  async fetchPage({ cursor }: FetchContext): Promise<PageResult> {
    // Extract cookies fresh for each sync cycle (they may expire)
    // Cache within a single sync run to avoid re-reading DB on every page
    if (!this.cachedCookies) {
      try {
        const dataDir = this.chromeUserDataDir ?? detectChromeUserDataDir()
        this.cachedCookies = extractChromeXCookies(dataDir, this.chromeProfileDirectory)
      } catch (err) {
        if (err instanceof SyncError) throw err
        throw new SyncError(
          SyncErrorCode.AUTH_UNKNOWN,
          err instanceof Error ? err.message : String(err),
          err,
        )
      }
    }

    const result = await fetchBookmarkPage(
      this.cachedCookies.csrfToken,
      cursor,
      { cookieHeader: this.cachedCookies.cookieHeader, fetchFn: this.fetchFn },
    )

    return {
      items: result.items,
      nextCursor: result.nextCursor,
    }
  }

  /** Clear cached cookies (call between sync cycles). */
  clearCookieCache(): void {
    this.cachedCookies = null
  }
}
