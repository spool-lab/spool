// All known sources. Add new ones here.
//
// Importing this file pulls in every source — keep extractors lean.

import type { ParserSource } from './source'
import { chatgptSource } from './sources/chatgpt'
import { claudeSource } from './sources/claude'
import { geminiSource } from './sources/gemini'

export const SOURCES: ParserSource[] = [chatgptSource, claudeSource, geminiSource]

export function findSource(url: string): ParserSource | undefined {
  return SOURCES.find((s) => s.matchUrl(url))
}
