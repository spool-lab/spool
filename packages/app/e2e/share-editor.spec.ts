import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { openShareEditorFromSessionDetail } from './helpers/share'

let ctx: AppContext

const SESSION_UUID = 'test-session-uuid-001'

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('share editor opens from SessionDetail with default opts', async () => {
  const { window } = ctx
  await waitForSync(window)
  await openShareEditorFromSessionDetail(window, SESSION_UUID)
  const preview = window.locator('[data-testid="share-preview-render"]')
  await expect(preview).toBeVisible()
  await expect(preview).toHaveAttribute('data-template', 'chat')
  await expect(preview).toHaveAttribute('data-paper', 'snow')
  await expect(preview).toHaveAttribute('data-typeface', 'inter')
  await expect(preview).toHaveAttribute('data-colorway', 'amber')
})

test('template / typeface / paper / colorway switches reflect in preview', async () => {
  const { window } = ctx
  const preview = window.locator('[data-testid="share-preview-render"]')

  await window.locator('[data-testid="share-editor-template-letter"]').click()
  await expect(preview).toHaveAttribute('data-template', 'letter')

  await window.locator('[data-testid="share-editor-typeface-fraunces"]').click()
  await expect(preview).toHaveAttribute('data-typeface', 'fraunces')

  await window.locator('[data-testid="share-editor-paper-bone"]').click()
  await expect(preview).toHaveAttribute('data-paper', 'bone')

  await window.locator('[data-testid="share-editor-colorway-iris"]').click()
  await expect(preview).toHaveAttribute('data-colorway', 'iris')

  await window.locator('[data-testid="share-editor-density-relaxed"]').click()
  await expect(preview).toHaveAttribute('data-density', 'relaxed')
})

test('chrome toggles (masthead, colophon, avatars, hideEmptyTurns, showGaps) flip aria-checked', async () => {
  const { window } = ctx
  // Each toggle is a role="switch" with aria-checked reflecting state.
  const ids = ['hideEmptyTurns', 'showGaps', 'avatars', 'showMasthead', 'showColophon']
  for (const key of ids) {
    const sel = `[data-testid="share-editor-toggle-${key}"]`
    const before = await window.locator(sel).getAttribute('aria-checked')
    await window.locator(sel).click()
    const after = await window.locator(sel).getAttribute('aria-checked')
    expect(after).not.toBe(before)
    // Flip back so subsequent tests start from defaults-on.
    await window.locator(sel).click()
    const final = await window.locator(sel).getAttribute('aria-checked')
    expect(final).toBe(before)
  }
})

test('Back returns to SessionDetail', async () => {
  const { window } = ctx
  await window.getByRole('button', { name: 'Back' }).first().click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })
})
