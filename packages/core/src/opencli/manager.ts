import { spawn } from 'node:child_process'
import type Database from 'better-sqlite3'
import type { OpenCLISetupStatus, PlatformInfo, CapturedItem } from '../types.js'
import { cachedResolve } from '../util/resolve-bin.js'
import { parseOpenCLIOutput, parseOpenCLIItem, detectPlatform } from './parser.js'
import {
  getOpenCLISourceId,
  insertCapture,
  updateOpenCLISourceSynced,
} from '../db/queries.js'

export type OpenCLIProgressEvent = {
  phase: 'starting' | 'fetching' | 'indexing' | 'done' | 'error'
  message: string
}

export type OpenCLIProgressCallback = (event: OpenCLIProgressEvent) => void

export class OpenCLIManager {
  private db: Database.Database
  private onProgress: OpenCLIProgressCallback | undefined

  constructor(db: Database.Database, onProgress?: OpenCLIProgressCallback) {
    this.db = db
    this.onProgress = onProgress
  }

  // ── Setup & Detection ──────────────────────────────────────────────────

  async checkSetup(): Promise<OpenCLISetupStatus> {
    const result: OpenCLISetupStatus = {
      cliInstalled: false,
      cliVersion: null,
      browserBridgeReady: false,
      chromeRunning: false,
    }

    const binPath = cachedResolve('opencli')
    if (!binPath) return result

    result.cliInstalled = true

    // Get version
    try {
      const version = await this.exec(['--version'], 5000)
      result.cliVersion = version.trim()
    } catch {}

    // Check browser bridge status
    try {
      const bridgeOutput = await this.exec(['bridge', 'status'], 5000)
      result.browserBridgeReady = bridgeOutput.toLowerCase().includes('connected')
        || bridgeOutput.toLowerCase().includes('ready')
        || bridgeOutput.toLowerCase().includes('running')
    } catch {}

    // Check if Chrome is running
    try {
      const { execSync } = await import('node:child_process')
      execSync('pgrep -x "Google Chrome" || pgrep -x chrome || pgrep -x chromium', {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3000,
      })
      result.chromeRunning = true
    } catch {
      result.chromeRunning = false
    }

    return result
  }

  async installCli(): Promise<{ ok: boolean; error?: string }> {
    try {
      const npmPath = cachedResolve('npm') ?? 'npm'
      await new Promise<string>((resolve, reject) => {
        const proc = spawn(npmPath, ['install', '-g', '@jackwener/opencli'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
        })
        let stdout = ''
        let stderr = ''
        proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
        proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
        proc.on('close', (code) => {
          if (code === 0) resolve(stdout)
          else reject(new Error(`npm install failed (code ${code}): ${stderr}`))
        })
        proc.on('error', reject)
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ── Platform Discovery ─────────────────────────────────────────────────

  async listAvailablePlatforms(): Promise<PlatformInfo[]> {
    try {
      const output = await this.exec(['list', '-f', 'json'], 15000)
      const parsed = JSON.parse(output.trim())

      if (Array.isArray(parsed)) {
        return parsed.map((item: Record<string, unknown>) => ({
          platform: String(item['name'] ?? item['platform'] ?? ''),
          commands: Array.isArray(item['commands'])
            ? (item['commands'] as string[])
            : [String(item['command'] ?? 'default')],
          description: String(item['description'] ?? ''),
        }))
      }

      return []
    } catch {
      return []
    }
  }

  // ── Source Sync ────────────────────────────────────────────────────────

  async syncSource(
    opencliSrcId: number,
    platform: string,
    command: string,
  ): Promise<{ items: CapturedItem[]; added: number }> {
    this.onProgress?.({ phase: 'fetching', message: `Fetching ${platform} ${command}...` })

    const args = command.split(/\s+/)
    const stdout = await this.exec([platform, ...args, '-f', 'json'], 60000)
    const items = parseOpenCLIOutput(stdout, platform)

    this.onProgress?.({ phase: 'indexing', message: `Indexing ${items.length} items...` })

    const sourceId = getOpenCLISourceId(this.db)
    let added = 0

    this.db.transaction(() => {
      for (const item of items) {
        insertCapture(this.db, sourceId, opencliSrcId, item)
        added++
      }
      updateOpenCLISourceSynced(this.db, opencliSrcId, items.length)
    })()

    this.onProgress?.({ phase: 'done', message: `Synced ${added} items from ${platform}` })

    return { items, added }
  }

  // ── URL Capture ────────────────────────────────────────────────────────

  async captureUrl(url: string): Promise<CapturedItem> {
    this.onProgress?.({ phase: 'fetching', message: `Capturing ${url}...` })

    const stdout = await this.exec(['generate', url, '-f', 'json'], 30000)
    const trimmed = stdout.trim()
    const platform = detectPlatform(url)

    let item: CapturedItem

    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed)
        const data = Array.isArray(parsed) ? parsed[0] : parsed
        item = parseOpenCLIItem(data as Record<string, unknown>, platform, url)
      } catch {
        // If JSON parsing fails, treat stdout as content text
        item = {
          url,
          title: url,
          contentText: trimmed,
          author: null,
          platform,
          platformId: null,
          contentType: 'page',
          thumbnailUrl: null,
          metadata: {},
          capturedAt: new Date().toISOString(),
          rawJson: null,
        }
      }
    } else {
      throw new Error(`OpenCLI returned empty output for ${url}`)
    }

    this.onProgress?.({ phase: 'indexing', message: 'Indexing capture...' })

    const sourceId = getOpenCLISourceId(this.db)
    insertCapture(this.db, sourceId, null, item)

    this.onProgress?.({ phase: 'done', message: 'Captured and indexed' })

    return item
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private exec(args: string[], timeout = 30000): Promise<string> {
    const binPath = cachedResolve('opencli')
    if (!binPath) throw new Error('opencli not installed. Run: npm install -g @jackwener/opencli')

    return new Promise((resolve, reject) => {
      const proc = spawn(binPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
        timeout,
      })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })

      proc.on('close', (code) => {
        if (code === 0) resolve(stdout)
        else reject(new Error(`opencli exited with code ${code}: ${stderr.slice(0, 500)}`))
      })

      proc.on('error', (err) => reject(err))
    })
  }
}
