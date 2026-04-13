import type {
  Connector,
  ConnectorCapabilities,
  AuthStatus,
  PageResult,
  FetchContext,
} from '@spool/connector-sdk'
import { SyncError, SyncErrorCode, parseCliJsonOutput } from '@spool/connector-sdk'

async function checkOpenCLI(caps: ConnectorCapabilities): Promise<AuthStatus> {
  try {
    const result = await caps.exec.run('opencli', ['--version'], { timeout: 5000 })
    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: SyncErrorCode.AUTH_NOT_LOGGED_IN,
        message: 'opencli not working',
        hint: 'Install opencli: npm i -g @jackwener/opencli',
      }
    }
  } catch {
    return {
      ok: false,
      error: SyncErrorCode.AUTH_NOT_LOGGED_IN,
      message: 'opencli not found',
      hint: 'Install opencli: npm i -g @jackwener/opencli',
    }
  }

  // Check xiaohongshu auth by attempting a minimal fetch
  try {
    const result = await caps.exec.run('opencli', ['xiaohongshu', 'feed', '-f', 'json', '--limit', '1'], { timeout: 15000 })
    if (result.exitCode !== 0) {
      const isAuth = /login|auth|cookie|session/i.test(result.stderr)
      return {
        ok: false,
        error: isAuth ? SyncErrorCode.AUTH_NOT_LOGGED_IN : SyncErrorCode.CONNECTOR_ERROR,
        message: result.stderr.slice(0, 200),
        hint: isAuth
          ? 'Log into Xiaohongshu in Chrome, then run: opencli xiaohongshu feed'
          : `opencli error: ${result.stderr.slice(0, 100)}`,
      }
    }
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: SyncErrorCode.CONNECTOR_ERROR,
      message: err instanceof Error ? err.message : String(err),
      hint: 'Check opencli installation: opencli xiaohongshu feed -f json --limit 1',
    }
  }
}

async function runOpenCLI(
  caps: ConnectorCapabilities,
  command: string,
): Promise<PageResult> {
  const result = await caps.exec.run('opencli', ['xiaohongshu', command, '-f', 'json'])

  if (result.exitCode !== 0) {
    throw new SyncError(
      SyncErrorCode.API_UNEXPECTED_STATUS,
      `opencli xiaohongshu ${command} failed: ${result.stderr.slice(0, 300)}`,
    )
  }

  const items = parseCliJsonOutput(result.stdout, 'xiaohongshu')
  return { items, nextCursor: null }
}

export class XiaohongshuFeedConnector implements Connector {
  readonly id = 'xiaohongshu-feed'
  readonly platform = 'xiaohongshu'
  readonly label = 'Xiaohongshu Feed'
  readonly description = 'Recommended posts on Xiaohongshu'
  readonly color = '#FE2C55'
  readonly ephemeral = true

  constructor(private readonly caps: ConnectorCapabilities) {}

  async checkAuth(): Promise<AuthStatus> {
    return checkOpenCLI(this.caps)
  }

  async fetchPage(_ctx: FetchContext): Promise<PageResult> {
    return runOpenCLI(this.caps, 'feed')
  }
}

export class XiaohongshuNotesConnector implements Connector {
  readonly id = 'xiaohongshu-notes'
  readonly platform = 'xiaohongshu'
  readonly label = 'Xiaohongshu My Notes'
  readonly description = 'Your published notes with stats'
  readonly color = '#FE2C55'
  readonly ephemeral = false

  constructor(private readonly caps: ConnectorCapabilities) {}

  async checkAuth(): Promise<AuthStatus> {
    return checkOpenCLI(this.caps)
  }

  async fetchPage(_ctx: FetchContext): Promise<PageResult> {
    return runOpenCLI(this.caps, 'creator-notes')
  }
}

export class XiaohongshuNotificationsConnector implements Connector {
  readonly id = 'xiaohongshu-notifications'
  readonly platform = 'xiaohongshu'
  readonly label = 'Xiaohongshu Notifications'
  readonly description = 'Your notifications on Xiaohongshu'
  readonly color = '#FE2C55'
  readonly ephemeral = true

  constructor(private readonly caps: ConnectorCapabilities) {}

  async checkAuth(): Promise<AuthStatus> {
    return checkOpenCLI(this.caps)
  }

  async fetchPage(_ctx: FetchContext): Promise<PageResult> {
    return runOpenCLI(this.caps, 'notifications')
  }
}

export const connectors = [
  XiaohongshuFeedConnector,
  XiaohongshuNotesConnector,
  XiaohongshuNotificationsConnector,
]
