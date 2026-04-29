import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('clicking sidebar project shows ProjectView with session rows', async () => {
  const { window } = ctx
  await waitForSync(window)

  const firstRow = window.locator('[data-testid="sidebar-project-row"]').first()
  await firstRow.click()

  const projectView = window.locator('[data-testid="project-view"]')
  await expect(projectView).toBeVisible({ timeout: 5000 })

  const sessionRows = window.locator('[data-testid="session-row"]')
  await expect(sessionRows.first()).toBeVisible({ timeout: 5000 })
  expect(await sessionRows.count()).toBeGreaterThanOrEqual(1)
})

test('clicking sidebar wordmark returns to home', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await expect(window.locator('[data-testid="project-view"]')).toBeVisible()

  await window.locator('[data-testid="sidebar-home"]').click()
  await expect(window.locator('[data-testid="project-view"]')).toBeHidden()
  await expect(window.locator('h1')).toContainText('Spool')
})

test('clicking session row opens session detail', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await window.locator('[data-testid="session-row"]').first().click()

  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })
})

test('changing sort order reloads sessions', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await expect(window.locator('[data-testid="session-row"]').first()).toBeVisible({ timeout: 5000 })

  const recentFirst = await window.locator('[data-testid="session-row"]').first().getAttribute('data-session-uuid')

  await window.locator('[data-testid="project-sort"]').selectOption('oldest')
  await expect(window.locator('[data-testid="session-row"]').first()).toBeVisible({ timeout: 5000 })

  const oldestFirst = await window.locator('[data-testid="session-row"]').first().getAttribute('data-session-uuid')
  expect(oldestFirst).not.toBe(recentFirst)
})
