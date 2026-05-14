import { test, expect } from '@playwright/test'
import { launchApp, restartApp, waitForSync, type AppContext } from './helpers/launch'
import { openShareEditorFromSessionDetail, navigateToShares } from './helpers/share'

let ctx: AppContext

const SESSION_UUID = 'test-session-uuid-001'

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('opts mutations + title rename survive a full app restart', async () => {
  await waitForSync(ctx.window)
  await openShareEditorFromSessionDetail(ctx.window, SESSION_UUID)

  // Change a few opts.
  await ctx.window.locator('[data-testid="share-editor-template-atelier"]').click()
  await ctx.window.locator('[data-testid="share-editor-paper-ink"]').click()
  await ctx.window.locator('[data-testid="share-editor-colorway-moss"]').click()

  // Rename via the modal.
  await ctx.window.locator('[data-testid="share-editor-more"]').click()
  await ctx.window.getByRole('menuitem', { name: 'Rename draft' }).click()
  const input = ctx.window.locator('[data-testid="rename-draft-input"]')
  await expect(input).toBeVisible()
  await input.fill('Autosave checkpoint')
  await ctx.window.locator('[data-testid="rename-draft-save"]').click()
  await expect(ctx.window.locator('[data-testid="share-editor-title"]')).toHaveText('Autosave checkpoint')

  // Autosave is debounced at 400ms — give it a safe margin before
  // tearing down the renderer.
  await ctx.window.waitForTimeout(800)

  ctx = await restartApp(ctx)
  await waitForSync(ctx.window)

  await navigateToShares(ctx.window)
  // Open the persisted draft from the grid.
  const draftCard = ctx.window
    .locator('[data-testid="shares-draft-row"][aria-label="Open Autosave checkpoint"]')
    .first()
  await expect(draftCard).toBeVisible({ timeout: 5000 })
  await draftCard.click()

  await expect(ctx.window.locator('[data-testid="share-editor-title"]')).toHaveText('Autosave checkpoint')
  const preview = ctx.window.locator('[data-testid="share-preview-render"]')
  await expect(preview).toHaveAttribute('data-template', 'atelier')
  await expect(preview).toHaveAttribute('data-paper', 'ink')
  await expect(preview).toHaveAttribute('data-colorway', 'moss')
})
