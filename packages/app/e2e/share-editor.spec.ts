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

  await window.locator('[data-testid="share-editor-colorway-marine"]').click()
  await expect(preview).toHaveAttribute('data-colorway', 'marine')

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

test('Cmd+Z undoes the last opts change; Cmd+Shift+Z redoes it', async () => {
  const { window } = ctx
  // Editor is left open by prior tests in this file; do not call
  // openShareEditorFromSessionDetail (its sidebar click would be
  // intercepted by the editor's right panel).
  const preview = window.locator('[data-testid="share-preview-render"]')

  // Settle on chat, wait past the coalesce window, change to letter.
  // Two distinct undo entries: (chat) → (letter).
  await window.locator('[data-testid="share-editor-template-chat"]').click()
  await expect(preview).toHaveAttribute('data-template', 'chat')
  await window.waitForTimeout(600)
  await window.locator('[data-testid="share-editor-template-letter"]').click()
  await expect(preview).toHaveAttribute('data-template', 'letter')

  await window.keyboard.press('Meta+z')
  await expect(preview).toHaveAttribute('data-template', 'chat', { timeout: 2000 })

  await window.keyboard.press('Meta+Shift+z')
  await expect(preview).toHaveAttribute('data-template', 'letter', { timeout: 2000 })
})

test('rapid clicks within the coalesce window collapse into one undo step', async () => {
  const { window } = ctx
  const preview = window.locator('[data-testid="share-preview-render"]')

  // Settle on a known starting template; gap so the next chain begins
  // a fresh undo entry.
  await window.locator('[data-testid="share-editor-template-chat"]').click()
  await expect(preview).toHaveAttribute('data-template', 'chat')
  await window.waitForTimeout(600)

  // Three rapid switches within the 500ms coalesce window collapse
  // into a single undo step that returns to 'chat'.
  await window.locator('[data-testid="share-editor-template-letter"]').click()
  await window.locator('[data-testid="share-editor-template-forum"]').click()
  await window.locator('[data-testid="share-editor-template-timeline"]').click()
  await expect(preview).toHaveAttribute('data-template', 'timeline')

  await window.keyboard.press('Meta+z')
  await expect(preview).toHaveAttribute('data-template', 'chat', { timeout: 2000 })
})

test('Back returns to SessionDetail', async () => {
  const { window } = ctx
  await window.getByRole('button', { name: 'Back' }).first().click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })
})
