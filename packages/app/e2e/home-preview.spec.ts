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

async function typeQuery(ctx: AppContext, query: string) {
  const input = ctx.window.locator('[data-testid="search-input"]')
  await input.fill(query)
  // Do NOT press Enter — we want the dropdown preview, not the All view.
}

test('home dropdown session suggestion shows matched snippet with highlight', async () => {
  await typeQuery(ctx, 'XYLOPHONE_CANARY_42')

  const suggestion = ctx.window.locator('[data-testid="home-suggestion"][data-kind="fragment"]').first()
  await expect(suggestion).toBeVisible({ timeout: 5000 })
  // The second line uses <strong> (converted from FTS <mark>) to highlight the hit.
  await expect(suggestion.locator('strong')).toContainText('XYLOPHONE_CANARY_42')
})

test('home dropdown session snippet window is case-insensitive', async () => {
  // Query lower-case; fixture stores the term upper-case. Before the fix,
  // the snippet window fell back to position 0, so for long messages the
  // matched text could be cut off. We assert the matched text is present
  // in the snippet (ignoring <strong> tags).
  await typeQuery(ctx, 'xylophone_canary_42')

  const suggestion = ctx.window.locator('[data-testid="home-suggestion"][data-kind="fragment"]').first()
  await expect(suggestion).toBeVisible({ timeout: 5000 })
  // The highlight still fires because the regex is case-insensitive.
  await expect(suggestion.locator('strong').first()).toContainText(/xylophone_canary_42/i)
})

test('clicking a home dropdown fragment jumps to message with flash highlight', async () => {
  await typeQuery(ctx, 'XYLOPHONE_CANARY_42')

  const suggestion = ctx.window.locator('[data-testid="home-suggestion"][data-kind="fragment"]').first()
  await expect(suggestion).toBeVisible({ timeout: 5000 })
  await suggestion.click()

  // Session detail opens and the target message is annotated.
  const target = ctx.window.locator('[data-testid="target-message"]')
  await expect(target).toBeVisible({ timeout: 5000 })
  // Highlight flag is present immediately after nav.
  await expect(target).toHaveAttribute('data-highlighted', '1')
  // And is removed after the ~2s timer — generous bound to stay non-flaky.
  await expect(target).not.toHaveAttribute('data-highlighted', '1', { timeout: 5000 })
})
