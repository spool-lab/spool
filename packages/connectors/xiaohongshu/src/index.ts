import type {
  Connector,
  ConnectorCapabilities,
  AuthStatus,
  PageResult,
  FetchContext,
} from '@spool-lab/connector-sdk'
import { checkAuthViaPrerequisites, SyncError, SyncErrorCode, parseCliJsonOutput } from '@spool-lab/connector-sdk'

// opencli xiaohongshu subcommands return a single snapshot of the current
// top-N items and don't accept any cursor/page/offset flag. We always do a
// single-shot fetch with --limit.
const PAGE_LIMIT = 100

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

  async fetchPage(_ctx: FetchContext): Promise<PageResult> {
    const args = ['xiaohongshu', this.subcommand, '-f', 'json', '--limit', String(PAGE_LIMIT)]
    const result = await this.caps.exec.run('opencli', args, { timeout: 30_000 })
    if (result.exitCode !== 0) {
      // opencli treats "no rows" as an error; recognize that pattern as an
      // empty result so an account with zero items shows "0 items" instead
      // of red error state.
      if (/no\s+\w+\s+found/i.test(result.stderr)) {
        return { items: [], nextCursor: null }
      }
      throw new SyncError(
        SyncErrorCode.API_UNEXPECTED_STATUS,
        `opencli ${this.subcommand} failed (exit ${result.exitCode}): ${result.stderr.slice(0, 200)}`,
      )
    }
    const items = parseCliJsonOutput(result.stdout, 'xiaohongshu', 'post')
    return { items, nextCursor: null }
  }
}

export class XhsNotesConnector extends XhsBaseConnector {
  readonly id = 'xiaohongshu-notes'
  readonly label = 'Xiaohongshu Notes'
  readonly description = 'Notes you have published'
  readonly ephemeral = false
  readonly subcommand = 'creator-notes'
}

// Feed and Notifications sub-connectors intentionally omitted for now:
// - feed: opencli reads from page Pinia store without scrolling, so item
//   count fluctuates with whatever the store happens to hold (~20 items).
// - notifications: opencli currently emits only `{rank: N}` placeholders
//   without stable IDs/content, plus session detach issues.
// Both will return when upstream behavior stabilizes.

export const connectors = [XhsNotesConnector]
