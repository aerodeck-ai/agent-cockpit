/**
 * LiveFlowHome — /flow route screen.
 * Ported from ~/atc/components/LiveFlowHome.tsx
 * Wired to /api/flow/events (hermes_findings) instead of ATC chat traces.
 * Adapted for TanStack Start / cockpit conventions.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import ExecutionFlowCanvas, { type TraceEvent } from './ExecutionFlowCanvas'

type TraceSummary = {
  trace_id: string
  started_at: string
  updated_at: string
  event_count: number
  title?: string | null
  worst_status?: string | null
}

function statusClass(status?: string): string {
  if (status === 'ok')
    return 'border-emerald-400/70 bg-emerald-400/10 text-emerald-100 shadow-[0_0_20px_rgba(52,211,153,.15)]'
  if (status === 'running')
    return 'border-cyan-300/80 bg-cyan-300/10 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,.25)] animate-pulse'
  if (status === 'cooldown')
    return 'border-amber-300/80 bg-amber-300/10 text-amber-100'
  if (status === 'error')
    return 'border-rose-300/80 bg-rose-300/10 text-rose-100'
  if (status === 'blocked')
    return 'border-purple-300/80 bg-purple-300/10 text-purple-100'
  return 'border-zinc-800 bg-zinc-950/70 text-zinc-400'
}

function TelemetryPanel({
  traceId,
  events,
}: {
  traceId: string | null
  events: TraceEvent[]
}) {
  const latest = events[events.length - 1]
  const modelEvent = [...events]
    .reverse()
    .find((e) => e.model_req || e.model_used || e.provider)
  const tokenEvent = [...events]
    .reverse()
    .find((e) => e.input_tokens != null || e.output_tokens != null)
  const inputTokens = tokenEvent?.input_tokens ?? null
  const outputTokens = tokenEvent?.output_tokens ?? null
  const totalTokens =
    inputTokens != null || outputTokens != null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : null
  const tokenSource = tokenEvent?.source
    ? `source: ${tokenEvent.source}`
    : 'pending'

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="text-[10px] uppercase tracking-[0.32em] text-cyan-300/70">
        fuel + provenance
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-5">
        <div className="rounded-xl border border-zinc-800 bg-black/20 p-3">
          <div className="text-[10px] text-zinc-500">trace</div>
          <div className="mt-1 truncate text-xs text-zinc-200">
            {traceId ?? 'no active trace'}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-black/20 p-3">
          <div className="text-[10px] text-zinc-500">model</div>
          <div className="mt-1 text-xs text-zinc-200">
            {modelEvent?.model_used ?? modelEvent?.model_req ?? 'pending'}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-black/20 p-3">
          <div className="text-[10px] text-zinc-500">live tokens</div>
          <div className="mt-1 text-lg font-semibold text-amber-200">
            {totalTokens ?? '—'}
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">{tokenSource}</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-black/20 p-3">
          <div className="text-[10px] text-zinc-500">in / out</div>
          <div className="mt-1 text-xs text-zinc-200">
            {inputTokens ?? '—'} / {outputTokens ?? '—'}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-black/20 p-3">
          <div className="text-[10px] text-zinc-500">latest</div>
          <div className="mt-1 text-xs text-zinc-200">
            {latest ? `${latest.source}:${latest.status}` : 'idle'}
          </div>
        </div>
      </div>
      <div className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1">
        {events.length === 0 && (
          <div className="text-xs text-zinc-500">
            Hermes events load from hermes_findings. The canvas renders the
            7-stage skeleton even when empty.
          </div>
        )}
        {events.map((e) => (
          <div
            key={e.id}
            className="rounded-lg border border-zinc-800 bg-black/20 px-3 py-2 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-zinc-100">
                {e.kind} · {e.label}
              </span>
              <span className="text-zinc-500">
                {e.source} · {e.status}
              </span>
            </div>
            {e.detail && (
              <div className="mt-1 line-clamp-2 text-zinc-400">{e.detail}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function buildSummaries(events: TraceEvent[]): TraceSummary[] {
  const map = new Map<string, TraceSummary>()
  for (const e of events) {
    const existing = map.get(e.trace_id)
    if (!existing) {
      map.set(e.trace_id, {
        trace_id: e.trace_id,
        started_at: e.ts,
        updated_at: e.ts,
        event_count: 1,
        title: e.label,
        worst_status: e.status,
      })
    } else {
      existing.event_count += 1
      if (e.ts > existing.updated_at) {
        existing.updated_at = e.ts
        existing.title = e.label
      }
      if (e.status === 'error') existing.worst_status = 'error'
      else if (e.status === 'blocked' && existing.worst_status !== 'error')
        existing.worst_status = 'blocked'
    }
  }
  return [...map.values()].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  )
}

export default function LiveFlowHome() {
  const [allEvents, setAllEvents] = useState<TraceEvent[]>([])
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const load = async () => {
      try {
        const r = await fetch('/api/flow/events', { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        if (!mounted.current) return
        const events = (data.events ?? []) as TraceEvent[]
        setAllEvents(events)
        setLoadError(null)
        setLoading(false)
        if (activeTraceId === null && events.length > 0) {
          // deliberately leave as null = "all events" view
        }
      } catch (err) {
        if (!mounted.current) return
        setLoadError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    }
    load()
    const id = setInterval(load, 10_000)
    return () => {
      mounted.current = false
      clearInterval(id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const summaries = useMemo(() => buildSummaries(allEvents), [allEvents])

  const visibleEvents = useMemo(() => {
    if (!activeTraceId) return allEvents.slice(-50)
    return allEvents.filter((e) => e.trace_id === activeTraceId)
  }, [allEvents, activeTraceId])

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#07070d] text-zinc-100">
      <div className="border-b border-zinc-800 bg-zinc-950/90 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.35em] text-cyan-300/70">
              cockpit · live flow canvas · hermes_findings
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-white">
              God Mode loop, visibly top-to-bottom
            </h1>
            <p className="mt-1 max-w-3xl text-xs text-zinc-400">
              7-stage execution spine: intake, scope/memory, plan, dispatch,
              tool/model spans, verification, delivery. Wired to real Hermes
              findings events.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {loading && (
              <span className="text-[10px] text-zinc-500 animate-pulse">
                loading…
              </span>
            )}
            {loadError && (
              <span className="rounded border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-[10px] text-rose-300">
                {loadError} — canvas uses cached/empty state
              </span>
            )}
            <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100">
              {allEvents.length} events · {summaries.length} traces (last 24h)
            </div>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 xl:grid-cols-[300px_1fr]">
        <section className="flex min-h-0 flex-col rounded-2xl border border-zinc-800 bg-zinc-950/80 overflow-hidden">
          <div className="border-b border-zinc-800 px-3 py-2">
            <div className="text-xs font-semibold text-zinc-100">
              Recent traces
            </div>
            <div className="text-[10px] text-zinc-500">
              Grouped by 1h bucket from hermes_findings
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {summaries.length === 0 && !loading && (
              <div className="p-3 text-xs text-zinc-500">
                No events found in last 24h. Canvas renders expected skeleton.
              </div>
            )}
            <button
              onClick={() => setActiveTraceId(null)}
              className={`w-full rounded-lg border px-2 py-2 text-left text-xs transition ${
                activeTraceId === null
                  ? 'border-cyan-300/60 bg-cyan-300/10 text-cyan-50'
                  : 'border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:border-zinc-600'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">All events (last 50)</span>
                <span className="text-[10px] text-zinc-500">
                  {allEvents.length}
                </span>
              </div>
            </button>
            {summaries.slice(0, 20).map((t) => (
              <button
                key={t.trace_id}
                onClick={() => setActiveTraceId(t.trace_id)}
                className={`w-full rounded-lg border px-2 py-2 text-left text-xs transition ${
                  activeTraceId === t.trace_id
                    ? 'border-cyan-300/60 bg-cyan-300/10 text-cyan-50'
                    : 'border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:border-zinc-600'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">
                    {t.title || t.trace_id}
                  </span>
                  <span className="text-[10px] text-zinc-500 shrink-0">
                    {t.event_count}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[10px] text-zinc-500">
                  {t.trace_id} · {t.worst_status ?? 'ok'}
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="min-h-0 space-y-4 overflow-y-auto">
          <div className="rounded-2xl border border-indigo-400/20 bg-indigo-400/10 p-3 text-xs leading-relaxed text-indigo-50">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.28em] text-indigo-200/80">
              research synthesis applied
            </div>
            <div>
              LangSmith, W&amp;B Weave, MLflow and Phoenix converge on traces as
              the source of truth: runs, spans, tools, model calls, evals and
              errors. LangGraph Studio adds state/step debugging. Claude
              Code/Hermes says keep the terminal/message workflow, but make the
              hidden loop visible. This view is a vertical operating loop, with
              observed resources off to the side until a trace claims them.
            </div>
          </div>
          <ExecutionFlowCanvas events={visibleEvents} />
          <TelemetryPanel traceId={activeTraceId} events={visibleEvents} />
        </section>
      </div>
    </div>
  )
}
