// Tier 2 storage — the .spool file. A user-owned, portable JSON document
// that captures both the conversation and the current editor settings.

import type { Conversation, EditorOpts, SpoolDocument } from '../types'
import { saveBlob } from '../export'

const MIME = 'application/spool+json'

export function buildSpoolDocument(conversation: Conversation, opts: EditorOpts): SpoolDocument {
  return {
    version: 1,
    conversation,
    opts,
    exportedAt: new Date().toISOString(),
  }
}

export async function downloadSpoolFile(
  conversation: Conversation,
  opts: EditorOpts,
): Promise<void> {
  const doc = buildSpoolDocument(conversation, opts)
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: MIME })
  await saveBlob(blob, filenameFor(conversation), {
    description: 'Spool Share document',
    mime: MIME,
    ext: '.spool',
  })
}

export async function readSpoolFile(file: File): Promise<SpoolDocument> {
  const text = await file.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Not a valid .spool file (malformed JSON).')
  }
  if (!isSpoolDocument(parsed)) {
    throw new Error('Not a valid .spool file (unrecognized shape).')
  }
  return parsed
}

function isSpoolDocument(v: unknown): v is SpoolDocument {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return o.version === 1 && typeof o.conversation === 'object' && typeof o.opts === 'object'
}

function filenameFor(c: Conversation): string {
  const safe = c.title
    .trim()
    .replace(/[\/\\:*?"<>| -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim()
  const date = new Date().toISOString().slice(0, 10)
  return `${safe || 'spool'} · ${date}.spool`
}
