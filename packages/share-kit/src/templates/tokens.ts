// Thin re-export so templates don't need to know about the canonical
// paper registry in types.ts. Keeps imports short at call sites.

export type { PaperTokens as TemplateTokens } from '@/lib/types'
export { paperTokens as templateTokens } from '@/lib/types'
