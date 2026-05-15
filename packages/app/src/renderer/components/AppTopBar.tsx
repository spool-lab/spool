import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelLeft } from 'lucide-react'

type Props = {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  /** Page-level chrome (page title, primary action). Rendered into a
   *  flex slot to the right of the sidebar fold toggle. */
  children?: ReactNode
}

/**
 * Slim app-level chrome that sits flush with the macOS traffic lights
 * (the BrowserWindow uses titleBarStyle 'hiddenInset'). The bar's
 * background splits into sidebar / content halves that align with the
 * boundary below it, so the eye reads "left column + right column"
 * running top-to-bottom.
 */
export default function AppTopBar({ sidebarCollapsed, onToggleSidebar, children }: Props) {
  const { t } = useTranslation()
  const dragStyle = { WebkitAppRegion: 'drag' } as React.CSSProperties
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties
  const sidebarTitle = sidebarCollapsed
    ? `${t('sidebar.expand')} (⌘B)`
    : `${t('sidebar.collapse')} (⌘B)`

  return (
    <div data-testid="app-top-bar" className="relative flex-none min-h-9 select-none" style={dragStyle}>
      {/* Background: animated sidebar split + content bg flooding the
          rest of the bar (including over the right rail). The rail
          itself gets its surface tint only BELOW the bar. */}
      <div className="absolute inset-0 flex pointer-events-none" aria-hidden="true">
        <div
          className={[
            'flex-none transition-[width] duration-200 ease-out bg-warm-surface dark:bg-dark-surface',
            sidebarCollapsed ? 'w-0' : 'w-60',
          ].join(' ')}
        />
        <div className="flex-1 bg-warm-bg dark:bg-dark-bg" />
      </div>

      {/* Foreground: traffic-light gutter + fold button + sidebar-width
          spacer + page slot. */}
      <div className="relative min-h-9 flex items-stretch">
        <div className="flex-none w-[78px]" aria-hidden="true" />
        <div className="flex-none flex items-center">
          <button
            type="button"
            data-testid="sidebar-toggle"
            onClick={onToggleSidebar}
            title={sidebarTitle}
            aria-label={sidebarCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
            aria-pressed={sidebarCollapsed}
            className="flex-none inline-flex items-center justify-center w-5 h-5 rounded text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors duration-75"
            style={noDragStyle}
          >
            <PanelLeft size={13} strokeWidth={1.75} />
          </button>
        </div>
        <div
          className={[
            // No transition — animating this with sidebar's width
            // caused the slot content to re-truncate every frame.
            'flex-none',
            // Sidebar w-60 (240px); gutter+button = 106px; remainder = 134.
            sidebarCollapsed ? 'w-0' : 'w-[134px]',
          ].join(' ')}
          aria-hidden="true"
        />
        <div
          data-testid="app-top-bar-slot"
          className="flex-1 min-w-0 flex items-stretch"
          style={noDragStyle}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
