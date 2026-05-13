/**
 * FlowStrip — bottom strip showing per-pane state + events/min.
 *
 * Subscribes to the same SSE endpoint as Home FlowStrip (agent C).
 * Stubbed: renders a placeholder bar with pane IDs until the SSE
 * flow-strip endpoint is available.
 */
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { PaneState } from '@/stores/cockpit-store'

type PaneStatus = 'idle' | 'thinking' | 'tool' | 'error'

type PaneMetric = {
  paneId: string
  status: PaneStatus
  eventsPerMin: number
}

const STATUS_COLOR: Record<PaneStatus, string> = {
  idle: 'bg-primary-400',
  thinking: 'bg-amber-400 animate-pulse',
  tool: 'bg-blue-400',
  error: 'bg-red-400',
}

const STATUS_LABEL: Record<PaneStatus, string> = {
  idle: 'idle',
  thinking: 'thinking',
  tool: 'tool',
  error: 'error',
}

function PaneChip({ metric, label }: { metric: PaneMetric; label: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded border border-primary-300 bg-primary-100 px-2 py-1">
      <span
        className={cn('size-2 rounded-full', STATUS_COLOR[metric.status])}
      />
      <span className="text-[11px] text-primary-700">{label}</span>
      <span className="text-[10px] text-primary-400">
        {metric.eventsPerMin > 0 ? `${metric.eventsPerMin}/min` : '–'}
      </span>
    </div>
  )
}

type FlowStripProps = {
  panes: Array<PaneState>
}

export function FlowStrip({ panes }: FlowStripProps) {
  const [metrics, setMetrics] = useState<Record<string, PaneMetric>>(() =>
    Object.fromEntries(
      panes.map((p) => [
        p.id,
        { paneId: p.id, status: 'idle' as PaneStatus, eventsPerMin: 0 },
      ]),
    ),
  )
  const sseRef = useRef<EventSource | null>(null)
  const [sseConnected, setSseConnected] = useState(false)

  // Keep metrics in sync when panes array changes
  useEffect(
    function syncPanes() {
      setMetrics((prev) => {
        const next = { ...prev }
        for (const p of panes) {
          if (!next[p.id]) {
            next[p.id] = {
              paneId: p.id,
              status: 'idle',
              eventsPerMin: 0,
            }
          }
        }
        // Remove stale pane metrics
        for (const id of Object.keys(next)) {
          if (!panes.find((p) => p.id === id)) delete next[id]
        }
        return next
      })
    },
    [panes],
  )

  // Attempt SSE connection to flow-strip endpoint (agent C builds this)
  useEffect(function connectSse() {
    let es: EventSource | null = null
    try {
      es = new EventSource('/api/flow/strip-sse')
      sseRef.current = es

      es.onopen = () => setSseConnected(true)
      es.onerror = () => {
        setSseConnected(false)
        // Don't retry aggressively — just mark as stub
        es?.close()
      }

      es.addEventListener('pane-metric', (evt: MessageEvent) => {
        try {
          const data = JSON.parse((evt as MessageEvent).data as string) as PaneMetric
          setMetrics((prev) => ({ ...prev, [data.paneId]: data }))
        } catch {
          // ignore
        }
      })
    } catch {
      // SSE not available yet — running in stub mode
    }

    return () => {
      es?.close()
      sseRef.current = null
    }
  }, [])

  return (
    <div className="flex items-center gap-2 border-t border-primary-300 bg-primary-50 px-4 py-1.5">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-primary-400">
        Flow
      </span>
      {!sseConnected ? (
        <span className="text-[10px] text-primary-400 italic">
          (SSE stub — flow strip pending agent C)
        </span>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {panes.map((pane, idx) => {
          const metric = metrics[pane.id] ?? {
            paneId: pane.id,
            status: 'idle' as PaneStatus,
            eventsPerMin: 0,
          }
          return (
            <PaneChip
              key={pane.id}
              metric={metric}
              label={`P${idx + 1} · ${pane.type.toUpperCase()}`}
            />
          )
        })}
      </div>
    </div>
  )
}
