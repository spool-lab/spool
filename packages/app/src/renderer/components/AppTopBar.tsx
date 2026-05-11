import { PanelLeftClose, PanelLeft } from 'lucide-react'

type Props = {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}

/**
 * Slim app-level chrome that sits flush with the macOS traffic lights
 * (the BrowserWindow uses titleBarStyle 'hiddenInset'). The bar itself
 * is a window drag handle (-webkit-app-region: drag); interactive
 * elements opt out via no-drag.
 *
 * Currently only carries the sidebar fold toggle; reserved as the home
 * for future global affordances (page breadcrumb, search shortcut hint,
 * update notifications) so we don't end up adding chrome elsewhere.
 */
export default function AppTopBar({ sidebarCollapsed, onToggleSidebar }: Props) {
  return (
    <div
      data-testid="app-top-bar"
      className="flex-none h-9 flex items-center bg-warm-surface dark:bg-dark-surface border-b border-warm-border dark:border-dark-border select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Traffic-light gutter. macOS draws the close/min/max buttons here;
          we just hold the space. */}
      <div className="flex-none w-[78px]" aria-hidden="true" />

      <button
        type="button"
        data-testid="sidebar-toggle"
        onClick={onToggleSidebar}
        title={sidebarCollapsed ? 'Expand sidebar (⌘B)' : 'Collapse sidebar (⌘B)'}
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-pressed={sidebarCollapsed}
        className="flex-none inline-flex items-center justify-center w-7 h-7 rounded text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors duration-75"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {sidebarCollapsed ? (
          <PanelLeft size={15} strokeWidth={1.75} />
        ) : (
          <PanelLeftClose size={15} strokeWidth={1.75} />
        )}
      </button>

      <div className="flex-1" aria-hidden="true" />
    </div>
  )
}
