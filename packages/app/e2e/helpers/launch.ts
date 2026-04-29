import { _electron as electron, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FIXTURES_DIR = join(__dirname, '..', 'fixtures')
const MOCKS_DIR = join(__dirname, '..', 'mocks')
const APP_DIR = join(__dirname, '..', '..')

export interface AppContext {
  app: ElectronApplication
  window: Page
  dbPath: string
  cleanup: () => Promise<void>
}

export async function launchApp(opts: { mockAgent?: 'success' | 'error' } = {}): Promise<AppContext> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'spool-e2e-'))

  const claudeDir = join(tmpDir, 'claude', 'projects')
  const codexDir = join(tmpDir, 'codex', 'sessions')
  const geminiCliHome = join(tmpDir, 'gemini-cli-home')
  cpSync(join(FIXTURES_DIR, 'claude-projects'), claudeDir, { recursive: true })
  cpSync(join(FIXTURES_DIR, 'codex-sessions'), codexDir, { recursive: true })
  cpSync(join(FIXTURES_DIR, 'gemini-cli-home'), geminiCliHome, { recursive: true })

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    SPOOL_DATA_DIR: join(tmpDir, 'data'),
    SPOOL_ELECTRON_USER_DATA_DIR: join(tmpDir, 'electron-user-data'),
    SPOOL_CLAUDE_DIR: claudeDir,
    SPOOL_CODEX_DIR: codexDir,
    SPOOL_GEMINI_DIR: geminiCliHome,
    GEMINI_CLI_HOME: geminiCliHome,
    ELECTRON_DISABLE_GPU: '1',
    SPOOL_E2E_TEST: '1',
  }

  if (opts.mockAgent) {
    // Fake `claude` binary on PATH so detectAgents() finds an agent
    env['PATH'] = `${MOCKS_DIR}:${env['PATH'] ?? ''}`
    // Point ACP extension resolution to our mock script
    const mockScript = opts.mockAgent === 'error'
      ? join(MOCKS_DIR, 'acp-mock-agent-error.mjs')
      : join(MOCKS_DIR, 'acp-mock-agent.mjs')
    env['SPOOL_ACP_AGENT_BIN'] = mockScript
  }

  const args = [join(APP_DIR, 'out', 'main', 'index.js')]
  if (process.platform === 'linux') args.unshift('--no-sandbox')

  const app = await electron.launch({ args, cwd: APP_DIR, env })

  const window = await app.firstWindow()

  return {
    app,
    window,
    dbPath: join(tmpDir, 'data', 'spool.db'),
    cleanup: async () => {
      await app.close()
      rmSync(tmpDir, { recursive: true, force: true })
    },
  }
}

export async function waitForSync(window: Page) {
  await expect(window.locator('[data-testid="status-text"]')).toContainText(/[1-9]\d*\s+session/, { timeout: 15000 })
}

export async function search(window: Page, query: string) {
  // Open overlay via ⌘K (works from any view)
  await window.keyboard.press('Meta+k')
  const input = window.locator('[data-testid="search-overlay-input"]')
  await expect(input).toBeVisible({ timeout: 3000 })
  await input.fill(query)
  await input.press('Shift+Enter')
  await expect(window.locator('[data-testid="search-overlay"]')).toBeHidden({ timeout: 2000 })
}
