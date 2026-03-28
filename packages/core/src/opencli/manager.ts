import { spawn, execSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { OpenCLISetupStatus, PlatformInfo, CapturedItem } from '../types.js'
import { cachedResolve, clearResolveCache } from '../util/resolve-bin.js'
import { parseOpenCLIOutput, parseOpenCLIItem, detectPlatform } from './parser.js'
import { getStrategy, SYNC_STRATEGIES } from './strategies.js'
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
      connectivityOk: false,
      connectivityError: null,
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

    // Check browser bridge & connectivity via `opencli doctor`
    try {
      const doctorOutput = await this.exec(['doctor'], 10000)
      result.browserBridgeReady = /\[ok]\s*extension/i.test(doctorOutput)
      result.connectivityOk = /\[ok]\s*connectivity/i.test(doctorOutput)
      if (!result.connectivityOk) {
        const match = doctorOutput.match(/\[fail]\s*connectivity[:\s]*(?:failed\s*)?[(\s]*(.+?)\)?$/im)
        result.connectivityError = match?.[1]?.trim() ?? null
      }
    } catch {}

    // Check if Chrome is running
    try {
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
      // Use login shell to pick up nvm/fnm/volta PATH on macOS GUI apps
      await new Promise<string>((resolve, reject) => {
        const proc = spawn('bash', ['-lc', 'npm install -g @jackwener/opencli'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
          timeout: 60000,
        })
        let stdout = ''
        let stderr = ''
        proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
        proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
        proc.on('close', (code) => {
          if (code === 0) resolve(stdout)
          else reject(new Error(`npm install failed (code ${code}): ${stderr.slice(0, 500)}`))
        })
        proc.on('error', reject)
      })
      // Clear cached resolve so next checkSetup finds the newly installed binary
      clearResolveCache('opencli')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ── Platform Discovery ─────────────────────────────────────────────────

  async listAvailablePlatforms(): Promise<PlatformInfo[]> {
    // Return our curated sync strategies — only commands known to work
    // as batch-syncable list operations
    return SYNC_STRATEGIES.map(s => ({
      platform: s.platform,
      command: s.command,
      label: s.label,
      description: s.description,
    }))
  }

  // ── Source Sync ────────────────────────────────────────────────────────

  async syncSource(
    opencliSrcId: number,
    platform: string,
    command: string,
  ): Promise<{ items: CapturedItem[]; added: number }> {
    this.onProgress?.({ phase: 'fetching', message: `Fetching ${platform} ${command}...` })

    const strategy = getStrategy(platform, command)
    let stdout: string
    let items: CapturedItem[]

    if (strategy?.customExec) {
      // Custom binary path (e.g. gh api for GitHub Stars)
      stdout = await this.execCustom(strategy.customExec.bin, strategy.customExec.args, 60000)
      items = parseOpenCLIOutput(stdout, platform)
    } else {
      const cmdArgs = command.split(/\s+/)
      const extraArgs = strategy?.args ?? []
      stdout = await this.exec([platform, ...cmdArgs, ...extraArgs, '-f', 'json'], 60000)
      items = parseOpenCLIOutput(stdout, platform)
    }

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

    const stdout = await this.exec(['generate', url], 30000)
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

  private _fullPath: string | null = null

  /** Build a PATH that includes common Node manager dirs — needed for macOS GUI apps. */
  private getFullPath(): string {
    if (this._fullPath) return this._fullPath
    const base = process.env['PATH'] ?? ''
    const home = homedir()

    // Try user's login shell for full PATH (zsh first — macOS default, then bash)
    const shells = [
      process.env['SHELL'] ?? 'zsh',
      'bash',
    ]
    for (const sh of shells) {
      try {
        const shellPath = execSync(`${sh} -lc "echo \\$PATH"`, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
        if (shellPath && shellPath !== base) {
          this._fullPath = shellPath
          return shellPath
        }
      } catch {}
    }

    // Fallback: well-known paths + nvm version dirs
    const nvmBins = this.nvmVersionBins(home)
    const extras = [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      `${home}/.local/bin`,
      `${home}/.nvm/current/bin`,
      ...nvmBins,
    ]
    this._fullPath = [...extras, base].join(':')
    return this._fullPath
  }

  private nvmVersionBins(home: string): string[] {
    const versionsDir = join(home, '.nvm', 'versions', 'node')
    try {
      return readdirSync(versionsDir)
        .filter(d => d.startsWith('v'))
        .sort().reverse()
        .map(d => join(versionsDir, d, 'bin'))
    } catch {
      return []
    }
  }

  private exec(args: string[], timeout = 30000): Promise<string> {
    const binPath = cachedResolve('opencli')
    if (!binPath) throw new Error('opencli not installed. Run: npm install -g @jackwener/opencli')

    return new Promise((resolve, reject) => {
      const proc = spawn(binPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PATH: this.getFullPath() },
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

  private execCustom(bin: string, args: string[], timeout = 30000): Promise<string> {
    const binPath = cachedResolve(bin) ?? bin
    return new Promise((resolve, reject) => {
      const proc = spawn(binPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PATH: this.getFullPath() },
        timeout,
      })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })

      proc.on('close', (code) => {
        if (code === 0) resolve(stdout)
        else reject(new Error(`${bin} exited with code ${code}: ${stderr.slice(0, 500)}`))
      })

      proc.on('error', (err) => reject(err))
    })
  }
}
