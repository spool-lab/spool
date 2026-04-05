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
