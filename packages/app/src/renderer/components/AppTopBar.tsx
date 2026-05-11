import { PanelLeftClose, PanelLeft } from 'lucide-react'

type Props = {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}

/**
 * Slim app-level chrome that sits flush with the macOS traffic lights
 * (the BrowserWindow uses titleBarStyle 'hiddenInset'). The bar splits
 * into two halves that align with the sidebar / content boundary
 * below it, so the eye reads "left column + right column" running
 * top-to-bottom instead of a separate horizontal bar.
 *
 * Currently only carries the sidebar fold toggle; reserved as the home
 * for future global affordances (page breadcrumb, search shortcut hint,
 * update notifications) so we don't end up adding chrome elsewhere.
 */
export default function AppTopBar({ sidebarCollapsed, onToggleSidebar }: Props) {
  const dragStyle = { WebkitAppRegion: 'drag' } as React.CSSProperties
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

  const FoldButton = (
    <button
      type="button"
      data-testid="sidebar-toggle"
      onClick={onToggleSidebar}
      title={sidebarCollapsed ? 'Expand sidebar (⌘B)' : 'Collapse sidebar (⌘B)'}
      aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-pressed={sidebarCollapsed}
      className="flex-none inline-flex items-center justify-center w-7 h-7 rounded text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors duration-75"
      style={noDragStyle}
    >
      {sidebarCollapsed ? (
        <PanelLeft size={15} strokeWidth={1.75} />
      ) : (
        <PanelLeftClose size={15} strokeWidth={1.75} />
      )}
    </button>
  )

  return (
    <div data-testid="app-top-bar" className="flex-none h-9 flex select-none">
      {!sidebarCollapsed && (
        <div
          className="w-60 flex-none flex items-center bg-warm-surface dark:bg-dark-surface"
          style={dragStyle}
        >
          {/* Traffic-light gutter — macOS paints close/min/max here. */}
          <div className="flex-none w-[78px]" aria-hidden="true" />
          {FoldButton}
        </div>
      )}
      <div
        className="flex-1 flex items-center bg-warm-bg dark:bg-dark-bg"
        style={dragStyle}
      >
        {sidebarCollapsed && (
          <>
            <div className="flex-none w-[78px]" aria-hidden="true" />
            {FoldButton}
          </>
        )}
      </div>
    </div>
  )
}
