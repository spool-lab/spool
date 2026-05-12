import type { SpoolDocument } from '@spool/share-kit'

export class SpoolImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpoolImportError'
  }
}

/** Parse a .spool file's text and validate that it's a SpoolDocument shape
 *  we recognize. Throws SpoolImportError on any mismatch so callers can
 *  surface a single toast without inspecting the failure kind. */
export function parseSpoolFile(text: string): SpoolDocument {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new SpoolImportError('File is not valid JSON')
  }
  if (!raw || typeof raw !== 'object') {
    throw new SpoolImportError('Top-level JSON must be an object')
  }
  const obj = raw as Record<string, unknown>
  const conversation = obj.conversation as Record<string, unknown> | undefined
  if (!conversation || !Array.isArray(conversation.turns)) {
    throw new SpoolImportError('Missing conversation.turns')
  }
  if (!obj.opts || typeof obj.opts !== 'object' || Array.isArray(obj.opts)) {
    throw new SpoolImportError('Missing opts')
  }
  return obj as unknown as SpoolDocument
}

/** Stable draft id for an imported .spool — same snapshot text always
 *  collapses onto the same draft row, so re-importing reopens the
 *  existing draft instead of forking it. Hash is SHA-1/8 (good enough
 *  for collision avoidance across a single user's local library). */
export async function draftIdForImport(snapshotJson: string): Promise<string> {
  const buf = new TextEncoder().encode(snapshotJson)
  const hash = await crypto.subtle.digest('SHA-1', buf)
  const hex = [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 8)
  return `imported:${hex}`
}
