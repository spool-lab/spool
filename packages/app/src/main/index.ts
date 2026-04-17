import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, Notification, nativeTheme, nativeImage, net, powerMonitor, shell } from 'electron'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import {
  getDB, Syncer, SpoolWatcher,
  searchFragments, searchAll, searchSessionPreview, searchCaptures, listRecentSessions, getSessionWithMessages, getStatus,
  ConnectorRegistry, SyncScheduler,
  loadSyncState, saveSyncState,
  loadConnectors, makeFetchCapability, makeChromeCookiesCapability, makeLogCapabilityFor, makeSqliteCapability, makeExecCapability,
  TrustStore, downloadAndInstall, uninstallConnector, resolveNpmPackage, checkForUpdates,
  fetchRegistry,
  PrerequisiteChecker,
} from '@spool/core'
import type { UpdateInfo } from '@spool/core'
import type { AuthStatus, ConnectorStatus, FragmentResult, SchedulerEvent, SearchResult, SessionSource } from '@spool/core'
import { setupTray } from './tray.js'
import { AcpManager } from './acp.js'
import { setupAutoUpdater, downloadUpdate, quitAndInstall } from './updater.js'
import { openTerminal } from './terminal.js'
import { linkDevConnectors, installFromWorkspace } from './dev-connectors.js'
import { getSessionResumeCommand } from '../shared/resumeCommand.js'
import { resolveResumeWorkingDirectory } from './sessionResume.js'
import { loadUIPreferences, saveThemeEditor, saveThemeSource } from './uiPreferences.js'
import type Database from 'better-sqlite3'
import type { SyncWorkerMessage } from './sync-worker.js'

const isDevMode = Boolean(process.env['ELECTRON_RENDERER_URL'])
const customUserDataDir = process.env['SPOOL_ELECTRON_USER_DATA_DIR']?.trim()
if (customUserDataDir) {
  app.setPath('userData', customUserDataDir)
}
// macOS menu bar shows the first menu's label as the app name
app.setName(isDevMode ? 'Spool DEV' : 'Spool')

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('spool', process.execPath, [process.argv[1]!])
  }
} else {
  app.setAsDefaultProtocolClient('spool')
}

const uiPreferences = loadUIPreferences()
nativeTheme.themeSource = uiPreferences.themeSource
let focusExistingWindow = () => {}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

app.on('second-instance', (_event, argv) => {
  focusExistingWindow()
  const url = argv.find(arg => arg.startsWith('spool://'))
  if (url) handleSpoolUrl(url)
})

let mainWindow: BrowserWindow | null = null
let db: Database.Database
let syncer: Syncer
let watcher: SpoolWatcher
let acpManager: AcpManager
let connectorRegistry: ConnectorRegistry
let syncScheduler: SyncScheduler
let trustStore: TrustStore | null = null
let isSyncActive = false
let proxyFetch: typeof globalThis.fetch
let spoolDir: string
let updateCache = new Map<string, UpdateInfo>()
let prerequisiteChecker: PrerequisiteChecker
let execCapabilityImpl: ReturnType<typeof makeExecCapability>
const runningInstalls = new Map<string, ChildProcess>()

function makePrerequisitesFor(registry: ConnectorRegistry, checker: PrerequisiteChecker) {
  return (packageId: string) => ({
    check: () => {
      const pkg = registry.getPackage(packageId)
      if (!pkg) throw new Error(`Package "${packageId}" not found in registry`)
      return checker.check(pkg)
    },
  })
}

function killChildWithEscalation(child: ChildProcess): void {
  child.kill('SIGTERM')
  setTimeout(() => {
    if (!child.killed) child.kill('SIGKILL')
  }, 5000)
}

type CachedSearchValue = SearchResult[] | FragmentResult[]

class SearchCache {
  private entries = new Map<string, { results: CachedSearchValue; expiresAt: number }>()

  get(key: string): CachedSearchValue | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.results
  }

  set(key: string, value: CachedSearchValue): void {
    if (value.length === 0) return
    this.entries.delete(key)
    this.entries.set(key, {
      results: value,
      expiresAt: Date.now() + 15000,
    })
    if (this.entries.size > 200) {
      const oldest = this.entries.keys().next().value
      if (oldest) this.entries.delete(oldest)
    }
  }

  clear(): void {
    this.entries.clear()
  }
}

const searchCache = new SearchCache()

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: isDevMode ? 'Spool DEV' : 'Spool',
    width: 860,
    height: 620,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141410' : '#FAFAF8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    mainWindow = null
    if (!isDevMode) app.dock?.hide()
  })

  return win
}

let activeSyncPromise: Promise<{ added: number; updated: number; errors: number }> | null = null

