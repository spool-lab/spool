import type {
  Connector,
  ConnectorCapabilities,
  AuthStatus,
  PageResult,
  FetchContext,
} from '@spool/connector-sdk'
import { checkAuthViaPrerequisites, SyncError, SyncErrorCode, parseCliJsonOutput } from '@spool/connector-sdk'

const MAX_PAGES: Record<string, number> = {
  feed: 3,
  notes: 20,
  notifications: 20,
}
const PAGE_LIMIT = 20

abstract class XhsBaseConnector implements Connector {
  abstract readonly id: string
  abstract readonly label: string
  abstract readonly description: string
  abstract readonly ephemeral: boolean
  abstract readonly subcommand: string

  readonly platform = 'xiaohongshu'
  readonly color = '#FF2442'

  constructor(protected readonly caps: ConnectorCapabilities) {}

  async checkAuth(): Promise<AuthStatus> {
    return checkAuthViaPrerequisites(this.caps)
  }

  async fetchPage(ctx: FetchContext): Promise<PageResult> {
    const pageNum = ctx.cursor ? Math.max(1, parseInt(ctx.cursor, 10)) : 1
    const maxPages = MAX_PAGES[this.subcommand] ?? 5

    const args = ['xiaohongshu', this.subcommand, '-f', 'json', '--limit', String(PAGE_LIMIT)]
    // opencli may not support --cursor yet; the page cap above is our safety net.
    if (ctx.cursor) args.push('--cursor', ctx.cursor)

    const result = await this.caps.exec.run('opencli', args, { timeout: 30_000 })
    if (result.exitCode !== 0) {
      throw new SyncError(
        SyncErrorCode.API_UNEXPECTED_STATUS,
        `opencli ${this.subcommand} failed (exit ${result.exitCode}): ${result.stderr.slice(0, 200)}`,
      )
    }
    const items = parseCliJsonOutput(result.stdout, 'xiaohongshu', 'post')

    const hasMore = items.length >= PAGE_LIMIT && pageNum < maxPages
    return {
      items,
      nextCursor: hasMore ? String(pageNum + 1) : null,
    }
  }
}

export class XhsFeedConnector extends XhsBaseConnector {
  readonly id = 'xiaohongshu-feed'
  readonly label = 'Xiaohongshu Feed'
  readonly description = 'Your Xiaohongshu home feed'
  readonly ephemeral = true
  readonly subcommand = 'feed'
}

export class XhsNotesConnector extends XhsBaseConnector {
  readonly id = 'xiaohongshu-notes'
  readonly label = 'Xiaohongshu Notes'
  readonly description = 'Notes you have published'
  readonly ephemeral = false
  readonly subcommand = 'notes'
}

export class XhsNotificationsConnector extends XhsBaseConnector {
  readonly id = 'xiaohongshu-notifications'
  readonly label = 'Xiaohongshu Notifications'
  readonly description = 'Messages, likes, and comments'
  readonly ephemeral = false
  readonly subcommand = 'notifications'
}

export const connectors = [XhsFeedConnector, XhsNotesConnector, XhsNotificationsConnector]
