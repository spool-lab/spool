import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('session detail shows Pin, action menu (Copy ID + Copy command), Resume', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await window.locator('[data-testid="session-row"]').first().click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })

  await expect(window.locator('[data-testid="pin-button"]')).toBeVisible()
  await expect(window.locator('[data-testid="detail-resume"]')).toBeVisible()

  await window.locator('[data-testid="detail-actions-menu"] button').first().click()
  await expect(window.getByRole('menuitem', { name: 'Copy session ID' })).toBeVisible()
  await expect(window.getByRole('menuitem', { name: /Copy resume command/ })).toBeVisible()
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

test('renders markdown: bold, headings, code blocks', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await window
    .locator('[data-testid="session-row"][data-session-uuid="test-session-uuid-001"]')
    .click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })

  const detail = window.locator('[data-testid="session-detail"]')

  await expect(detail.locator('strong', { hasText: 'XYZMARKDOWN' })).toBeVisible()
  await expect(detail.getByText('**XYZMARKDOWN**')).toHaveCount(0)

  await expect(detail.locator('h1', { hasText: 'Heading line' })).toBeVisible()

  await expect(detail.locator('pre code').first()).toBeVisible()
})

test('find-in-page matches rendered text, not markdown source', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await window
    .locator('[data-testid="session-row"][data-session-uuid="test-session-uuid-001"]')
    .click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })

  const isMac = process.platform === 'darwin'
  await window.keyboard.press(isMac ? 'Meta+f' : 'Control+f')

  await window.locator('[data-testid="session-find-input"]').fill('XYZMARKDOWN')
  await expect(window.locator('[data-testid="session-find-status"]')).toContainText(/^\d+ \/ \d+$/)
  await expect(window.locator('[data-testid="session-find-active-match"]')).toHaveCount(1)

  await window.locator('[data-testid="session-find-input"]').fill('**XYZMARKDOWN**')
  await expect(window.locator('[data-testid="session-find-status"]')).toContainText('No matches')
})
