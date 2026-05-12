// Core domain types for Spool Share.
//
// `Conversation` is the source-agnostic shape that every adapter
// (paste link, dropped .spool file, future: direct app handoff)
// normalizes into. The editor reads this and never cares where it
// came from — except via `origin`, which drives the source chip
// rendering in the top bar.

export type Platform = 'ChatGPT' | 'Claude' | 'Gemini'

export type Origin =
  | { kind: 'pasted'; platform: Platform }
  | { kind: 'file'; filename: string }

export type TurnRole = 'user' | 'assistant'

export interface Turn {
  role: TurnRole
  /** Display name for user turns, e.g. "[Maya]" or "[you]". Omitted for assistant. */
  author?: string | undefined
  body: string
  /** Literal substrings to redact when `opts.redact` is on. */
  redact?: string[] | undefined
}

export interface Conversation {
  /** Machine ID, lowercased: 'claude' | 'chatgpt' | 'gemini' | 'claude-code' | ... */
  source: string
  /** Display label, e.g. "Claude" or "Claude Code". */
  sourceLabel: string
  origin: Origin
  title: string
  /** Public share URL when applicable. Null for file origins. */
  shareUrl: string | null
  /** Hosted spool.share short URL. Only present after publish (Phase 2+). */
  shortUrl?: string
  createdAt: string
  wordCount: number
  readMin: number
  turns: Turn[]
}

export type Template = 'atelier' | 'letter' | 'transcript' | 'interview' | 'chat'
export type Paper = 'bone' | 'snow' | 'linen' | 'graphite' | 'ink'
export type Typeface = 'geist' | 'grotesk' | 'instrument' | 'fraunces' | 'garamond'
export type Density = 'compact' | 'relaxed'

export interface PaperTokens {
  paper: string
  text: string
  muted: string
  faint: string
  border: string
  surface: string
  accentBg: string
}

export interface PaperDef {
  id: Paper
  name: string
  tokens: PaperTokens
}

export const PAPERS: PaperDef[] = [
  {
    id: 'bone',
    name: 'Bone',
    tokens: {
      paper: '#F6F5EF',
      text: '#1C1C18',
      muted: '#6B6B60',
      faint: '#ADADAA',
      border: 'rgba(28,28,24,0.12)',
      surface: '#EEEEE9',
      accentBg: '#FFF3E8',
    },
  },
  {
    id: 'snow',
    name: 'Snow',
    tokens: {
      paper: '#FCFCFA',
      text: '#1C1C18',
      muted: '#6B6B60',
      faint: '#B0B0AD',
      border: 'rgba(28,28,24,0.08)',
      surface: '#F4F4F2',
      accentBg: '#FFF3E8',
    },
  },
  {
    id: 'linen',
    name: 'Linen',
    tokens: {
      paper: '#EBE5D5',
      text: '#2A2620',
      muted: '#6B6153',
      faint: '#A69E8E',
      border: 'rgba(42,38,32,0.14)',
      surface: '#E2DBCA',
      accentBg: '#FCEAD0',
    },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    tokens: {
      paper: '#3E3B34',
      text: '#E8E3D6',
      muted: '#A09A8B',
      faint: '#6B675F',
      border: 'rgba(232,227,214,0.12)',
      surface: '#4A4640',
      accentBg: '#2A1E0A',
    },
  },
  {
    id: 'ink',
    name: 'Ink',
    tokens: {
      paper: '#1A1A16',
      text: '#F2F2EC',
      muted: '#8A8A80',
      faint: '#505048',
      border: 'rgba(242,242,236,0.10)',
      surface: '#242420',
      accentBg: '#2A1800',
    },
  },
]

export function paperTokens(paper: Paper): PaperTokens {
  return (PAPERS.find((p) => p.id === paper) ?? PAPERS[0]!).tokens
}

/** Binary chrome mode for the Editor UI (separate from paper choice).
 *  Ink and Graphite are dark enough that the editor's surrounding
 *  chrome (top bar, banners, panel) should also flip to dark mode for
 *  visual coherence with the artifact. */
export function chromeMode(paper: Paper): 'light' | 'dark' {
  return paper === 'ink' || paper === 'graphite' ? 'dark' : 'light'
}

export interface TypefaceDef {
  id: Typeface
  name: string
  /** CSS font-family declaration applied to non-mono text in templates. */
  family: string
  /** Short label for preview swatches. */
  sample: string
}

