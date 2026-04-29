import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
  await waitForSync(ctx.window)
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

async function openOverlayAndType(ctx: AppContext, query: string) {
  const overlay = ctx.window.locator('[data-testid="search-overlay"]')
  if (!(await overlay.isVisible().catch(() => false))) {
    await ctx.window.locator('[data-testid="search-trigger"]').first().click()
  }
  const input = ctx.window.locator('[data-testid="search-overlay-input"]')
  await expect(input).toBeVisible({ timeout: 3000 })
  await input.fill(query)
}

async function closeOverlay(ctx: AppContext) {
  await ctx.window.keyboard.press('Escape')
  await expect(ctx.window.locator('[data-testid="search-overlay"]')).toBeHidden({ timeout: 2000 })
}

test('overlay shows live result with highlighted match for canary keyword', async () => {
  await openOverlayAndType(ctx, 'XYLOPHONE_CANARY_42')

  const firstResult = ctx.window.locator('[data-testid="search-overlay"] [role="option"]').first()
  await expect(firstResult).toBeVisible({ timeout: 5000 })
  await expect(firstResult.locator('strong')).toContainText('XYLOPHONE_CANARY_42')

  await closeOverlay(ctx)
})

test('overlay live results are case-insensitive', async () => {
  await openOverlayAndType(ctx, 'xylophone_canary_42')

  const firstResult = ctx.window.locator('[data-testid="search-overlay"] [role="option"]').first()
  await expect(firstResult).toBeVisible({ timeout: 5000 })
  await expect(firstResult.locator('strong').first()).toContainText(/xylophone_canary_42/i)

  await closeOverlay(ctx)
})

test('clicking an overlay result jumps to message with flash highlight', async () => {
  await openOverlayAndType(ctx, 'XYLOPHONE_CANARY_42')

  const firstResult = ctx.window.locator('[data-testid="search-overlay"] [role="option"]').first()
  await expect(firstResult).toBeVisible({ timeout: 5000 })
  await firstResult.click()

  await expect(ctx.window.locator('[data-testid="search-overlay"]')).toBeHidden({ timeout: 2000 })
  const target = ctx.window.locator('[data-testid="target-message"]')
  await expect(target).toBeVisible({ timeout: 5000 })
  await expect(target).toHaveAttribute('data-highlighted', '1')
})
