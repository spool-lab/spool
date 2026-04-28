# Design System — Spool

## Product Context
- **What this is:** A local search engine for your thinking — an Electron macOS app that indexes your AI sessions (Claude Code, Codex, Gemini) and lets you search them instantly.
- **Who it's for:** Developers who think with AI daily and have accumulated hundreds of sessions across multiple tools. The persona has re-explained the same context to AI agents dozens of times.
- **Space/industry:** Developer productivity / local-first tooling. Peers: Raycast, Spotlight, Obsidian, Perplexity — but none of them do this.
- **Project type:** macOS Electron app — compact utility window, not a document editor or dashboard.
- **Core positioning:** "A local Google for your thinking." Search is the entire product. Everything else (session sources, AI mode) is in service of the search box.

## Aesthetic Direction
- **Direction:** Warm Index — library-warm, not terminal-cold. Function-first but with personality.
- **Decoration level:** Minimal. Typography and color warmth carry everything. No gradients, no decorative blobs.
- **Mood:** The feeling of finding something in a personal archive under a warm lamp. Intimate, fast, trustworthy. Not corporate, not clinical.
- **Differentiation:** Every competitor (Raycast, Alfred, DevonThink) uses cold grays or pure blacks. Spool's warm near-blacks and amber accent are a deliberate departure — the product deals with memory and personal thinking, and should feel accordingly.

## Layout Philosophy
- **Core principle:** The search box is the universe's center. Everything else orbits it.
- **Home state:** Google homepage feel — large centered logo, large centered search box, source chips below as ambient context. Empty space is intentional — it creates gravity toward the search box.
- **Results state:** Bar compresses to top (logo shrinks to `S.`), results fill the page. Transition echoes Google's home→results animation.
- **Approach:** Compact utility. Window width ~720px. Not a document, not a dashboard.
- **Alignment:** Left-aligned results. Centered only on the home/idle screen.
- **Max content width:** 720px (window width)
- **Border radius:** pill (9999px) for search bar / 10px for cards / 8px for inputs / 6px for buttons / 4px for badges

## Typography
- **Logo/Display:** Geist Sans 700 — large, tight letter-spacing (−0.04em), the period after "Spool" in accent color.
- **UI / Body:** Geist Sans 400/500/600 — readable at 11–15px, developer-native, not overused. Do NOT use Inter, Roboto, or system-ui as primary.
- **Fragment content:** Geist Mono 400/500 — all indexed content (conversation fragments, URLs, code) rendered in monospace. This visually separates "Spool UI" from "your content."
- **Counts / paths:** Geist Mono with `font-variant-numeric: tabular-nums`.
- **Loading:** Google Fonts CDN: `https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap`

### Type Scale
| Role | Size | Weight | Font |
|------|------|--------|------|
| Logo (home) | 48px | 700 | Geist Sans |
| Wordmark (results bar) | 16px | 700 | Geist Sans |
| Search input (home) | 15px | 400 | Geist Sans |
| Search input (results) | 13.5px | 400 | Geist Sans |
| Body / result actions | 13px | 400/500 | Geist Sans |
| Fragment content | 12px | 400 | Geist Mono |
| Secondary / meta | 11px | 400/500 | Geist Sans |
| Labels / caps | 11px | 500 | Geist Sans, letter-spacing 0.06em |
| Badges / paths | 10–11px | 500/600 | Geist Mono |

## Color
- **Approach:** Restrained — one amber accent, warm neutrals, color is rare and meaningful.

### Light Mode
| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#FAFAF8` | App background — warm off-white, never pure white |
| `--surface` | `#F4F4F0` | Cards, titlebar, status bar |
| `--surface2` | `#EEEEE9` | Hovered surfaces, mode pill background |
| `--border` | `#E8E8E2` | Dividers, card borders |
| `--border2` | `#D8D8D0` | Input borders, focused-adjacent |
| `--text` | `#1C1C18` | Primary text |
| `--muted` | `#6B6B60` | Secondary text, labels |
| `--faint` | `#ADADAA` | Placeholder text, disabled state |
| `--accent` | `#C85A00` | Primary accent — amber/orange |
| `--accent-bg` | `#FFF3E8` | Accent-tinted backgrounds (selected state, AI answer) |

### Dark Mode
| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#141410` | Warm near-black, never pure `#000` |
| `--surface` | `#1C1C18` | Cards, titlebar, status bar |
| `--surface2` | `#242420` | Hovered surfaces |
| `--border` | `#2E2E28` | Dividers |
| `--border2` | `#3A3A34` | Input borders |
| `--text` | `#F2F2EC` | Primary text — warm near-white |
| `--muted` | `#8A8A80` | Secondary text |
| `--faint` | `#505048` | Placeholder, disabled |
| `--accent` | `#F07020` | Accent brightened for dark — still amber, never blue |
| `--accent-bg` | `#2A1800` | Accent backgrounds on dark |

### Source Badge Colors
Each data source has a fixed color used consistently across badges, chips, and dots.

| Source | Light | Dark |
|--------|-------|------|
| Claude Code | `#6B5B8A` | `#9B8BBF` |
| Twitter / X | `#3A3A3A` | `#888880` |
| GitHub | `#555555` | `#999990` |
| YouTube | `#B22222` | `#D44444` |
| ChatGPT | `#10A37F` | `#20C38F` |
| Codex CLI | `#1A6B3C` | `#40C87A` |

### Semantic States
| State | Light | Dark |
|-------|-------|------|
| Success / synced | `#4ADE80` (dot) | same |
| Warning / stale | `#FBBF24` (dot) | same |
| Error / disconnected | `#F87171` (dot) | same |