export const TYPEFACES: TypefaceDef[] = [
  {
    id: 'geist',
    name: 'Geist',
    family: "'Geist', system-ui, sans-serif",
    sample: 'Aa',
  },
  {
    id: 'grotesk',
    name: 'Space Grotesk',
    family: "'Space Grotesk Variable', 'Space Grotesk', system-ui, sans-serif",
    sample: 'Aa',
  },
  {
    id: 'instrument',
    name: 'Instrument Serif',
    family: "'Instrument Serif', 'Georgia', serif",
    sample: 'Aa',
  },
  {
    id: 'fraunces',
    name: 'Fraunces',
    family: "'Fraunces Variable', 'Fraunces', 'Georgia', serif",
    sample: 'Aa',
  },
  {
    id: 'garamond',
    name: 'EB Garamond',
    family: "'EB Garamond Variable', 'EB Garamond', 'Georgia', serif",
    sample: 'Aa',
  },
]

export function typefaceFamily(id: Typeface): string {
  return (TYPEFACES.find((t) => t.id === id) ?? TYPEFACES[0]!).family
}

export interface Colorway {
  id: 'amber' | 'rust' | 'moss' | 'ink' | 'bone'
  name: string
  swatch: string
}

export interface EditorOpts {
  template: Template
  paper: Paper
  typeface: Typeface
  colorway: Colorway['id']
  accentHex: string
  density: Density
  avatars: boolean
  redact: boolean
  /** Indices of turns to include in the artifact. `undefined` means
   *  "include all turns" (the default). An empty array excludes
   *  everything — unusual but valid. */
  selected?: number[] | undefined
  /** When a selection is active, render a "⋯ N turns skipped" marker
   *  between non-adjacent kept turns so the excerpt doesn't
   *  misrepresent the original flow. */
  showGaps: boolean
  /** Top chrome — Spool wordmark and the template's section label
   *  (e.g. "§ A Transcript"). Turn off for a cleaner, title-first
   *  artifact. */
  showMasthead: boolean
  /** Bottom chrome — "Stitched on Spool" + page marker. Turn off for
   *  social-ready outputs where branding would read as clutter. */
  showColophon: boolean
}

/** The on-disk .spool file format. Version-stamped for forward compat. */
export interface SpoolDocument {
  version: 1
  conversation: Conversation
  opts: EditorOpts
  exportedAt: string
}

/** Source-color dot palette, used by the SourceChip component. */
export const SOURCE_DOTS: Record<Platform, { light: string; dark: string }> = {
  ChatGPT: { light: '#10A37F', dark: '#20C38F' },
  Claude: { light: '#6B5B8A', dark: '#9B8BBF' },
  Gemini: { light: '#1A6B9F', dark: '#4A9BD4' },
}

export const TEMPLATES: { id: Template; name: string; blurb: string }[] = [
  { id: 'chat', name: 'Chat', blurb: 'Messenger bubbles, native-app feel.' },
  { id: 'letter', name: 'Letter', blurb: 'Single-column, reading-first.' },
  { id: 'atelier', name: 'Atelier', blurb: 'Editorial two-column, serif-free.' },
  { id: 'transcript', name: 'Transcript', blurb: 'Faithful chat-like flow.' },
  { id: 'interview', name: 'Interview', blurb: 'Q&A flow, editorial-friendly.' },
]

export const COLORWAYS: Colorway[] = [
  { id: 'amber', name: 'Amber', swatch: '#C85A00' },
  { id: 'rust', name: 'Rust', swatch: '#8E3A1F' },
  { id: 'moss', name: 'Moss', swatch: '#4A6B3E' },
  { id: 'ink', name: 'Ink', swatch: '#1C1C18' },
  { id: 'bone', name: 'Bone', swatch: '#B8A98C' },
]

export const TEMPLATE_RATIO: Record<Template, { w: number; h: number }> = {
  atelier: { w: 720, h: 960 },
  letter: { w: 720, h: 960 },
  transcript: { w: 720, h: 960 },
  interview: { w: 720, h: 960 },
  chat: { w: 720, h: 960 },
}

export const DEFAULT_OPTS: EditorOpts = {
  template: 'chat',
  paper: 'bone',
  typeface: 'geist',
  colorway: 'amber',
  accentHex: '#C85A00',
  density: 'compact',
  avatars: true,
  redact: true,
  selected: undefined,
  showGaps: true,
  showMasthead: true,
  showColophon: true,
}

/** Fill in any missing fields on stored opts with defaults. We're
 *  pre-launch so no real legacy migration is needed yet — if the
 *  schema evolves in a breaking way post-launch, add mapping here.
 *  Unknown enum values are coerced to their defaults so a stale
 *  IndexedDB entry can't crash the UI. */
export function normalizeOpts(raw: unknown): EditorOpts {
  const merged = { ...DEFAULT_OPTS, ...((raw as Partial<EditorOpts>) ?? {}) }
  if (!TEMPLATES.some((t) => t.id === merged.template)) {
    merged.template = DEFAULT_OPTS.template
  }
  return merged
}