function runSyncWorker(): Promise<{ added: number; updated: number; errors: number }> {
  if (activeSyncPromise) return activeSyncPromise

  activeSyncPromise = new Promise<{ added: number; updated: number; errors: number }>((resolve, reject) => {
    const workerPath = join(__dirname, 'sync-worker.js')
    const worker = new Worker(workerPath)
    worker.on('message', (msg: SyncWorkerMessage) => {
      if (msg.type === 'progress') {
        isSyncActive = msg.data.phase !== 'done'
        searchCache.clear()
        mainWindow?.webContents.send('spool:sync-progress', msg.data)
      } else if (msg.type === 'done') {
        isSyncActive = false
        searchCache.clear()
        resolve(msg.result)
      } else if (msg.type === 'error') {
        isSyncActive = false
        reject(new Error(msg.error))
      }
    })
    worker.on('error', reject)
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Sync worker exited with code ${code}`))
    })
  }).finally(() => {
    activeSyncPromise = null
  })

  return activeSyncPromise
}

const VALID_NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

// Serialize async connector operations (install/update) via a promise chain.
// Prevents races where reloadConnectors() from an install could re-register
// a connector that a concurrent uninstall just removed.
let connectorOpQueue: Promise<void> = Promise.resolve()
function withConnectorLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = connectorOpQueue.then(fn, fn)
  // Swallow rejections on the queue so a failed op doesn't block subsequent ones
  connectorOpQueue = next.then(() => {}, () => {})
  return next
}

function installConnectorPackage(
  packageName: string,
): Promise<{ ok: true; name: string; version: string } | { ok: false; error: string }> {
  return withConnectorLock(async () => {
    try {
      const connectorsDir = join(spoolDir, 'connectors')
      // Dev-mode: if the package lives in this workspace, symlink it instead
      // of hitting npm. Lets us test connectors before they're published.
      const workspaceResult = !app.isPackaged
        ? installFromWorkspace(packageName, spoolDir, resolve(process.cwd(), '..', '..'))
        : null
      const result = workspaceResult ?? await downloadAndInstall(packageName, connectorsDir, fetch)

      const isFirstParty = packageName.startsWith('@spool-lab/')
      if (!isFirstParty && trustStore) {
        trustStore.add(packageName)
      }

      // Clear stale sync state from a prior install (prevents inheriting
      // old cursors/enabled flags if uninstall's DB cleanup failed)
      const pkgJsonPath = join(connectorsDir, 'node_modules', ...result.name.split('/'), 'package.json')
      try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
        const ids: string[] = Array.isArray(pkgJson.spool?.connectors)
          ? pkgJson.spool.connectors.map((c: any) => c.id).filter(Boolean)
          : pkgJson.spool?.id ? [pkgJson.spool.id] : []
        for (const cid of ids) {
          db.prepare('DELETE FROM connector_sync_state WHERE connector_id = ?').run(cid)
        }
      } catch (err) {
        console.warn('[install] failed to clear stale sync state:', err)
      }

      await reloadConnectors()

      mainWindow?.webContents.send('connector:event', {
        type: 'installed',
        name: result.name,
        version: result.version,
      })

      return { ok: true, name: result.name, version: result.version }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

function parseSpoolUrl(url: string): { action: string; packageName: string } | null {
  const match = url.match(/^spool:\/\/connector\/install\/(.+)$/)
  if (!match) return null
  const packageName = decodeURIComponent(match[1]!)
  if (!VALID_NPM_NAME.test(packageName)) return null
  return { action: 'install', packageName }
}

async function handleSpoolUrl(url: string): Promise<void> {
  const parsed = parseSpoolUrl(url)
  if (!parsed) return

  const isFirstParty = parsed.packageName.startsWith('@spool-lab/')

  // Fetch metadata from npm first — get human-readable label + latest version
  let info: Awaited<ReturnType<typeof resolveNpmPackage>>
  try {
    info = await resolveNpmPackage(parsed.packageName, fetch)
  } catch (err) {
    dialog.showMessageBox(mainWindow!, {
      type: 'error',
      message: 'Connector not found',
      detail: `Could not find "${parsed.packageName}" on npm.`,
    })
    return
  }

  if (!info.isConnector) {
    dialog.showMessageBox(mainWindow!, {
      type: 'error',
      message: 'Not a connector',
      detail: `"${parsed.packageName}" is not a Spool connector.`,
    })
    return
  }

  const displayName = info.label ?? parsed.packageName

  // Check installed version
  const { existsSync, readFileSync } = await import('node:fs')
  const nameSegments = parsed.packageName.startsWith('@') ? parsed.packageName.split('/') : [parsed.packageName]
  const installedPkgPath = join(spoolDir, 'connectors', 'node_modules', ...nameSegments, 'package.json')
  let installedVersion: string | null = null
  if (existsSync(installedPkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(installedPkgPath, 'utf8'))
      installedVersion = typeof pkg.version === 'string' ? pkg.version : null
    } catch {}
  }

  // Build dialog content
  let message: string
  let detail: string
  let actionLabel: string

  if (installedVersion && installedVersion === info.version) {
    message = `${displayName} is already up to date`
    detail = `Version ${installedVersion} is installed. Reinstall anyway?`
    actionLabel = 'Reinstall'
  } else if (installedVersion) {
    message = `Update ${displayName}?`
    detail = `${installedVersion} → ${info.version}`
    actionLabel = 'Update'
  } else {
    message = `Install ${displayName}?`
    detail = isFirstParty
      ? `Official Spool connector · v${info.version}`
      : `Community connector · v${info.version}\nThis will run third-party code on your machine.`
    actionLabel = 'Install'
  }

  const { response } = await dialog.showMessageBox(mainWindow!, {
    type: !isFirstParty && !installedVersion ? 'warning' : 'question',
    buttons: [actionLabel, 'Cancel'],
    defaultId: 1,
    title: `${actionLabel} Connector`,
    message,
    detail,
  })

  if (response !== 0) return

  mainWindow?.setProgressBar(0.5)

  const installResult = await installConnectorPackage(parsed.packageName)

  mainWindow?.setProgressBar(-1)

  if (!installResult.ok) {
    dialog.showMessageBox(mainWindow!, {
      type: 'error',
      message: `Failed to install ${displayName}`,
      detail: installResult.error,
    })
  }
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  handleSpoolUrl(url)
})

app.whenReady().then(async () => {
  // Set dock icon (dev mode doesn't pick up build config)
  const dockIconPath = join(__dirname, '../../resources/icon.icns')
  try { app.dock?.setIcon(nativeImage.createFromPath(dockIconPath)) } catch {}

  // Override the default "Electron" menu bar label on macOS
  const appMenu = Menu.buildFromTemplate([
    {
      label: 'Spool',
      submenu: [
        { role: 'about', label: 'About Spool' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Spool' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Spool' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ])
  Menu.setApplicationMenu(appMenu)

  db = getDB()
  installE2ETestHooks(db)
  acpManager = new AcpManager()
  syncer = new Syncer(db)
  watcher = new SpoolWatcher(syncer)
  watcher.on('new-sessions', (_event, data) => {
    searchCache.clear()
    mainWindow?.webContents.send('spool:new-sessions', data)
  })

  // ── Connector framework ──────────────────────────────────────────────
  connectorRegistry = new ConnectorRegistry()
  // Use Electron's net.request for proxy support with full header control.
  // net.fetch drops Cookie (forbidden header) and injects Sec-Fetch-* headers;
  // net.request gives us raw control over what goes on the wire.
  proxyFetch = (input, init) => {
    const url = input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url
    const hdrs = (init?.headers ?? {}) as Record<string, string>
    return new Promise((resolve, reject) => {
      const req = net.request({ url, method: init?.method ?? 'GET' })
      for (const [key, value] of Object.entries(hdrs)) {
        req.setHeader(key, value)
      }

      req.on('response', (resp) => {
        const chunks: Buffer[] = []
        resp.on('data', (chunk: Buffer) => chunks.push(chunk))
        resp.on('end', () => {
          const body = Buffer.concat(chunks)
          resolve(new Response(body, {
            status: resp.statusCode,
            statusText: resp.statusMessage,
            headers: resp.headers as Record<string, string>,
          }))
        })
      })
      req.on('error', (err) => {
        reject(err)
      })
      req.end()
    })
  }

  spoolDir = join(homedir(), '.spool')
  trustStore = new TrustStore(spoolDir)

  execCapabilityImpl = makeExecCapability()
  prerequisiteChecker = new PrerequisiteChecker(execCapabilityImpl)

  if (!app.isPackaged) {
    linkDevConnectors(spoolDir, resolve(process.cwd(), '../..'))
  }

  await loadConnectors({
    connectorsDir: join(spoolDir, 'connectors'),
    capabilityImpls: {
      fetch: makeFetchCapability(proxyFetch),
      cookies: makeChromeCookiesCapability(),
      sqlite: makeSqliteCapability(),
      exec: execCapabilityImpl,
      logFor: (connectorId: string) => makeLogCapabilityFor(connectorId),
      prerequisitesFor: makePrerequisitesFor(connectorRegistry, prerequisiteChecker),
    },
    registry: connectorRegistry,
    log: {
      info: (msg, fields) => console.log(`[loader] ${msg}`, fields ?? ''),
      warn: (msg, fields) => console.warn(`[loader] ${msg}`, fields ?? ''),
      error: (msg, fields) => console.error(`[loader] ${msg}`, fields ?? ''),
    },
    trustStore,
  })

  syncScheduler = new SyncScheduler(db, connectorRegistry)
  syncScheduler.on((event: SchedulerEvent) => {
    mainWindow?.webContents.send('connector:event', event)
  })
  syncScheduler.start()

  // Wake from sleep: reschedule a forward pass immediately instead of waiting
  // up to 30s for the next periodic tick.
  powerMonitor.on('resume', () => {
    syncScheduler?.onWake()
  })

  // Check for connector updates (async, non-blocking)
  runConnectorUpdateCheck().catch((err) => {
    console.error('[connector-updates] check failed:', err)
  })

  // Initial sync in worker thread (non-blocking)
  runSyncWorker().then(() => {
    watcher.start()
  }).catch((err) => {
    console.error('[sync-worker] failed:', err)
  })

  mainWindow = createWindow()

  mainWindow.on('focus', () => {
    // Always re-check on focus, including for packages that are currently
    // all-ok — extensions can be removed and CLIs uninstalled without our
    // knowledge, and skipping the recheck would leave stale green status
    // until the user manually clicks Re-check.
    for (const pkg of connectorRegistry.listPackages()) {
      const before = prerequisiteChecker.getCached(pkg.id)
      prerequisiteChecker.check(pkg).then((after) => {
        const changed = !before || before.length !== after.length ||
          before.some((s, i) => s.status !== after[i]?.status)
        if (changed) {
          mainWindow?.webContents.send('connector:status-changed', { packageId: pkg.id })
        }
      }).catch(() => undefined)
    }
  })

  // Auto-updater (only runs in packaged builds)
  setupAutoUpdater(() => mainWindow)


  function showOrCreateWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
    } else {
      mainWindow = createWindow()
    }
    app.dock?.show()
  }
  focusExistingWindow = showOrCreateWindow

  if (!isDevMode) {
    setupTray(showOrCreateWindow, () => {
      runSyncWorker()
    })
  }

  app.on('activate', showOrCreateWindow)
})

app.on('window-all-closed', () => {
  if (isDevMode) {
    app.quit()
    return
  }
  // On macOS, keep app running in tray
  app.dock?.hide()
})

// Graceful shutdown: cancel in-flight syncs cooperatively so the engine can
// record stopReason='cancelled' and partial progress before the runtime tears
// down. Without this the tick fiber and runJob fibers are abandoned at process
// death and state updates for the current cycle are lost.
app.on('before-quit', () => {
  syncScheduler?.stop()
})

// ── Connector helpers ─────────────────────────────────────────────────────────

function tryRun(fn: () => void, label: string, fallback?: () => void): void {
  try { fn() } catch (err) {
    if (fallback) try { fallback() } catch (err2) { console.warn(`[uninstall] fallback also failed for ${label}:`, err2) }
    console.error(`[uninstall] failed to delete ${label}:`, err)
  }
}

interface InstalledConnectorInfo { packageName: string; currentVersion: string; connectorId: string; platform: string }

function getInstalledConnectorPackages(): InstalledConnectorInfo[] {
  const connectorsDir = join(spoolDir, 'connectors')
  const nodeModules = join(connectorsDir, 'node_modules')
  if (!existsSync(nodeModules)) return []

  const results: InstalledConnectorInfo[] = []
  for (const entry of readdirSync(nodeModules)) {
    if (entry.startsWith('.')) continue
    const dirs = entry.startsWith('@')
      ? readdirSync(join(nodeModules, entry)).map(s => join(entry, s))
      : [entry]
    for (const dir of dirs) {
      const pkgPath = join(nodeModules, dir, 'package.json')
      if (!existsSync(pkgPath)) continue
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        if (pkg.spool?.type !== 'connector') continue
        if (Array.isArray(pkg.spool.connectors)) {
          for (const c of pkg.spool.connectors) {
            if (c.id) {
              results.push({ packageName: pkg.name, currentVersion: pkg.version ?? '0.0.0', connectorId: c.id, platform: c.platform ?? '' })
            }
          }
        } else if (pkg.spool.id) {
          results.push({ packageName: pkg.name, currentVersion: pkg.version ?? '0.0.0', connectorId: pkg.spool.id, platform: pkg.spool.platform ?? '' })
        }
      } catch {}
    }
  }
  return results
}

async function reloadConnectors(): Promise<void> {
  const connectorsDir = join(spoolDir, 'connectors')
  await loadConnectors({
    connectorsDir,
    capabilityImpls: {
      fetch: makeFetchCapability(proxyFetch),
      cookies: makeChromeCookiesCapability(),
      sqlite: makeSqliteCapability(),
      exec: execCapabilityImpl,
      logFor: (id: string) => makeLogCapabilityFor(id),
      prerequisitesFor: makePrerequisitesFor(connectorRegistry, prerequisiteChecker),
    },
    registry: connectorRegistry,
    log: {
      info: (msg, fields) => console.log(`[loader] ${msg}`, fields ?? ''),
      warn: (msg, fields) => console.warn(`[loader] ${msg}`, fields ?? ''),
      error: (msg, fields) => console.error(`[loader] ${msg}`, fields ?? ''),
    },
    trustStore: trustStore!,
  })
}

async function runConnectorUpdateCheck(): Promise<{ updates: Map<string, UpdateInfo>; installed: Array<{ packageName: string; currentVersion: string; connectorId: string }> }> {
  const installed = getInstalledConnectorPackages()
  if (installed.length === 0) return { updates: new Map(), installed }
  updateCache = await checkForUpdates(installed, fetch)
  return { updates: updateCache, installed }
}

function pkgIdForConnector(connectorId: string): string | undefined {
  for (const pkg of connectorRegistry.listPackages()) {
    if (pkg.connectors.some(c => c.id === connectorId)) return pkg.id
  }
  return undefined
}

type ResolvedCli =
  | { ok: true; pkg: ReturnType<ConnectorRegistry['getPackage']> & {}; command: string }
  | { ok: false; reason: 'package-not-found' | 'not-cli-prereq' | 'no-command-for-platform' | 'requires-manual' }

function stepsDiffer(a: import('@spool/core').SetupStep[] | undefined, b: import('@spool/core').SetupStep[]): boolean {
  if (!a || a.length !== b.length) return true
  return a.some((s, i) => s.status !== b[i]?.status)
}

function resolveCliPrereq(packageId: string, prereqId: string): ResolvedCli {
  const pkg = connectorRegistry.getPackage(packageId)
  if (!pkg) return { ok: false, reason: 'package-not-found' }
  const p = (pkg.prerequisites ?? []).find(x => x.id === prereqId)
  if (!p || p.install.kind !== 'cli') return { ok: false, reason: 'not-cli-prereq' }
  const command = p.install.command[process.platform as 'darwin' | 'linux' | 'win32']
  if (!command) return { ok: false, reason: 'no-command-for-platform' }
  if (p.install.requiresManual || /\bsudo\b/.test(command)) return { ok: false, reason: 'requires-manual' }
  return { ok: true, pkg, command }
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('spool:search', (_e, { query, limit = 10, source }: { query: string; limit?: number; source?: string }) => {
  const cacheKey = `${source ?? 'all'}|${limit}|${query}`
  if (!isSyncActive) {
    const cached = searchCache.get(cacheKey)
    if (cached) return cached
  }

  const results = source === 'claude' || source === 'codex' || source === 'gemini'
    ? searchFragments(db, query, { limit, source })
    : searchAll(db, query, { limit })

  if (!isSyncActive) {
    searchCache.set(cacheKey, results)
  }

  return results
})

ipcMain.handle('spool:search-preview', (_e, { query, limit = 5, source }: { query: string; limit?: number; source?: string }) => {
  const cacheKey = `preview|${source ?? 'all'}|${limit}|${query}`
  const cached = searchCache.get(cacheKey)
  if (cached) return cached

  // Session-scoped preview stays sessions-only.
  if (source === 'claude' || source === 'codex' || source === 'gemini') {
    const fragments = searchSessionPreview(db, query, { limit, source })
      .map(f => ({ ...f, kind: 'fragment' as const }))
    searchCache.set(cacheKey, fragments)
    return fragments
  }

  // Unfiltered preview: fragments first (historical behavior), captures fill
  // any remaining slots. Captures now appear when a query matches only
  // connector content (e.g. a Reddit post).
  const fragments = searchSessionPreview(db, query, { limit })
    .map(f => ({ ...f, kind: 'fragment' as const }))
  const capLimit = Math.max(0, limit - fragments.length)
  const captures = capLimit > 0
    ? searchCaptures(db, query, { limit: capLimit }).map(c => ({ ...c, kind: 'capture' as const }))
    : []
  const results = [...fragments, ...captures]

  searchCache.set(cacheKey, results)
  return results
})

ipcMain.handle('spool:list-sessions', (_e, { limit = 50 }: { limit?: number } = {}) => {
  return listRecentSessions(db, limit)
})

ipcMain.handle('spool:get-session', (_e, { sessionUuid }: { sessionUuid: string }) => {
  return getSessionWithMessages(db, sessionUuid)
})

ipcMain.handle('spool:get-status', () => {
  return getStatus(db)
})

ipcMain.handle('spool:get-runtime-info', () => {
  return {
    isDev: isDevMode,
    appPath: app.getAppPath(),
    appName: app.getName(),
  }
})

ipcMain.handle('spool:sync-now', () => {
  return runSyncWorker()
})

ipcMain.handle('spool:resume-cli', (_e, { sessionUuid, source, cwd }: { sessionUuid: string; source: string; cwd?: string }) => {
  try {
    const command = getSessionResumeCommand(source, sessionUuid)
    if (!command) {
      return { ok: false, error: `Session source "${source}" cannot be resumed from the CLI.` }
    }
    const session = getSessionWithMessages(db, sessionUuid)?.session
    const resumeCwd = session
      ? resolveResumeWorkingDirectory(session)
      : resolveResumeWorkingDirectory({
          source: source as SessionSource,
          cwd: cwd ?? null,
          projectDisplayPath: '',
          filePath: '',
        })
    const terminal = acpManager.getAgentsConfig().terminal
    openTerminal(command, terminal, resumeCwd)
    return { ok: true }
  } catch (err) {
    console.error('[spool:resume-cli]', err)
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('spool:copy-fragment', (_e, { text }: { text: string }) => {
  const { clipboard } = require('electron')
  clipboard.writeText(text)
  return { ok: true }
})

ipcMain.handle('spool:get-theme', () => {
  return nativeTheme.themeSource
})

ipcMain.handle('spool:set-theme', (_e, { theme }: { theme: 'system' | 'light' | 'dark' }) => {
  uiPreferences.themeSource = theme
  nativeTheme.themeSource = theme
  saveThemeSource(theme)
  return { ok: true }
})

ipcMain.handle('spool:get-theme-editor-state', () => {
  return uiPreferences.themeEditor
})

ipcMain.handle('spool:set-theme-editor-state', (_e, { state }: { state: import('../renderer/theme/editorTypes.js').ThemeEditorStateV1 }) => {
  uiPreferences.themeEditor = state
  saveThemeEditor(state)
  return { ok: true }
})

// ── AI / ACP Handlers ────────────────────────────────────────────────────────

ipcMain.handle('spool:ai-agents', () => {
  return acpManager.detectAgents()
})

ipcMain.handle('spool:ai-builtin-agents', () => {
  return acpManager.getBuiltinAgents()
})

ipcMain.handle('spool:ai-get-config', () => {
  return acpManager.getAgentsConfig()
})

ipcMain.handle('spool:ai-set-config', (_e, { config }: { config: import('./acp.js').AgentsConfig }) => {
  acpManager.saveAgentsConfig(config)
  return { ok: true }
})

ipcMain.handle('spool:ai-search', async (_e, { query, agentId, context }: { query: string; agentId: string; context: import('@spool/core').FragmentResult[] }) => {
  try {
    const fullText = await acpManager.query(agentId, query, context, (text) => {
      mainWindow?.webContents.send('spool:ai-chunk', { text })
    }, (toolCall) => {
      mainWindow?.webContents.send('spool:ai-tool-call', toolCall)
    })
    mainWindow?.webContents.send('spool:ai-done', { fullText })
    return { ok: true, fullText }
  } catch (err) {
    const error = err instanceof Error ? err.message : (typeof err === 'object' && err !== null && 'message' in err) ? String((err as any).message) : String(err)
    console.error('[spool:ai-search] Agent query failed:', error)
    if (err instanceof Error && err.stack) console.error(err.stack)
    mainWindow?.webContents.send('spool:ai-done', { fullText: '', error })
    return { ok: false, error }
  }
})

ipcMain.handle('spool:ai-cancel', () => {
  acpManager.cancel()
  return { ok: true }
})

// ── Auto-update ──────────────────────────────────────────────────────────

ipcMain.handle('spool:download-update', () => {
  downloadUpdate()
})

ipcMain.handle('spool:install-update', () => {
  quitAndInstall()
})

// ── Connector Handlers ──────────────────────────────────────────────────

ipcMain.handle('connector:list', (): ConnectorStatus[] => {
  const installed = getInstalledConnectorPackages()
  const versionMap = new Map(installed.map(p => [p.connectorId, p.currentVersion]))
  const pkgNameMap = new Map(installed.map(p => [p.connectorId, p.packageName]))
  const connIdToPackageId = new Map<string, string>()
  for (const pkg of connectorRegistry.listPackages()) {
    for (const c of pkg.connectors) {
      connIdToPackageId.set(c.id, pkg.id)
    }
  }
  const result = syncScheduler.getStatus().connectors.map(c => {
    const pkgId = connIdToPackageId.get(c.id)
    const pkg = pkgId ? connectorRegistry.getPackage(pkgId) : undefined
    const cached = pkgId ? prerequisiteChecker?.getCached(pkgId) : undefined
    const status: ConnectorStatus = {
      ...c,
      version: versionMap.get(c.id) ?? '0.0.0',
      packageName: pkgNameMap.get(c.id) ?? '',
    }
    if (pkgId !== undefined) status.packageId = pkgId
    // Always send a setup array when the package declares prerequisites, so
    // the UI can render the prereq card immediately. If we haven't checked
    // yet, fill with pending steps from the manifest so the user sees the
    // structure right away rather than nothing-then-flash.
    if (cached !== undefined) {
      status.setup = cached
    } else if (pkg?.prerequisites && pkg.prerequisites.length > 0) {
      status.setup = pkg.prerequisites.map(p => ({
        id: p.id,
        label: p.name,
        kind: p.kind,
        status: 'pending' as const,
        ...(p.minVersion !== undefined ? { minVersion: p.minVersion } : {}),
        ...(p.install ? { install: p.install } : {}),
        ...(p.docsUrl ? { docsUrl: p.docsUrl } : {}),
      }))
    }
    return status
  })
  // Kick off background prereq checks for packages not yet cached so the
  // Setup card appears on first load without needing a focus event.
  for (const pkg of connectorRegistry.listPackages()) {
    if (pkg.prerequisites && pkg.prerequisites.length > 0 && !prerequisiteChecker.getCached(pkg.id)) {
      prerequisiteChecker.check(pkg).then(() => {
        mainWindow?.webContents.send('connector:status-changed', { packageId: pkg.id })
      }).catch(() => undefined)
    }
  }
  return result
})

ipcMain.handle('connector:check-auth', async (_e, { id }: { id: string }): Promise<AuthStatus> => {
  const connector = connectorRegistry.get(id)
  return connector.checkAuth()
})

ipcMain.handle('connector:sync-now', (_e, { id }: { id: string }) => {
  syncScheduler.triggerNow(id, 'both')
  return { ok: true }
})

ipcMain.handle('connector:get-status', () => {
  return syncScheduler.getStatus()
})

ipcMain.handle('connector:set-enabled', (_e, { id, enabled }: { id: string; enabled: boolean }) => {
  const state = loadSyncState(db, id)
  saveSyncState(db, { ...state, enabled })
  if (enabled) {
    syncScheduler.triggerNow(id, 'both')
  }
  return { ok: true }
})

ipcMain.handle('connector:uninstall', (_e, { id }: { id: string }) => {
  const connectorsDir = join(spoolDir, 'connectors')

  const allInstalled = getInstalledConnectorPackages()
  const pkg = allInstalled.find(p => p.connectorId === id)
  if (!pkg) {
    return { ok: false, error: `No installed package found for connector "${id}"` }
  }
  const packageName = pkg.packageName
  const siblings = allInstalled.filter(p => p.packageName === packageName)

  // Resolve registry package id before removing from registry
  const registryPkgId = pkgIdForConnector(id)

  // Registry + scheduler first: prevents the scheduler tick from re-queuing
  // syncs, and lets in-flight syncs wind down via the cancel signal.
  for (const sib of siblings) {
    connectorRegistry.remove(sib.connectorId)
    syncScheduler.cancelIfRunning(sib.connectorId)
  }

  uninstallConnector(packageName, connectorsDir)

  // Best-effort DB cleanup — captures_fts_delete trigger can fail on corrupted FTS rows
  for (const sib of siblings) {
    tryRun(() => db.prepare('DELETE FROM connector_sync_state WHERE connector_id = ?').run(sib.connectorId), `sync state for ${sib.connectorId}`)
    tryRun(
      () => {
        db.prepare('DELETE FROM capture_connectors WHERE connector_id = ?').run(sib.connectorId)
        db.prepare(`
          DELETE FROM captures
          WHERE source_id = (SELECT id FROM sources WHERE name = 'connector')
            AND NOT EXISTS (SELECT 1 FROM capture_connectors WHERE capture_id = captures.id)
        `).run()
      },
      `captures for ${sib.connectorId}`,
    )
  }

  if (registryPkgId) prerequisiteChecker.invalidate(registryPkgId)

  const removedIds = siblings.map(s => s.connectorId)
  mainWindow?.webContents.send('connector:event', {
    type: 'uninstalled',
    connectorId: id,
    packageName,
    removedIds,
  })

  return { ok: true }
})

ipcMain.handle('connector:check-updates', async () => {
  const { updates, installed } = await runConnectorUpdateCheck()
  const byConnectorId: Record<string, { current: string; latest: string }> = {}
  for (const pkg of installed) {
    const update = updates.get(pkg.packageName)
    if (update) byConnectorId[pkg.connectorId] = update
  }
  return byConnectorId
})

ipcMain.handle('connector:update', async (_e, { id }: { id: string }) => {
  return withConnectorLock(async () => {
    const installed = getInstalledConnectorPackages()
    const pkg = installed.find(p => p.connectorId === id)
    if (!pkg) return { ok: false, error: `No installed package found for connector "${id}"` }

    try {
      const connectorsDir = join(spoolDir, 'connectors')
      const result = await downloadAndInstall(pkg.packageName, connectorsDir, fetch)

      await reloadConnectors()
      updateCache.delete(pkg.packageName)

      mainWindow?.webContents.send('connector:event', {
        type: 'updated',
        name: result.name,
        version: result.version,
      })

      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
})

ipcMain.handle('connector:get-capture-count', (_e, { connectorId }: { connectorId: string }) => {
  connectorRegistry.get(connectorId)
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM capture_connectors WHERE connector_id = ?',
  ).get(connectorId) as { cnt: number }
  return row.cnt
})

ipcMain.handle('connector:fetch-registry', async () => {
  // Dev-mode override: read registry.json from the workspace so local edits
  // show up without pushing to GitHub main. Set SPOOL_REGISTRY_URL to a file://
  // URL, absolute path, or HTTP URL to override explicitly.
  const override = process.env.SPOOL_REGISTRY_URL
    ?? (!app.isPackaged ? join(process.cwd(), '../landing/public/registry.json') : undefined)
  return fetchRegistry({
    fetchFn: (input, init) => net.fetch(input as any, init),
    cacheDir: spoolDir,
    ...(override !== undefined && { url: override }),
  })
})

ipcMain.handle('connector:install', async (_e, { packageName }: { packageName: string }) => {
  return installConnectorPackage(packageName)
})

ipcMain.handle('connector:recheck-prerequisites', async (_e, { packageId }: { packageId: string }) => {
  const pkg = connectorRegistry.getPackage(packageId)
  if (!pkg) return { ok: false, error: 'PACKAGE_NOT_FOUND' }
  const before = prerequisiteChecker.getCached(packageId)
  prerequisiteChecker.invalidate(packageId)
  const setup = await prerequisiteChecker.check(pkg)
  if (stepsDiffer(before, setup)) {
    mainWindow?.webContents.send('connector:status-changed', { packageId })
  }
  return { ok: true, setup }
})

type InstallResult =
  | { ok: true; installId: string; exitCode: number }
  | { ok: false; reason: 'requires-manual' }
  | { ok: false; reason: 'package-not-found' }
  | { ok: false; reason: 'not-cli-prereq' }
  | { ok: false; reason: 'no-command-for-platform' }
  | { ok: false; reason: 'install-failed'; exitCode: number; errorMessage: string }

ipcMain.handle('connector:install-cli', async (_e, { packageId, prereqId, installId: providedInstallId }: { packageId: string; prereqId: string; installId?: string }) => {
  const resolved = resolveCliPrereq(packageId, prereqId)
  if (!resolved.ok) return { ok: false, reason: resolved.reason } satisfies InstallResult

  const { pkg, command } = resolved
  const installId = providedInstallId ?? `${packageId}::${prereqId}::${Date.now()}`
  const isWin = process.platform === 'win32'
  const shellBin = isWin ? (process.env['ComSpec'] || 'cmd.exe') : (process.env['SHELL'] || '/bin/bash')
  const args = isWin ? ['/c', command] : ['-lc', command]

  // SECURITY: runs with user's shell/env; trust anchor is registry.json allowlist.
  return new Promise<InstallResult>((resolvePromise) => {
    const child = spawn(shellBin, args, { env: process.env })
    runningInstalls.set(installId, child)
    const timer = setTimeout(() => killChildWithEscalation(child), 120_000)
    let stderrTail = ''
    child.stdout?.on('data', () => { /* discard */ })
    child.stderr?.on('data', (d: Buffer) => { stderrTail = (stderrTail + d.toString()).slice(-4096) })
    child.on('exit', async (code) => {
      clearTimeout(timer)
      runningInstalls.delete(installId)
      const ok = code === 0
      if (ok) {
        const before = prerequisiteChecker.getCached(packageId)
        prerequisiteChecker.invalidate(packageId)
        const after = await prerequisiteChecker.check(pkg).catch(() => undefined)
        if (after && stepsDiffer(before, after)) {
          mainWindow?.webContents.send('connector:status-changed', { packageId })
        }
        resolvePromise({ ok: true, installId, exitCode: code ?? 0 })
      } else {
        const errorMessage = stderrTail.trim().split('\n').slice(-3).join('\n')
        resolvePromise({ ok: false, reason: 'install-failed', exitCode: code ?? -1, errorMessage })
      }
    })
  })
})

ipcMain.handle('connector:install-cli-cancel', async (_e, { installId }: { installId: string }) => {
  const child = runningInstalls.get(installId)
  if (child) {
    killChildWithEscalation(child)
    return { ok: true }
  }
  return { ok: false, error: 'NOT_FOUND' }
})

ipcMain.handle('connector:copy-install-command', async (_e, { packageId, prereqId }: { packageId: string; prereqId: string }) => {
  const resolved = resolveCliPrereq(packageId, prereqId)
  if (!resolved.ok) return { ok: false, reason: resolved.reason }
  clipboard.writeText(resolved.command)
  return { ok: true, command: resolved.command }
})

ipcMain.handle('connector:open-external', async (_e, { url }: { url: string }) => {
  await shell.openExternal(url)
  return { ok: true }
})

// ── E2E test hooks ──────────────────────────────────────────────────────────
// Only active when SPOOL_E2E_TEST=1. Exposes a small seeding surface on
// globalThis so Playwright's app.evaluate() can insert fixture rows using
// the app's already-loaded, electron-ABI better-sqlite3 (the test process
// itself can't import better-sqlite3 without ABI mismatches, and the
// system `sqlite3` CLI on macOS runners lacks FTS5, which breaks the
// captures_fts triggers).
function installE2ETestHooks(sharedDb: Database.Database): void {
  if (process.env['SPOOL_E2E_TEST'] !== '1') return
  const g = globalThis as unknown as Record<string, unknown>
  g['__spoolSeedCapture'] = (args: {
    platform: string
    platformId: string
    title: string
    url: string
    content?: string
    connectorId: string
    author?: string
    captureUuid: string
  }): void => {
    const source = sharedDb.prepare("SELECT id FROM sources WHERE name = 'connector'").get() as
      | { id: number }
      | undefined
    if (!source) throw new Error("'connector' source row missing")

    const info = sharedDb.prepare(`
      INSERT INTO captures
        (source_id, capture_uuid, url, title, content_text, author,
         platform, platform_id, content_type, thumbnail_url, metadata,
         captured_at, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'post', NULL, '{}',
              datetime('now'), NULL)
    `).run(
      source.id, args.captureUuid, args.url, args.title,
      args.content ?? args.title, args.author ?? null,
      args.platform, args.platformId,
    )
    sharedDb.prepare(
      'INSERT OR IGNORE INTO capture_connectors (capture_id, connector_id) VALUES (?, ?)',
    ).run(info.lastInsertRowid, args.connectorId)
  }
}
