import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, search, type AppContext } from './helpers/launch'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('home view shows title and session counts after sync', async () => {
  const { window } = ctx

  await expect(window.locator('h1')).toContainText('Spool')
  await waitForSync(window)
  await expect(window.locator('text=Claude Chats')).toBeVisible()
})

test('search finds fixture content by canary keyword', async () => {
  const { window } = ctx

  await search(window, 'XYLOPHONE_CANARY_42')

  const rows = window.locator('[data-testid="fragment-row"]')
  await expect(rows.first()).toBeVisible({ timeout: 5000 })
  expect(await rows.count()).toBeGreaterThanOrEqual(2)
})

test('search result snippet contains highlighted match', async () => {
  const { window } = ctx

  // FTS snippet wraps matches in <mark> → rendered as <strong>
  const snippet = window.locator('[data-testid="fragment-row"] strong').first()
  await expect(snippet).toBeVisible()
  await expect(snippet).toContainText('XYLOPHONE_CANARY_42')
})

test('search result shows session metadata', async () => {
  const { window } = ctx

  const row = window.locator('[data-testid="fragment-row"]').first()
  await expect(row).toContainText('You discussed this')
  await expect(row.locator('text=claude')).toBeVisible()
})

test('search for different canary finds separate session', async () => {
  const { window } = ctx

  await search(window, 'TROMBONE_CANARY_99')

  const rows = window.locator('[data-testid="fragment-row"]')
  await expect(rows.first()).toBeVisible({ timeout: 5000 })
  await expect(rows.first()).toContainText('TROMBONE_CANARY_99')
})

test('search for non-existent keyword shows no results', async () => {
  const { window } = ctx

  await search(window, 'ZZZZZ_NONEXISTENT_99999')

  await expect(window.locator('text=No results')).toBeVisible({ timeout: 5000 })
  await expect(window.locator('[data-testid="fragment-row"]')).toHaveCount(0)
})

test('codex search results expose resume-related actions', async () => {
  const { window } = ctx

  await search(window, 'BASSOON_CANARY_77')

  const row = window.locator('[data-testid="fragment-row"]').first()
  await expect(row).toBeVisible({ timeout: 5000 })
  await expect(row.locator('text=codex')).toBeVisible()

  const copyCommand = row.getByRole('button', { name: 'Copy Command' })
  await expect(copyCommand).toBeVisible()

  const resumeInCli = row.getByRole('button', { name: 'Resume in CLI' })
  await expect(resumeInCli).toBeVisible()
})

test('session page can submit a new search without returning home first', async () => {
  const { window } = ctx

  await search(window, 'XYLOPHONE_CANARY_42')
  await window.locator('[data-testid="fragment-row"]').first().click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible()

  const input = window.locator('[data-testid="search-input"]')
  await input.fill('TROMBONE_CANARY_99')
  await input.press('Enter')

  await expect(window.locator('[data-testid="session-detail"]')).toHaveCount(0)
  await expect(window.locator('[data-testid="fragment-row"]').first()).toContainText('TROMBONE_CANARY_99')
})

test('session page supports cmd or ctrl + f find-in-page', async () => {
  const { window } = ctx

  await search(window, 'XYLOPHONE_CANARY_42')
  await window.locator('[data-testid="fragment-row"]').first().click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible()

  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f')

  const findInput = window.locator('[data-testid="session-find-input"]')
  await expect(findInput).toBeVisible()
  await expect(findInput).toBeFocused()

  await findInput.fill('XYLOPHONE')
  await window.locator('[data-testid="session-detail"]').click()
  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f')
  await expect(findInput).toBeFocused()
  await findInput.type('_CANARY_42')
  await expect(findInput).toHaveValue('XYLOPHONE_CANARY_42')
  await expect(window.locator('[data-testid="session-find-status"]')).toContainText(/\d+\s*\/\s*\d+/, { timeout: 5000 })
  await expect(window.locator('[data-testid="session-find-active-match"]').first()).toContainText('XYLOPHONE_CANARY_42')
})

test('session find supports cmd or ctrl + arrow navigation', async () => {
  const { window } = ctx

  await search(window, 'XYLOPHONE_CANARY_42')
  await window.locator('[data-testid="fragment-row"]').first().click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible()

  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f')

  const findInput = window.locator('[data-testid="session-find-input"]')
  const status = window.locator('[data-testid="session-find-status"]')

  await findInput.fill('the')
  await expect(status).toContainText(/1\s*\/\s*[2-9]\d*/, { timeout: 5000 })

  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'Control+ArrowRight')
  await expect(status).toContainText(/2\s*\/\s*[2-9]\d*/, { timeout: 5000 })

  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Control+ArrowLeft')
  await expect(status).toContainText(/1\s*\/\s*[2-9]\d*/, { timeout: 5000 })
})
