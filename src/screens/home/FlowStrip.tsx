/**
 * FlowStrip — ambient last-60s rolling event list.
 *
 * Polls /api/flow/events?hours=1&limit=20 every 15s as a stub.
 * When /api/sse/events is available (Part C), switch the hook to SSE.
 *
 * "→ full stream in /observe" link at bottom.
 */

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

type TraceEvent = {
  id: number
  ts: string
  source: string
  kind: string
  status: string
  label: string
  detail?: string | null
}

type FlowResponse = {
  events: TraceEvent[]
  count: number
}

const KIND_DOT: Record<string, string> = {
  info: 'flow-dot-info',
  warning: 'flow-dot-warn',
  error: 'flow-dot-error',
  critical: 'flow-dot-error',
  success: 'flow-dot-success',
}

function dotClass(kind: string): string {
  return KIND_DOT[kind?.toLowerCase()] ?? 'flow-dot-info'
}

function fmtTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return ts
  }
}

/** Last-60s events are the tail of the last-1h window */
function filterLast60s(events: TraceEvent[]): TraceEvent[] {
  const cutoff = Date.now() - 60 * 1000
  return events.filter((e) => new Date(e.ts).getTime() > cutoff)
}

export function FlowStrip() {
  const { data, isLoading } = useQuery<FlowResponse>({
    queryKey: ['flow', 'events', 'strip'],
    queryFn: async () => {
      const resp = await fetch('/api/flow/events?hours=1&limit=50')
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return resp.json()
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  })

  const recent = data ? filterLast60s(data.events).slice(-10).reverse() : []

  return (
    <div className="flow-strip">
      <div className="flow-strip-header">
        <span className="flow-strip-label">Flow state</span>
        <span className="flow-strip-sublabel">last 60s</span>
      </div>

      {isLoading && (
        <div className="flow-strip-skeleton">
          <div className="flow-strip-skeleton-row" />
          <div className="flow-strip-skeleton-row short" />
        </div>
      )}

      {!isLoading && recent.length === 0 && (
        <p className="flow-strip-empty">No events in last 60s</p>
      )}

      {!isLoading && recent.length > 0 && (
        <ul className="flow-strip-list">
          {recent.map((event) => (
            <li key={event.id} className="flow-strip-row">
              <span className="flow-strip-time">{fmtTime(event.ts)}</span>
              <span className={`flow-dot ${dotClass(event.kind)}`} aria-hidden />
              <span className="flow-strip-source">{event.source}</span>
              <span className="flow-strip-label-text">{event.label}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flow-strip-footer">
        <Link to="/flow" className="flow-strip-observe-link">
          → full stream in /observe
        </Link>
      </div>
    </div>
  )
}
