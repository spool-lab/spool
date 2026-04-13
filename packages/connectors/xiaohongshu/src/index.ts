import type {
  Connector,
  ConnectorCapabilities,
  AuthStatus,
  PageResult,
  FetchContext,
} from '@spool/connector-sdk'
import { SyncError, SyncErrorCode, parseCliJsonOutput } from '@spool/connector-sdk'

async function checkOpenCLI(caps: ConnectorCapabilities): Promise<AuthStatus> {
  // Step 1: check opencli is installed
  let doctorOutput: string
  try {
    const result = await caps.exec.run('opencli', ['doctor'], { timeout: 10000 })
    doctorOutput = result.stdout + result.stderr
  } catch {
    return {
      ok: false,
      error: SyncErrorCode.AUTH_NOT_LOGGED_IN,
      message: 'opencli not found',
      hint: 'Install opencli: npm i -g @jackwener/opencli',
    }
  }

  // Step 2: check browser bridge connectivity via doctor output
  if (!/\[OK\].*Extension/i.test(doctorOutput)) {
    return {
      ok: false,
      error: SyncErrorCode.AUTH_NOT_LOGGED_IN,
      message: 'opencli Browser Bridge not connected',
      hint: 'Install the opencli Browser Bridge extension in Chrome. Run "opencli doctor" for details.',
    }
  }

  if (!/\[OK\].*Connectivity/i.test(doctorOutput)) {
    return {
      ok: false,
      error: SyncErrorCode.AUTH_NOT_LOGGED_IN,
      message: 'opencli connectivity check failed',
      hint: 'Open Chrome and make sure the opencli extension is enabled. Run "opencli doctor" for details.',
    }
  }

  return { ok: true }
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
