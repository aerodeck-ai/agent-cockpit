/**
 * EvalsScreen — two-tab view for the /evals route.
 *
 * Tab 1: Runs — table of latest 30 eval runs with pass/fail/regression counts.
 * Tab 2: Compare — side-by-side diff of two selected runs.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'

// ── Types (mirrors /api/evals response) ─────────────────────────────────────

type EvalRun = {
  id: string
  started_at: string
  finished_at: string | null
  dataset: string
  pass: number
  fail: number
  regression_count: number
  cost_usd: number
  log_url: string | null
}

type EvalsApiResponse = {
  ok: boolean
  runs: Array<EvalRun>
  total: number
  error?: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function PassBadge({ pass, fail }: { pass: number; fail: number }) {
  const total = pass + fail
  if (total === 0) return <span className="text-muted-foreground text-xs">—</span>
  const pct = Math.round((pass / total) * 100)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        fail === 0
          ? 'bg-green-500/15 text-green-400'
          : pct >= 80
            ? 'bg-yellow-500/15 text-yellow-400'
            : 'bg-red-500/15 text-red-400',
      )}
    >
      {pass}/{total} ({pct}%)
    </span>
  )
}

function RegressionBadge({ count }: { count: number }) {
  if (count === 0)
    return (
      <span className="inline-flex items-center rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-400">
        0
      </span>
    )
  return (
    <span className="inline-flex items-center rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">
      {count}
    </span>
  )
}

// ── Runs Tab ─────────────────────────────────────────────────────────────────

function RunsTab() {
  const { data, isLoading, error } = useQuery<EvalsApiResponse>({
    queryKey: ['evals-runs'],
    queryFn: async () => {
      const res = await fetch('/api/evals?limit=30')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<EvalsApiResponse>
    },
    refetchInterval: 60_000, // refresh every minute
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        Loading eval runs…
      </div>
    )
  }

  if (error || !data?.ok) {
    return (
      <div className="flex items-center justify-center py-16 text-red-400 text-sm">
        {error instanceof Error ? error.message : (data?.error ?? 'Failed to load evals')}
      </div>
    )
  }

  if (data.runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <svg
          className="h-10 w-10 opacity-40"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-sm">No eval runs yet.</p>
        <p className="text-xs opacity-60">
          Run{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            cd evals && promptfoo eval
          </code>{' '}
          to create the first run.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Dataset</th>
            <th className="py-2 pr-4 font-medium">Started</th>
            <th className="py-2 pr-4 font-medium">Finished</th>
            <th className="py-2 pr-4 font-medium">Pass/Total</th>
            <th className="py-2 pr-4 font-medium">Regressions</th>
            <th className="py-2 pr-4 font-medium">Cost</th>
            <th className="py-2 font-medium">Log</th>
          </tr>
        </thead>
        <tbody>
          {data.runs.map((run) => (
            <tr
              key={run.id}
              className="border-b border-border/50 hover:bg-muted/30 transition-colors"
            >
              <td className="py-2 pr-4">
                <span className="font-mono text-xs rounded bg-muted px-1.5 py-0.5">
                  {run.dataset}
                </span>
              </td>
              <td className="py-2 pr-4 text-xs text-muted-foreground">
                {fmtDate(run.started_at)}
              </td>
              <td className="py-2 pr-4 text-xs text-muted-foreground">
                {fmtDate(run.finished_at)}
              </td>
              <td className="py-2 pr-4">
                <PassBadge pass={run.pass} fail={run.fail} />
              </td>
              <td className="py-2 pr-4">
                <RegressionBadge count={run.regression_count} />
              </td>
              <td className="py-2 pr-4 text-xs text-muted-foreground">
                {run.cost_usd > 0 ? `$${run.cost_usd.toFixed(4)}` : '—'}
              </td>
              <td className="py-2">
                {run.log_url ? (
                  <a
                    href={run.log_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    View
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted-foreground">
        Showing {data.runs.length} of {data.total} runs
      </p>
    </div>
  )
}

// ── Compare Tab ──────────────────────────────────────────────────────────────

function CompareTab() {
  const { data } = useQuery<EvalsApiResponse>({
    queryKey: ['evals-runs'],
    queryFn: async () => {
      const res = await fetch('/api/evals?limit=30')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<EvalsApiResponse>
    },
  })

  const runs = data?.runs ?? []

  const [leftId, setLeftId] = useState<string>('')
  const [rightId, setRightId] = useState<string>('')

  const left = runs.find((r) => r.id === leftId)
  const right = runs.find((r) => r.id === rightId)

  if (runs.length < 2) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        Need at least 2 runs to compare. Run evals first.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Run A
          </label>
          <select
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            value={leftId}
            onChange={(e) => setLeftId(e.target.value)}
          >
            <option value="">Select a run…</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.dataset} — {fmtDate(r.started_at)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Run B
          </label>
          <select
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            value={rightId}
            onChange={(e) => setRightId(e.target.value)}
          >
            <option value="">Select a run…</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.dataset} — {fmtDate(r.started_at)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {left && right && (
        <div className="grid grid-cols-2 gap-4">
          {([left, right] as Array<EvalRun>).map((run, idx) => (
            <div
              key={run.id}
              className="rounded-lg border border-border p-4 space-y-3"
            >
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Run {idx === 0 ? 'A' : 'B'}
              </div>
              <div>
                <span className="font-mono text-xs rounded bg-muted px-1.5 py-0.5">
                  {run.dataset}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {fmtDate(run.started_at)}
              </div>
              <div className="flex items-center gap-3">
                <PassBadge pass={run.pass} fail={run.fail} />
                <span className="text-xs text-muted-foreground">
                  {run.regression_count} regression
                  {run.regression_count !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                Cost:{' '}
                {run.cost_usd > 0 ? `$${run.cost_usd.toFixed(4)}` : '—'}
              </div>
              {run.log_url && (
                <a
                  href={run.log_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline block"
                >
                  View full log →
                </a>
              )}
            </div>
          ))}

          {/* Delta summary */}
          <div className="col-span-2 rounded-lg border border-border p-4">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Delta (B − A)
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Pass Δ</div>
                <span
                  className={cn(
                    'font-medium',
                    right.pass - left.pass >= 0
                      ? 'text-green-400'
                      : 'text-red-400',
                  )}
                >
                  {right.pass - left.pass >= 0 ? '+' : ''}
                  {right.pass - left.pass}
                </span>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">
                  Regressions Δ
                </div>
                <span
                  className={cn(
                    'font-medium',
                    right.regression_count - left.regression_count <= 0
                      ? 'text-green-400'
                      : 'text-red-400',
                  )}
                >
                  {right.regression_count - left.regression_count >= 0 ? '+' : ''}
                  {right.regression_count - left.regression_count}
                </span>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Cost Δ</div>
                <span className="font-medium text-muted-foreground">
                  {right.cost_usd - left.cost_usd >= 0 ? '+' : ''}$
                  {(right.cost_usd - left.cost_usd).toFixed(4)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Screen ──────────────────────────────────────────────────────────────

type Tab = 'runs' | 'compare'

export function EvalsScreen() {
  const [activeTab, setActiveTab] = useState<Tab>('runs')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <svg
          className="h-5 w-5 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <h1 className="text-lg font-semibold">Evals</h1>
        <span className="ml-auto text-xs text-muted-foreground">
          Nightly · Promptfoo + Laminar
        </span>
      </div>

      {/* Tabs */}
      <div className="border-b border-border px-6">
        <div className="flex gap-0">
          {(['runs', 'compare'] as Array<Tab>).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px capitalize',
                activeTab === tab
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {activeTab === 'runs' ? <RunsTab /> : <CompareTab />}
      </div>
    </div>
  )
}
