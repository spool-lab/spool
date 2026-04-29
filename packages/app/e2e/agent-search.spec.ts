import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, search, type AppContext } from './helpers/launch'

test.describe('Agent mode — success', () => {
  let ctx: AppContext

  test.beforeAll(async () => {
    ctx = await launchApp({ mockAgent: 'success' })
  })

  test.afterAll(async () => {
    await ctx?.cleanup()
  })

  test('streams answer with trust label and tool calls', async () => {
    const { window } = ctx

    await waitForSync(window)
    await search(window, 'XYLOPHONE_CANARY_42')
    await window.locator('[data-testid="mode-agent"]').click()
    await window.locator('[data-testid="search-input"]').press('Enter')

    const card = window.locator('[data-testid="ai-answer-card"]')
    await expect(card).toBeVisible({ timeout: 15000 })

    const answerText = window.locator('[data-testid="ai-answer-text"]')
    await expect(answerText).toContainText('MOCK_ACP_RESPONSE_42', { timeout: 10000 })

    await expect(card).toContainText('via ACP')
    await expect(card).toContainText('local')
    await expect(card).toContainText('says')
    await expect(card).toContainText('Searching knowledge base')
  })

  test('shows FTS sources when search has matches', async () => {
    const { window } = ctx
    await expect(window.locator('text=Sources used')).toBeVisible({ timeout: 3000 })
  })

  test('mode toggle preserves query text', async () => {
    const { window } = ctx
    await expect(window.locator('[data-testid="search-input"]')).toHaveValue('XYLOPHONE_CANARY_42')
  })

  test('second query replaces previous answer', async () => {
    const { window } = ctx

    const compactInput = window.locator('[data-testid="search-input"]')
    await compactInput.fill('another question')
    await compactInput.press('Enter')

    const answerText = window.locator('[data-testid="ai-answer-text"]')
    await expect(answerText).toContainText('MOCK_ACP_RESPONSE_42', { timeout: 10000 })
  })
})

test.describe('Agent mode — error', () => {
  let ctx: AppContext

  test.beforeAll(async () => {
    ctx = await launchApp({ mockAgent: 'error' })
  })

  test.afterAll(async () => {
    await ctx?.cleanup()
  })

  test('shows error with useful message and trust label', async () => {
    const { window } = ctx

    await waitForSync(window)
    await search(window, 'test query')
    await window.locator('[data-testid="mode-agent"]').click()
    await window.locator('[data-testid="search-input"]').press('Enter')

    const card = window.locator('[data-testid="ai-answer-card"]')
    await expect(card).toBeVisible({ timeout: 15000 })

    const errorEl = window.locator('[data-testid="ai-error"]')
    await expect(errorEl).toBeVisible({ timeout: 10000 })
    await expect(errorEl).toContainText('unavailable')

    await expect(card).toContainText('via ACP')
  })
})
