import type { ReactNode } from 'react'
import AppTopBar from './AppTopBar.js'

type Props = {
  /** Left sidebar (Library / Shares / Projects rail). The caller
   *  owns this so each page can pass the same Sidebar instance with
   *  its app-wide handlers wired up. */
  sidebar: ReactNode
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  /** Page chrome that gets portaled into the top bar's flex slot
   *  (back arrow, title, primary action buttons). Pass null on pages
   *  that don't need any. */
  topBar?: ReactNode
  /** Page-level right column (e.g. share editor's style picker). Lives
   *  as a full-height sibling of the (sidebar + content) sub-tree, so
   *  its top edge sits at the window top rather than below AppTopBar.
   *  Pass null when the page doesn't want a right column. */
  rightPanel?: ReactNode
  /** Controls the right column's animated width. */
  rightPanelOpen?: boolean
  /** Page body content — rendered in the central content area. */
  children: ReactNode
}

/**
 * Three-column layout shell: [sidebar | content | rightPanel]. The
 * AppTopBar sits on top of (sidebar + content) only, so the right
 * column extends from window top to bottom and its first content row
 * can align vertically with the top bar's row.
 *
 * Slot prop pattern — callers pass JSX nodes for each slot instead of
 * portaling content via DOM ids. Keeps the layout's contract typed
 * and the render tree matching the DOM tree.
 */
export default function PageLayout({
  sidebar,
  sidebarCollapsed,
  onToggleSidebar,
  topBar,
  rightPanel,
  rightPanelOpen = false,
  children,
}: Props) {
  return (
    <div className="relative flex h-screen bg-warm-bg dark:bg-dark-bg text-warm-text dark:text-dark-text">
      {/* Main column: AppTopBar over (sidebar + content). Shrinks
          horizontally when the right column is open. */}
      <div className="flex flex-col flex-1 min-w-0">
        <AppTopBar sidebarCollapsed={sidebarCollapsed} onToggleSidebar={onToggleSidebar}>
          {topBar}
        </AppTopBar>
        <div className="flex flex-1 min-h-0">
          <div
            className="flex-none overflow-hidden"
            style={{
              width: sidebarCollapsed ? 0 : 240,
              transition: 'width 200ms ease-out',
            }}
            aria-hidden={sidebarCollapsed}
          >
            {sidebar}
          </div>
          <div className="relative flex flex-col flex-1 min-w-0">
            {children}
          </div>
        </div>
      </div>

      {/* Right column — full-height sibling of the main column.
          Width animates to 0 when collapsed so it slides out cleanly.
          Inline style transition (rather than Tailwind's
          transition-[width]) is the only one that reliably animates
          across all React/Tailwind v4 builds. */}
      <div
        className="flex-none overflow-hidden"
        style={{
          width: rightPanelOpen ? 280 : 0,
          transition: 'width 200ms ease-out',
        }}
        aria-hidden={!rightPanelOpen}
      >
        {rightPanel}
      </div>
    </div>
  )
}
