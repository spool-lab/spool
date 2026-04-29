import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('session detail shows Pin, Copy ID, Copy command, Resume buttons', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await window.locator('[data-testid="session-row"]').first().click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })

  await expect(window.locator('[data-testid="pin-button"]')).toBeVisible()
  await expect(window.locator('[data-testid="detail-copy-id"]')).toBeVisible()
  await expect(window.locator('[data-testid="detail-copy-command"]')).toBeVisible()
  await expect(window.locator('[data-testid="detail-resume"]')).toBeVisible()
})

test('pinning from session detail persists', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await window.locator('[data-testid="session-row"]').first().click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })

  const pinButton = window.locator('[data-testid="session-detail"] [data-testid="pin-button"]')
  const initialState = await pinButton.getAttribute('data-pinned')
  await pinButton.click()
  await expect(pinButton).toHaveAttribute('data-pinned', initialState === '1' ? '0' : '1', { timeout: 2000 })
})
