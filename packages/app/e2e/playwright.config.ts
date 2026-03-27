import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  globalTimeout: 300_000,
  retries: 1,
  workers: 1,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: '../test-results/html-report' }]]
    : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
