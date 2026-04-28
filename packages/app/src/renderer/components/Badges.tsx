import { getSessionSourceColor, getSessionSourceShortLabel } from '../../shared/sessionSources.js'

export function SourceBadge({ source }: { source: string }) {
  return (
    <span
      data-testid="source-badge"
      data-source={source}
      className="text-[10px] font-semibold font-mono px-1.5 py-0.5 rounded text-white"
      style={{ background: getSessionSourceColor(source) }}
    >
      {getSessionSourceShortLabel(source)}
    </span>
  )
}

