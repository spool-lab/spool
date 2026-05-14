import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import {
  installSaveFilePickerMock,
  openShareEditorFromSessionDetail,
  waitForSavedFile,
} from './helpers/share'

let ctx: AppContext

const SESSION_UUID = 'test-session-uuid-001'

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

async function pickFormat(window: Awaited<ReturnType<typeof launchApp>>['window'], k: 'png' | 'pdf' | 'md' | 'spool') {
  await window.locator('[data-testid="share-editor-download-caret"]').click()
  await window.locator(`[data-testid="share-editor-download-option-${k}"]`).click()
}

test('.spool export captures a valid SpoolDocument', async () => {
  const { window } = ctx
  await waitForSync(window)
  await openShareEditorFromSessionDetail(window, SESSION_UUID)
  await installSaveFilePickerMock(window)

  await pickFormat(window, 'spool')
  await window.locator('[data-testid="share-editor-download-trigger"]').click()

  const saved = await waitForSavedFile(window, '.spool')
  expect(saved.filename).toMatch(/\.spool$/)
  expect(saved.bytes.byteLength).toBeGreaterThan(0)
  const text = new TextDecoder().decode(saved.bytes)
  const doc = JSON.parse(text) as {
    version: number
    conversation: { turns: unknown[]; title: string }
    opts: { template: string }
  }
  expect(doc.version).toBe(1)
  expect(doc.opts.template).toBe('chat')
  expect(Array.isArray(doc.conversation.turns)).toBe(true)
  expect(doc.conversation.turns.length).toBeGreaterThan(0)
})

test('Markdown export captures frontmatter + body', async () => {
  const { window } = ctx
  // Editor still open from the previous test in the same browser context.
  await installSaveFilePickerMock(window)

  await pickFormat(window, 'md')
  await window.locator('[data-testid="share-editor-download-trigger"]').click()

  const saved = await waitForSavedFile(window, '.md')
  expect(saved.filename).toMatch(/\.md$/)
  const text = new TextDecoder().decode(saved.bytes)
  // Frontmatter delimiters at top.
  expect(text.startsWith('---\n')).toBe(true)
  expect(text).toMatch(/\n---\n/)
  // At least one of the conversation roles renders as a heading-like marker.
  expect(text.toLowerCase()).toMatch(/user|assistant|claude/i)
  // And some recognisable fixture content from test-session-001.
  expect(text).toContain('XYLOPHONE_CANARY_42')
})
