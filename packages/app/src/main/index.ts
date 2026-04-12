import { app, BrowserWindow, ipcMain, Menu, nativeTheme, nativeImage, net, powerMonitor } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { Worker } from 'node:worker_threads'
import {
  getDB, Syncer, SpoolWatcher,
  searchFragments, searchAll, searchSessionPreview, listRecentSessions, getSessionWithMessages, getStatus,
  ConnectorRegistry, SyncScheduler,
  loadSyncState, saveSyncState,
  loadConnectors, makeFetchCapability, makeChromeCookiesCapability, makeLogCapabilityFor,
  TrustStore,
} from '@spool/core'
import type { AuthStatus, ConnectorStatus, FragmentResult, SchedulerEvent, SearchResult, SessionSource } from '@spool/core'
import { setupTray } from './tray.js'
import { AcpManager } from './acp.js'
import { setupAutoUpdater, downloadUpdate, quitAndInstall } from './updater.js'
import { openTerminal } from './terminal.js'
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
const uiPreferences = loadUIPreferences()
nativeTheme.themeSource = uiPreferences.themeSource
let focusExistingWindow = () => {}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

app.on('second-instance', () => {
  focusExistingWindow()
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
  const proxyFetch: typeof globalThis.fetch = (input, init) => {
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

  const isDev = !app.isPackaged
  const bundledConnectorsDir = isDev
    ? join(process.cwd(), 'dist/bundled-connectors')
    : join(process.resourcesPath, 'bundled-connectors')

  const spoolDir = join(homedir(), '.spool')
  trustStore = new TrustStore(spoolDir)

  await loadConnectors({
    bundledConnectorsDir,
    connectorsDir: join(spoolDir, 'connectors'),
    capabilityImpls: {
      fetch: makeFetchCapability(proxyFetch),
      cookies: makeChromeCookiesCapability(),
      logFor: (connectorId: string) => makeLogCapabilityFor(connectorId),
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

  // Initial sync in worker thread (non-blocking)
  runSyncWorker().then(() => {
    watcher.start()
  }).catch((err) => {
    console.error('[sync-worker] failed:', err)
  })

  mainWindow = createWindow()

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

  const results = source === 'claude' || source === 'codex' || source === 'gemini'
    ? searchSessionPreview(db, query, { limit, source })
    : searchSessionPreview(db, query, { limit })

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
  return syncScheduler.getStatus().connectors
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

ipcMain.handle('connector:get-capture-count', (_e, { connectorId }: { connectorId: string }) => {
  const connector = connectorRegistry.get(connectorId)
  const row = db.prepare(
    "SELECT COUNT(*) as cnt FROM captures WHERE platform = ? AND json_extract(metadata, '$.connectorId') = ?",
  ).get(connector.platform, connectorId) as { cnt: number }
  return row.cnt
})
