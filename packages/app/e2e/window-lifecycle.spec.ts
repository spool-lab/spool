import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './helpers/launch'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('window recovers after close → activate cycle', async () => {
  const { app } = ctx

  // Close the window
  const firstWindow = await app.firstWindow()
  await firstWindow.close()

  // Trigger activate (same code path as tray click)
  await app.evaluate(({ app: a }) => a.emit('activate'))
  const restored = await app.firstWindow()
  await expect(restored.locator('h1')).toContainText('AI Session Library')

  // Second cycle — this is where the bug manifested
  await restored.close()
  await app.evaluate(({ app: a }) => a.emit('activate'))
  const restoredAgain = await app.firstWindow()
  await expect(restoredAgain.locator('h1')).toContainText('AI Session Library')
})
