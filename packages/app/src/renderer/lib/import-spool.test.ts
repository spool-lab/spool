import { describe, it, expect } from 'vitest'
import { draftIdForImport, parseSpoolFile, SpoolImportError } from './import-spool'

const validDoc = {
  version: 1,
  conversation: {
    title: 'Hello',
    turns: [{ id: 't1', role: 'user', body: 'hi' }],
  },
  opts: { template: 'classic' },
}

describe('parseSpoolFile', () => {
  it('returns the parsed document when shape is valid', () => {
    const doc = parseSpoolFile(JSON.stringify(validDoc))
    expect(doc.conversation.turns).toHaveLength(1)
  })

  it('rejects non-JSON', () => {
    expect(() => parseSpoolFile('{not json')).toThrow(SpoolImportError)
  })

  it('rejects non-object root', () => {
    expect(() => parseSpoolFile('[]')).toThrow(SpoolImportError)
    expect(() => parseSpoolFile('42')).toThrow(SpoolImportError)
  })

  it('rejects missing conversation.turns', () => {
    expect(() => parseSpoolFile(JSON.stringify({ ...validDoc, conversation: {} }))).toThrow(
      SpoolImportError,
    )
  })

  it('rejects missing opts', () => {
    const { opts: _opts, ...without } = validDoc
    expect(() => parseSpoolFile(JSON.stringify(without))).toThrow(SpoolImportError)
  })
})

describe('draftIdForImport', () => {
  it('is deterministic for the same snapshot', async () => {
    const json = JSON.stringify(validDoc)
    const a = await draftIdForImport(json)
    const b = await draftIdForImport(json)
    expect(a).toBe(b)
    expect(a.startsWith('imported:')).toBe(true)
  })

  it('differs across distinct snapshots', async () => {
    const a = await draftIdForImport(JSON.stringify(validDoc))
    const b = await draftIdForImport(
      JSON.stringify({ ...validDoc, conversation: { ...validDoc.conversation, title: 'Other' } }),
    )
    expect(a).not.toBe(b)
  })
})
