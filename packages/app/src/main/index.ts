import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import {
  getDB, wasNewDb, getInitialUserVersion, Syncer, SpoolWatcher,
  searchFragments, searchSessionPreview, listRecentSessions, getSessionWithMessages, getStatus,
  pinSession, unpinSession, getPinnedUuids, listPinnedSessions,
  listProjectGroups, listSessionsByIdentity, listPinnedSessionsByIdentity,
} from '@spool-lab/core'
import type { FragmentResult, SessionSource, ListSessionsByIdentityOptions } from '@spool-lab/core'
import { setupTray } from './tray.js'
import { AcpManager } from './acp.js'
import { setupAutoUpdater, downloadUpdate, quitAndInstall } from './updater.js'
import { openTerminal } from './terminal.js'
import { getSessionResumeCommand } from '../shared/resumeCommand.js'
import { resolveResumeWorkingDirectory } from './sessionResume.js'
import { loadUIPreferences, saveThemeEditor, saveThemeSource, saveSpoolDaemonNoticeShown } from './uiPreferences.js'
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
let isSyncActive = false

type CachedSearchValue = FragmentResult[]

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
    width: 1180,
    height: 780,
    minWidth: 800,
    minHeight: 520,
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
  watcher.on('error', (_event, data) => {
    console.error('[watcher]', data.error, data.root ? `(root=${data.root})` : '')
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
}).catch((err) => {
  // Without this catch, any rejection from the startup sequence becomes an
  // unhandled promise rejection — Node 20+ terminates the process with SIGTRAP,
  // producing an opaque EXC_BREAKPOINT crash with only `PromiseRejectCallback`
  // in the stack. Logging the error here gives users something actionable.
  console.error('[startup] fatal error during app initialization:', err)
  if (err instanceof Error && err.stack) console.error(err.stack)
  dialog.showErrorBox('Spool failed to start', err instanceof Error ? err.message : String(err))
  app.exit(1)
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

ipcMain.handle('spool:search', (_e, { query, limit = 10, source, onlyPinned, identityKey }: { query: string; limit?: number; source?: string; onlyPinned?: boolean; identityKey?: string }) => {
  const cacheKey = `${source ?? 'all'}|${identityKey ?? 'any'}|${limit}|${onlyPinned ? 'pinned' : 'full'}|${query}`
  if (!isSyncActive) {
    const cached = searchCache.get(cacheKey)
    if (cached) return cached
  }

  const sessionSource = source === 'claude' || source === 'codex' || source === 'gemini'
    ? source
    : undefined
  const results = searchFragments(db, query, {
    limit,
    ...(sessionSource ? { source: sessionSource } : {}),
    ...(onlyPinned ? { onlyPinned: true } : {}),
    ...(identityKey ? { identityKey } : {}),
  }).map(f => ({ ...f, kind: 'fragment' as const }))

  if (!isSyncActive) {
    searchCache.set(cacheKey, results)
  }

  return results
})

ipcMain.handle('spool:search-preview', (_e, { query, limit = 5, source }: { query: string; limit?: number; source?: string }) => {
  const cacheKey = `preview|${source ?? 'all'}|${limit}|${query}`
  const cached = searchCache.get(cacheKey)
  if (cached) return cached

  const sessionSource = source === 'claude' || source === 'codex' || source === 'gemini'
    ? source
    : undefined
  const fragments = searchSessionPreview(db, query, {
    limit,
    ...(sessionSource ? { source: sessionSource } : {}),
  }).map(f => ({ ...f, kind: 'fragment' as const }))
  searchCache.set(cacheKey, fragments)
  return fragments
})

ipcMain.handle('spool:list-sessions', (_e, { limit = 50 }: { limit?: number } = {}) => {
  return listRecentSessions(db, limit)
})

ipcMain.handle('spool:list-project-groups', () => {
  return listProjectGroups(db)
})

ipcMain.handle('spool:list-sessions-by-identity', (_e, { identityKey, options }: { identityKey: string; options?: ListSessionsByIdentityOptions }) => {
  return listSessionsByIdentity(db, identityKey, options)
})

ipcMain.handle('spool:get-session', (_e, { sessionUuid }: { sessionUuid: string }) => {
  return getSessionWithMessages(db, sessionUuid)
})

ipcMain.handle('spool:get-status', () => {
  return getStatus(db)
})

ipcMain.handle('spool:pin-session', (_e, { uuid }: { uuid: string }) => {
  pinSession(db, uuid)
  searchCache.clear()
  return { ok: true }
})

ipcMain.handle('spool:unpin-session', (_e, { uuid }: { uuid: string }) => {
  unpinSession(db, uuid)
  searchCache.clear()
  return { ok: true }
})

ipcMain.handle('spool:get-pinned-uuids', () => {
  return getPinnedUuids(db)
})

ipcMain.handle('spool:list-pinned-sessions', () => {
  return listPinnedSessions(db)
})

ipcMain.handle('spool:list-pinned-sessions-by-identity', (_e, { identityKey }: { identityKey: string }) => {
  return listPinnedSessionsByIdentity(db, identityKey)
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

ipcMain.handle('spool:ai-search', async (_e, { query, agentId, context }: { query: string; agentId: string; context: import('@spool-lab/core').FragmentResult[] }) => {
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

// ── Spool Daemon notice ──────────────────────────────────────────────────

ipcMain.handle('spool:get-daemon-notice-pending', (): boolean => {
  // Only nudge users who actually upgraded from a pre-M5 schema. Fresh
  // installs land directly at user_version=5 with no DB beforehand —
  // nothing to apologize for, no notice needed.
  if (uiPreferences.spoolDaemonNoticeShown) return false
  if (wasNewDb()) return false
  const initialVersion = getInitialUserVersion()
  return initialVersion !== null && initialVersion < 5
})

ipcMain.handle('spool:daemon-notice-action', (_e, { action }: { action: 'install' | 'dismiss' }) => {
  uiPreferences.spoolDaemonNoticeShown = true
  saveSpoolDaemonNoticeShown()
  if (action === 'install') {
    void shell.openExternal('https://spool.pro/daemon')
  }
  return { ok: true }
})

// ── Auto-update ──────────────────────────────────────────────────────────

ipcMain.handle('spool:download-update', () => {
  downloadUpdate()
})

ipcMain.handle('spool:install-update', () => {
  quitAndInstall()
})

