/**
 * CostTab — tenant-aware cost breakdown.
 *
 * Fetches GET /api/observe/cost?tenant=<slug>&days=<n>&group_by=tenant,model
 * and renders a simple table of model-level spend for the resolved tenant.
 *
 * Tenant is read via useTenantRole() (which calls /api/auth-check once and caches).
 */

import { useEffect, useState } from 'react'
import { useTenantRole } from '@/hooks/use-tenant-role'
import type { CostResponse, CostRow } from '@/routes/api/observe/cost'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, dp = 4): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

// ── component ─────────────────────────────────────────────────────────────────

export function CostTab() {
  const { tenant, displayName, loading: tenantLoading } = useTenantRole()
  const [days, setDays] = useState<1 | 7 | 30>(1)
  const [data, setData] = useState<CostResponse | null>(null)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (tenantLoading) return

    let cancelled = false
    setFetching(true)
    setError(null)

    const params = new URLSearchParams({
      days: String(days),
      group_by: 'tenant,model',
      ...(tenant ? { tenant } : {}),
    })

    void fetch(`/api/observe/cost?${params.toString()}`)
      .then((r) => r.json())
      .then((json: CostResponse) => {
        if (!cancelled) setData(json)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setFetching(false)
      })

    return () => {
      cancelled = true
    }
  }, [tenant, tenantLoading, days])

  const tenantLabel = displayName ?? 'Henry CoS'
  const isFixture =
    data?.source === 'fixture' ||
    data?.source === 'fixture_no_tenant_data' ||
    data?.source === 'error'

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">Cost</h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
          Tenant: {tenantLoading ? '…' : tenantLabel}
        </span>
        {isFixture && (
          <span className="rounded-full border border-amber-500/50 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-400">
            FIXTURE DATA
          </span>
        )}
        {data?.source === 'fixture_no_tenant_data' && (
          <span className="rounded-full border border-zinc-500/50 bg-zinc-400/10 px-2 py-0.5 text-[11px] text-zinc-400">
            no tenant rows yet
          </span>
        )}
        {/* Day selector */}
        <div className="ml-auto flex gap-1">
          {([1, 7, 30] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={[
                'rounded px-2.5 py-0.5 text-xs font-medium transition-colors',
                days === d
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              ].join(' ')}
            >
              {d === 1 ? 'Today' : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {(tenantLoading || fetching) && !data && (
        <div className="flex flex-col gap-2 animate-pulse">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-8 rounded bg-muted/40" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm text-destructive">Failed to load costs: {error}</p>
      )}

      {/* Totals summary */}
      {data && (
        <div className="mb-5 flex flex-wrap gap-4">
          <div className="rounded-lg border bg-card p-4 min-w-[140px]">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">Total spend</p>
            <p className="text-xl font-semibold">${fmt(data.totals.cost_usd, 2)}</p>
          </div>
          <div className="rounded-lg border bg-card p-4 min-w-[140px]">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">Input tokens</p>
            <p className="text-xl font-semibold">{fmtTokens(data.totals.input_tokens)}</p>
          </div>
          <div className="rounded-lg border bg-card p-4 min-w-[140px]">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">Output tokens</p>
            <p className="text-xl font-semibold">{fmtTokens(data.totals.output_tokens)}</p>
          </div>
        </div>
      )}

      {/* Rows table */}
      {data && data.rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground/70">
                <th className="px-4 py-2 text-left font-medium">Model</th>
                <th className="px-4 py-2 text-right font-medium">Cost (USD)</th>
                <th className="px-4 py-2 text-right font-medium">Input</th>
                <th className="px-4 py-2 text-right font-medium">Output</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row: CostRow, i) => (
                <tr
                  key={i}
                  className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors"
                >
                  <td className="px-4 py-2 font-mono text-xs text-foreground/80">
                    {row.model ?? '(unknown)'}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    ${fmt(row.cost_usd, 4)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {fmtTokens(row.input_tokens)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {fmtTokens(row.output_tokens)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <span className="text-4xl">💸</span>
          <p className="text-sm font-semibold">No spend data for this period.</p>
        </div>
      )}
    </div>
  )
}
