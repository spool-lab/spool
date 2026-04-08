import { app, BrowserWindow, ipcMain, Menu, nativeTheme, nativeImage, globalShortcut } from 'electron'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import {
  getDB, Syncer, SpoolWatcher,
  searchFragments, searchAll, searchSessionPreview, listRecentSessions, getSessionWithMessages, getStatus,
  OpenCLIManager,
  getOpenCLISourceId, listOpenCLISources, addOpenCLISource, removeOpenCLISource, getCaptureCount,
  getSetupValue, setSetupValue,
  ConnectorRegistry, SyncScheduler, TwitterBookmarksConnector,
  loadSyncState, saveSyncState,
} from '@spool/core'
import type { AuthStatus, ConnectorStatus, FragmentResult, SchedulerEvent, SearchResult, SessionSource } from '@spool/core'
import { setupTray } from './tray.js'
import { AcpManager } from './acp.js'
import { setupAutoUpdater, downloadUpdate, quitAndInstall } from './updater.js'
import { openTerminal } from './terminal.js'
import { getSessionResumeCommand } from '../shared/resumeCommand.js'
import { resolveResumeWorkingDirectory } from './sessionResume.js'
import type Database from 'better-sqlite3'
import type { SyncWorkerMessage } from './sync-worker.js'

const isDevMode = Boolean(process.env['ELECTRON_RENDERER_URL'])
const customUserDataDir = process.env['SPOOL_ELECTRON_USER_DATA_DIR']?.trim()
if (customUserDataDir) {
  app.setPath('userData', customUserDataDir)
}
// macOS menu bar shows the first menu's label as the app name
app.setName(isDevMode ? 'Spool DEV' : 'Spool')
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
let opencliManager: OpenCLIManager
let connectorRegistry: ConnectorRegistry
let syncScheduler: SyncScheduler
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

app.whenReady().then(() => {
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
  opencliManager = new OpenCLIManager(db, (e) => {
    mainWindow?.webContents.send('opencli:capture-progress', e)
  })
  syncer = new Syncer(db)
  watcher = new SpoolWatcher(syncer)
  watcher.on('new-sessions', (_event, data) => {
    searchCache.clear()
    mainWindow?.webContents.send('spool:new-sessions', data)
  })

  // ── Connector framework ──────────────────────────────────────────────
  connectorRegistry = new ConnectorRegistry()
  connectorRegistry.register(new TwitterBookmarksConnector())

  syncScheduler = new SyncScheduler(db, connectorRegistry)
  syncScheduler.on((event: SchedulerEvent) => {
    mainWindow?.webContents.send('connector:event', event)
  })
  syncScheduler.start()

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

  // Register ⌘K shortcut for Capture URL modal
  app.on('browser-window-focus', () => {
    globalShortcut.register('CommandOrControl+K', () => {
      mainWindow?.webContents.send('spool:open-capture-modal')
    })
  })
  app.on('browser-window-blur', () => {
    globalShortcut.unregister('CommandOrControl+K')
  })

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
  nativeTheme.themeSource = theme
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

// ── OpenCLI Handlers ──────────────────────────────────────────────────────

ipcMain.handle('opencli:check-setup', async () => {
  return opencliManager.checkSetup()
})

ipcMain.handle('opencli:install-cli', async () => {
  return opencliManager.installCli()
})

ipcMain.handle('opencli:available-platforms', async () => {
  return opencliManager.listAvailablePlatforms()
})

ipcMain.handle('opencli:add-source', (_e, { platform, command }: { platform: string; command: string }) => {
  const sourceId = getOpenCLISourceId(db)
  const id = addOpenCLISource(db, sourceId, platform, command)
  return { ok: true, id }
})

ipcMain.handle('opencli:remove-source', (_e, { id }: { id: number }) => {
  removeOpenCLISource(db, id)
  return { ok: true }
})

ipcMain.handle('opencli:list-sources', () => {
  return listOpenCLISources(db)
})

ipcMain.handle('opencli:sync-source', async (_e, { id, platform, command }: { id: number; platform: string; command: string }) => {
  try {
    const result = await opencliManager.syncSource(id, platform, command)
    return { ok: true, count: result.added }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('opencli:sync-all-sources', async () => {
  const sources = listOpenCLISources(db)
  let totalAdded = 0
  const errors: string[] = []

  for (const src of sources) {
    if (!src.enabled) continue
    try {
      const result = await opencliManager.syncSource(src.id, src.platform, src.command)
      totalAdded += result.added
    } catch (err) {
      errors.push(`${src.platform}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { ok: errors.length === 0, count: totalAdded, errors }
})

ipcMain.handle('opencli:capture-url', async (_e, { url }: { url: string }) => {
  try {
    const item = await opencliManager.captureUrl(url)
    return { ok: true, capture: item }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('opencli:get-capture-count', (_e, { platform }: { platform?: string } = {}) => {
  return getCaptureCount(db, platform)
})

ipcMain.handle('opencli:get-setup-value', (_e, { key }: { key: string }) => {
  return getSetupValue(db, key)
})

ipcMain.handle('opencli:set-setup-value', (_e, { key, value }: { key: string; value: string }) => {
  setSetupValue(db, key, value)
  return { ok: true }
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
