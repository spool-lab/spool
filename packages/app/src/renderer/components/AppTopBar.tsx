import { PanelLeft } from 'lucide-react'

type Props = {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}

/**
 * Slim app-level chrome that sits flush with the macOS traffic lights
 * (the BrowserWindow uses titleBarStyle 'hiddenInset'). The bar's
 * background splits into two halves that align with the sidebar /
 * content boundary below it, so the eye reads "left column + right
 * column" running top-to-bottom instead of a separate horizontal bar.
 *
 * The fold toggle is positioned in normal flow at a fixed x (78px,
 * just past the traffic-light gutter) so it stays planted during the
 * width animation; the colored halves sit on an absolute background
 * layer underneath and animate without dragging the button along.
 *
 * Currently only carries the sidebar fold toggle; reserved as the home
 * for future global affordances (page breadcrumb, search shortcut hint,
 * update notifications).
 */
export default function AppTopBar({ sidebarCollapsed, onToggleSidebar }: Props) {
  const dragStyle = { WebkitAppRegion: 'drag' } as React.CSSProperties
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

  return (
    <div data-testid="app-top-bar" className="relative flex-none h-9 select-none" style={dragStyle}>
      {/* Background: animated sidebar/content split, behind the button. */}
      <div className="absolute inset-0 flex pointer-events-none" aria-hidden="true">
        <div
          className={[
            'flex-none transition-[width] duration-200 ease-out bg-warm-surface dark:bg-dark-surface',
            sidebarCollapsed ? 'w-0' : 'w-60',
          ].join(' ')}
        />
        <div className="flex-1 bg-warm-bg dark:bg-dark-bg" />
      </div>

      {/* Foreground: traffic-light gutter + fold button, planted in place. */}
      <div className="relative h-full flex items-center">
        <div className="flex-none w-[78px]" aria-hidden="true" />
        <button
          type="button"
          data-testid="sidebar-toggle"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? 'Show sidebar (⌘B)' : 'Hide sidebar (⌘B)'}
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-pressed={sidebarCollapsed}
          className="flex-none inline-flex items-center justify-center w-7 h-7 rounded text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors duration-75"
          style={noDragStyle}
        >
          <PanelLeft size={15} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
