import { app, BrowserWindow, ipcMain, Menu, nativeTheme, nativeImage } from 'electron'
import { join } from 'node:path'
import { getDB, Syncer, SpoolWatcher, searchFragments, listRecentSessions, getSessionWithMessages, getStatus } from '@spool/core'
import { setupTray } from './tray.js'
import { AcpManager } from './acp.js'
import { execSync } from 'node:child_process'
import type Database from 'better-sqlite3'

// macOS menu bar shows the first menu's label as the app name
app.setName('Spool')

let mainWindow: BrowserWindow | null = null
let db: Database.Database
let syncer: Syncer
let watcher: SpoolWatcher
let acpManager: AcpManager

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
    win.webContents.openDevTools()
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
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
  syncer = new Syncer(db, (e) => {
    mainWindow?.webContents.send('spool:sync-progress', e)
  })
  watcher = new SpoolWatcher(syncer)
  watcher.on('new-sessions', (_event, data) => {
    mainWindow?.webContents.send('spool:new-sessions', data)
  })

  // Initial sync in background
  setImmediate(() => {
    syncer.syncAll()
    watcher.start()
  })

  mainWindow = createWindow()

  // Background mode — hide from dock when window is closed
  mainWindow.on('closed', () => {
    mainWindow = null
    app.dock?.hide()
  })

  setupTray(() => {
    if (mainWindow) {
      mainWindow.show()
      app.dock?.show()
    } else {
      mainWindow = createWindow()
      app.dock?.show()
    }
  }, () => {
    syncer.syncAll()
  })

  app.on('activate', () => {
    if (!mainWindow) {
      mainWindow = createWindow()
      app.dock?.show()
    } else {
      mainWindow.show()
    }
  })
})

app.on('window-all-closed', (e) => {
  // On macOS, keep app running in tray
  e.preventDefault()
  app.dock?.hide()
})

// ── IPC Handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('spool:search', (_e, { query, limit = 10, source }: { query: string; limit?: number; source?: string }) => {
  const src = source === 'claude' || source === 'codex' ? source : undefined
  return searchFragments(db, query, { limit, ...(src !== undefined && { source: src }) })
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
  return syncer.syncAll()
})

ipcMain.handle('spool:resume-cli', (_e, { sessionUuid, source }: { sessionUuid: string; source: string }) => {
  try {
    if (source === 'claude') {
      const script = `tell application "Terminal" to do script "claude --resume ${sessionUuid}"`
      execSync(`osascript -e '${script}'`)
    } else {
      const script = `tell application "Terminal" to activate`
      execSync(`osascript -e '${script}'`)
    }
    return { ok: true }
  } catch (err) {
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
    mainWindow?.webContents.send('spool:ai-done', { fullText: '', error })
    return { ok: false, error }
  }
})

ipcMain.handle('spool:ai-cancel', () => {
  acpManager.cancel()
  return { ok: true }
})
