import type {
  Connector,
  ConnectorCapabilities,
  AuthStatus,
  PageResult,
  FetchContext,
  CapturedItem,
} from '@spool/connector-sdk'
import { SyncError, SyncErrorCode, parseCliJsonOutput } from '@spool/connector-sdk'

async function checkGhAuth(caps: ConnectorCapabilities): Promise<AuthStatus> {
  try {
    const result = await caps.exec.run('gh', ['auth', 'status'])
    if (result.exitCode === 0) return { ok: true }
    return {
      ok: false,
      error: SyncErrorCode.AUTH_NOT_LOGGED_IN,
      message: 'gh CLI not authenticated',
      hint: 'Install GitHub CLI and run: gh auth login',
    }
  } catch {
    return {
      ok: false,
      error: SyncErrorCode.AUTH_NOT_LOGGED_IN,
      message: 'gh CLI not found',
      hint: 'Install GitHub CLI (https://cli.github.com) and run: gh auth login',
    }
  }
}

export class GitHubStarsConnector implements Connector {
  readonly id = 'github-stars'
  readonly platform = 'github'
  readonly label = 'GitHub Stars'
  readonly description = 'Repos you recently starred on GitHub'
  readonly color = '#333333'
  readonly ephemeral = false

  constructor(private readonly caps: ConnectorCapabilities) {}

  async checkAuth(): Promise<AuthStatus> {
    return checkGhAuth(this.caps)
  }

  async fetchPage(ctx: FetchContext): Promise<PageResult> {
    const page = ctx.cursor ? parseInt(ctx.cursor, 10) : 1

    const result = await this.caps.exec.run('gh', [
      'api', `/user/starred?per_page=100&page=${page}`,
      '-H', 'Accept: application/vnd.github.v3.star+json',
    ])

    if (result.exitCode !== 0) {
      throw new SyncError(SyncErrorCode.API_UNEXPECTED_STATUS, `gh api failed: ${result.stderr.slice(0, 300)}`)
    }

    const items = parseCliJsonOutput(result.stdout, 'github', 'repo')

    if (items.length === 0) {
      return { items: [], nextCursor: null }
    }

    // Stop forward sync when we reach a known item
    if (ctx.phase === 'forward' && ctx.sinceItemId) {
      const anchorIdx = items.findIndex(i => i.platformId === ctx.sinceItemId)
      if (anchorIdx >= 0) {
        return { items: items.slice(0, anchorIdx), nextCursor: null }
      }
    }

    return {
      items,
      nextCursor: items.length >= 100 ? String(page + 1) : null,
    }
  }
}

export class GitHubNotificationsConnector implements Connector {
  readonly id = 'github-notifications'
  readonly platform = 'github'
  readonly label = 'GitHub Notifications'
  readonly description = 'Your GitHub notifications'
  readonly color = '#333333'
  readonly ephemeral = true

  constructor(private readonly caps: ConnectorCapabilities) {}

  async checkAuth(): Promise<AuthStatus> {
    return checkGhAuth(this.caps)
  }

  async fetchPage(ctx: FetchContext): Promise<PageResult> {
    const result = await this.caps.exec.run('gh', ['api', '/notifications'])

    if (result.exitCode !== 0) {
      throw new SyncError(SyncErrorCode.API_UNEXPECTED_STATUS, `gh api failed: ${result.stderr.slice(0, 300)}`)
    }

    let parsed: any[]
    try {
      parsed = JSON.parse(result.stdout.trim())
      if (!Array.isArray(parsed)) parsed = []
    } catch {
      return { items: [], nextCursor: null }
    }

    const items: CapturedItem[] = parsed.map((n: any) => ({
      url: n.subject?.url
        ? `https://github.com/${n.repository?.full_name ?? ''}`
        : `https://github.com/notifications`,
      title: n.subject?.title ?? 'Notification',
      contentText: `${n.reason}: ${n.subject?.title ?? ''} (${n.repository?.full_name ?? ''})`,
      author: null,
      platform: 'github',
      platformId: n.id ? String(n.id) : null,
      contentType: 'notification',
      thumbnailUrl: n.repository?.owner?.avatar_url ?? null,
      metadata: {
        reason: n.reason,
        repository: n.repository?.full_name,
        type: n.subject?.type,
        unread: n.unread,
      },
      capturedAt: n.updated_at ?? new Date().toISOString(),
      rawJson: JSON.stringify(n),
    }))

    return { items, nextCursor: null }
  }
}

export const connectors = [GitHubStarsConnector, GitHubNotificationsConnector]
