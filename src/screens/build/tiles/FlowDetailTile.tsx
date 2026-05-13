/**
 * FlowDetailTile — filtered slice of /observe Flow for one pane.
 *
 * Renders an iframe to /flow?pane=<paneId> so the existing Flow UI
 * can be filtered without duplicating event-stream parsing.
 *
 * Falls back to a stub when no paneId is provided.
 */

type FlowDetailTileProps = {
  paneId: string
}

export function FlowDetailTile({ paneId }: FlowDetailTileProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-primary-300 bg-primary-100 px-3 py-1.5">
        <span className="text-xs text-primary-500">
          Flow detail — pane <code className="font-mono">{paneId.slice(0, 12)}</code>
        </span>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <iframe
          src={`/flow?pane=${encodeURIComponent(paneId)}`}
          className="h-full w-full border-none"
          title={`Flow — ${paneId}`}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  )
}