## Spacing
- **Base unit:** 4px
- **Density:** Compact. This is a utility tool, not a document editor.
- **Scale:** 2 · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48
- **Result item padding:** 10px 20px
- **Search bar padding:** 12px 16px (home) / 7px 14px (results bar)
- **Section padding:** 20px 24px (panels)

## Motion
- **Approach:** Minimal-functional — only transitions that aid comprehension.
- **Home → Results:** Search bar translates from center to top, logo shrinks from 48px wordmark to 16px `S.`. Duration 200ms, ease-in-out.
- **Results appear:** Fade + translate-y(4px) → 0. Duration 150ms, ease-out, staggered 20ms per item.
- **Mode switch (Fast ↔ AI):** Content area crossfade 200ms.
- **Hover states:** Background 80ms, border-color 80ms — fast enough to feel instant.
- **Nothing else moves.** No scroll-driven animations, no decorative motion.

## UI States

### Search Bar
- **Idle (home):** Pill shape, 9999px radius, full-width up to 520px, centered. Subtle box-shadow. Placeholder `Search my thinking…`
- **Focused (home):** Border changes to `--accent`, box-shadow brightens with accent tint.
- **Results bar:** Same bar, compressed height, left-aligned beside `S.` wordmark.
- **Mode toggle:** Pill-within-pill. Active mode gets white bg + shadow. `⚡ Fast` | `🤖 AI` — replace emoji with vector icons in implementation.

### Result Items
- **Default:** No background, left-padded 20px.
- **Hovered:** `--surface` background.
- **Selected (keyboard):** `--accent-bg` background.
- **Action buttons:** Appear on hover/selection only (opacity 0 → 1). Primary action (Resume/Continue) uses accent border + color.

### Source Chips (home screen)
- Pill shape, `--surface` background, source dot + name + count.
- One chip per agent source (Claude / Codex / Gemini).
- Clicking a chip opens Settings → Sources tab filtered to that source.

### Sources Panel (Settings tab)
- Lists the three built-in agent sources with their session counts.
- Status: `auto` label + green dot when watcher is healthy.

### AI Answer Card
- Left border: 3px solid `--accent`. Background: `--accent-bg`.
- Header: `🤖 Claude says` label in accent + `via ACP · local · [agent-name]` chip on the right (always show "local" — this is a trust signal).
- CTA button: outline style with accent color, not filled — keeps hierarchy below the answer.
- Replace `🤖` emoji with vector icon in implementation.

### Status Bar
- Always visible, 30px height, `--surface` background.
- Left: colored dot (green/yellow/red) + synced item count + last sync time.
- Right: `Sources ⊕` button (replace `⊕` with vector icon).
- Dot is green when sync is healthy; yellow during active sync; red only on filesystem watcher errors.

## Icons
- **Library:** Lucide React (`lucide-react`) — consistent stroke weight, MIT licensed.
- **Search:** `Search` icon (Lucide)
- **Source indicators:** Replace all emoji placeholder icons with purpose-drawn SVGs or Lucide equivalents. Emoji are placeholders only in mockups.
- **Mode toggle:** Custom SVG — lightning bolt (⚡ Fast) and a minimal "brain" or sparkle (AI mode).
- **Settings:** `Settings2` (Lucide)
- **Status dots:** No icon — pure colored circle via CSS.
- **Stroke width:** 1.5px at 16px, 1.5px at 14px. Never bold/filled for UI chrome.

## AI Search (ACP Integration)
- Mode is toggled in the search bar — same box, different backend.
- Agent selector lives in the results topbar (right side): `Claude Code ▾` — dropdown lists all ACP-connected agents.
- Status bar shows `🤖 ACP · [agent-name] · local` when AI mode is active. The word "local" is always present — it reinforces the trust proposition.
- AI answer renders above source fragments. Sources are always shown — the AI answer without evidence would undermine trust.
- "Continue in Claude Code →" CTA uses outline button style, opens a new Claude Code session with the synthesized answer + fragments as context.

## First-Person Language
All result metadata uses first-person framing. The product is about YOUR thinking.

| Do | Don't |
|----|-------|
| "You discussed this · Mar 15" | "Claude Code · Mar 15" |
| "You saved this" | "Twitter bookmark" |
| "You starred this" | "GitHub · 3 days ago" |
| "You discussed this in ChatGPT" | "ChatGPT session" |

## Anti-patterns — Never Do
- Purple/violet gradients as accent
- 3-column feature grid with icons in colored circles
- Centered everything in results state (only center on home)
- Uniform bubbly border-radius on all elements (search bar is pill; buttons are 6px; badges are 4px)
- Gradient buttons
- Cold grays (`#0A0A0A`, `#111111`) — always use warm near-blacks
- Inter, Roboto, or system fonts as primary typeface
- Emoji in production UI — replace all with vector icons

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-27 | Warm amber accent `#C85A00` | Every competitor is cold gray/blue. Amber evokes memory, archive, warmth — fits "personal thinking" positioning. Unique in the category. |
| 2026-03-27 | Google-homepage idle state (centered logo + search) | The search box IS the product. Empty space creates gravity. Google proved this mental model works at scale. |
| 2026-03-27 | Geist Mono for fragment content | Visually separates "Spool UI chrome" from "your indexed content." Monospace signals: this is real data, not a label. |
| 2026-03-27 | Source chips below home search bar | Sources are first-class — not buried in settings. Chips show what's in your index at a glance and invite expansion. |
| 2026-03-27 | First-person result language ("You discussed this") | Differentiates from a generic log viewer. Makes the product feel like it knows you. |
| 2026-03-27 | "via ACP · local" label on AI answers | Trust signal — users need to see that inference is local, not routed to a cloud. Core to local-first positioning. |
| 2026-03-27 | Emoji as placeholder icons only | Emojis are fast to prototype with but inconsistent across platforms. All production icons must be vector (Lucide or custom SVG). |
