import { randomUUID } from 'node:crypto'
import type { ElectronApplication } from '@playwright/test'

export interface SeedCapture {
  platform: string
  platformId: string
  title: string
  url: string
  content?: string
  connectorId: string
  author?: string
}

/**
 * Insert a capture + its M:N attribution into the app's DB by delegating
 * to a test-only hook installed on `globalThis` in the main process. The
 * hook is registered in `main/index.ts` when `SPOOL_E2E_TEST=1` is set,
 * which the launch helper always does. This avoids:
 *
 * - Loading `better-sqlite3` in the test process (the app rebuilds it for
 *   the electron ABI, which can't be `require`d from a plain Node process).
 * - Shelling out to the `sqlite3` CLI, whose FTS5 support is missing on
 *   macOS GitHub runners (the captures_fts triggers would fail).
 */
export async function seedCapture(
  app: ElectronApplication,
  capture: SeedCapture,
): Promise<void> {
  const captureUuid = randomUUID()
  await app.evaluate(({}, args) => {
    const g = globalThis as unknown as {
      __spoolSeedCapture?: (args: unknown) => void
    }
    if (!g.__spoolSeedCapture) {
      throw new Error('SPOOL_E2E_TEST hook not installed; did launchApp set the env var?')
    }
    g.__spoolSeedCapture(args)
  }, { ...capture, captureUuid })
}
