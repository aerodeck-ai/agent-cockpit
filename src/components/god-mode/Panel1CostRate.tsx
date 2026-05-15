/**
 * Panel1CostRate
 *
 * Subscribes to /api/cost-rate/sse. Shows:
 * - Today's total cost
 * - $/hr rate
 * - Warn/kill threshold bar
 */
import { useEffect, useRef, useState } from 'react'

interface CostRatePayload {
  ts: number
  today_view_usd: number
  today_real_usd: number
  rate_view_usd_per_hr: number
  rate_real_usd_per_hr: number
  warn_threshold: number
  kill_threshold: number
  model_breakdown: Array<{ model: string; est_cost_usd: number }>
}

export function Panel1CostRate() {
  const [data, setData] = useState<CostRatePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource('/api/cost-rate/sse')
    esRef.current = es

    es.addEventListener('cost-rate', (e) => {
      try {
        setData(JSON.parse(e.data) as CostRatePayload)
        setError(null)
      } catch {
        // ignore parse errors
      }
    })

    es.onerror = () => setError('SSE disconnected — reconnecting…')

    return () => {
      es.close()
    }
  }, [])

  const warnPct = data
    ? Math.min(100, (data.today_view_usd / data.warn_threshold) * 100)
    : 0
  const killPct = data
    ? Math.min(100, (data.today_view_usd / data.kill_threshold) * 100)
    : 0

  const barColor =
    killPct >= 90
      ? 'bg-red-500'
      : warnPct >= 90
        ? 'bg-amber-400'
        : 'bg-emerald-400'

  return (
    <div className="rounded-xl border border-primary-200 bg-primary-50/85 p-4 backdrop-blur-xl dark:border-neutral-700 dark:bg-neutral-900/80">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink/50">
        Cost Rate
      </h3>

      {error && (
        <p className="mb-2 text-xs text-amber-500">{error}</p>
      )}

      <div className="mb-4 flex items-end gap-4">
        <div>
          <p className="text-2xl font-bold tabular-nums text-ink">
            ${data ? data.today_view_usd.toFixed(2) : '—'}
          </p>
          <p className="text-xs text-ink/50">today</p>
        </div>
        <div>
          <p className="text-lg font-semibold tabular-nums text-ink">
            ${data ? data.rate_view_usd_per_hr.toFixed(2) : '—'}/hr
          </p>
          <p className="text-xs text-ink/50">rate</p>
        </div>
      </div>

      {/* Threshold bar */}
      {data && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-ink/40">
            <span>$0</span>
            <span className="text-amber-500">warn ${data.warn_threshold}</span>
            <span className="text-red-500">kill ${data.kill_threshold}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-black/10 dark:bg-white/10">
            <div
              className={`h-2 rounded-full transition-all ${barColor}`}
              style={{ width: `${killPct}%` }}
            />
          </div>
          <p className="mt-1 text-right text-xs text-ink/40">
            {killPct.toFixed(0)}% of kill threshold
          </p>
        </div>
      )}

      {/* Model breakdown */}
      {data && data.model_breakdown.length > 0 && (
        <div className="mt-3 space-y-1">
          {data.model_breakdown.slice(0, 4).map((row) => (
            <div key={row.model} className="flex justify-between text-xs text-ink/60">
              <span className="truncate max-w-[150px]">{row.model}</span>
              <span className="tabular-nums">${row.est_cost_usd.toFixed(4)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
