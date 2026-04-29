import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('pinning a session moves it into the Pinned segment', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  const firstRow = window.locator('[data-testid="session-row"]').first()
  await expect(firstRow).toBeVisible({ timeout: 5000 })

  const targetUuid = await firstRow.getAttribute('data-session-uuid')
  expect(targetUuid).toBeTruthy()

  // Hover row, click its pin button
  await firstRow.hover()
  const pinButton = firstRow.locator('[data-testid="pin-button"]')
  await pinButton.click()

  const pinnedSegment = window.locator('[data-testid="project-view-pinned"]')
  await expect(pinnedSegment).toBeVisible({ timeout: 5000 })
  await expect(pinnedSegment.locator(`[data-session-uuid="${targetUuid}"]`)).toBeVisible()
})

test('unpinning removes session from Pinned segment', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  const pinnedSegment = window.locator('[data-testid="project-view-pinned"]')
  await expect(pinnedSegment).toBeVisible({ timeout: 5000 })

  const pinnedRow = pinnedSegment.locator('[data-testid="session-row"]').first()
  const targetUuid = await pinnedRow.getAttribute('data-session-uuid')

  const pinButton = pinnedRow.locator('[data-testid="pin-button"]')
  await pinButton.click()

  // The pinned row should disappear
  await expect(pinnedSegment.locator(`[data-session-uuid="${targetUuid}"]`)).toBeHidden({ timeout: 5000 })
})
