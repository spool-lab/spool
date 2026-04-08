import { app, BrowserWindow, ipcMain, Menu, nativeTheme, nativeImage } from 'electron'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import {
  getDB, Syncer, SpoolWatcher,
  searchFragments, searchAll, listRecentSessions, getSessionWithMessages, getStatus,
  ConnectorRegistry, SyncScheduler, TwitterBookmarksConnector,
  loadSyncState, saveSyncState,
} from '@spool/core'
import type { ConnectorStatus, AuthStatus } from '@spool/core'
import { setupTray } from './tray.js'
import { AcpManager } from './acp.js'
import { setupAutoUpdater, downloadUpdate, quitAndInstall } from './updater.js'
import { openTerminal } from './terminal.js'
import { getSessionResumeCommand } from '../shared/resumeCommand.js'
import { resolveResumeWorkingDirectory } from './sessionResume.js'
import type Database from 'better-sqlite3'
import type { SyncWorkerMessage } from './sync-worker.js'

// macOS menu bar shows the first menu's label as the app name
app.setName('Spool')

let mainWindow: BrowserWindow | null = null
let db: Database.Database
let syncer: Syncer
let watcher: SpoolWatcher
let acpManager: AcpManager
let connectorRegistry: ConnectorRegistry
let syncScheduler: SyncScheduler

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
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
    app.dock?.hide()
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
        mainWindow?.webContents.send('spool:sync-progress', msg.data)
      } else if (msg.type === 'done') {
        resolve(msg.result)
      } else if (msg.type === 'error') {
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
  syncer = new Syncer(db)
  watcher = new SpoolWatcher(syncer)
  watcher.on('new-sessions', (_event, data) => {
    mainWindow?.webContents.send('spool:new-sessions', data)
  })

  // ── Connector framework ──────────────────────────────────────────────
  connectorRegistry = new ConnectorRegistry()
  connectorRegistry.register(new TwitterBookmarksConnector())

  syncScheduler = new SyncScheduler(db, connectorRegistry)
  syncScheduler.on((event) => {
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

  setupTray(showOrCreateWindow, () => {
    runSyncWorker()
  })

  app.on('activate', showOrCreateWindow)
})

app.on('window-all-closed', (e) => {
  // On macOS, keep app running in tray
  e.preventDefault()
  app.dock?.hide()
})

// ── IPC Handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('spool:search', (_e, { query, limit = 10, source }: { query: string; limit?: number; source?: string }) => {
  if (source === 'claude' || source === 'codex') {
    return searchFragments(db, query, { limit, source })
  }
  return searchAll(db, query, { limit })
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
          source: source as 'claude' | 'codex',
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
