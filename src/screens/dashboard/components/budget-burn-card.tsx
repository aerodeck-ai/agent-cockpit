/**
 * BudgetBurnCard — per-tenant daily budget burn widget.
 *
 * Shows: tenant label | $spent / $cap | % bar | today's projection.
 * Color thresholds:
 *   <80%  => accent (blue/purple)
 *   >=80% => warning (yellow)
 *   >=90% => danger (orange/red)
 *
 * Henry sees all tenants. Mally sees only his own row (enforced server-side).
 * Fires a sidebar toast warning when any tenant hits 90% of their cap.
 */

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { toast } from '@/components/ui/toast'

type TenantBudget = {
  tenant: string
  displayName: string
  spent: number
  cap: number | null
  pct: number | null
  projection: number
  withinCap: boolean
}

type BudgetStatusResponse = {
  tenants: TenantBudget[]
}

function formatCost(usd: number): string {
  if (usd <= 0) return '$0.00'
  if (usd < 0.01) return '<$0.01'
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

function barColor(pct: number | null): string {
  if (pct == null) return 'var(--theme-accent)'
  if (pct >= 90) return 'var(--theme-danger)'
  if (pct >= 80) return 'var(--theme-warning)'
  return 'var(--theme-accent)'
}

function tooltipText(row: TenantBudget): string {
  if (row.pct == null) return 'No cap configured'
  if (row.pct >= 90) return `Warning: ${row.pct}% of daily cap used — requests will be blocked soon`
  if (row.pct >= 80) return `Heads-up: ${row.pct}% of daily cap used`
  return `${row.pct}% of daily cap used`
}

function TenantRow({ row }: { row: TenantBudget }) {
  const pct = row.pct ?? 0
  const isWarning = pct >= 80 && pct < 90
  const isDanger  = pct >= 90

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span
          className="font-medium"
          style={{ color: 'var(--theme-foreground)' }}
          title={tooltipText(row)}
        >
          {row.displayName}
          {(isWarning || isDanger) && (
            <span
              className="ml-1"
              style={{ color: isDanger ? 'var(--theme-danger)' : 'var(--theme-warning)' }}
            >
              {isDanger ? ' ⚠' : ' ·'}
            </span>
          )}
        </span>
        <span style={{ color: 'var(--theme-muted)' }}>
          {formatCost(row.spent)}
          {row.cap != null ? ` / $${row.cap.toFixed(2)}` : ' (no cap)'}
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="h-1.5 w-full rounded-full overflow-hidden"
        style={{ background: 'color-mix(in srgb, var(--theme-border) 60%, transparent)' }}
        title={tooltipText(row)}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: row.cap != null ? `${Math.min(pct, 100)}%` : '0%',
            background: barColor(row.pct),
          }}
        />
      </div>

      {/* Projection line */}
      {row.cap != null && row.projection > 0 && (
        <div
          className="text-right text-[10px]"
          style={{ color: 'var(--theme-muted)' }}
        >
          Proj: {formatCost(row.projection)} / day
          {row.projection >= row.cap && (
            <span style={{ color: 'var(--theme-danger)' }}> — over cap</span>
          )}
        </div>
      )}
    </div>
  )
}

export function BudgetBurnCard() {
  const warnedRef = useRef<Set<string>>(new Set())

  const { data, isLoading, isError } = useQuery<BudgetStatusResponse>({
    queryKey: ['budget-status'],
    queryFn: async () => {
      const res = await fetch('/api/budget/status')
      if (!res.ok) throw new Error(`budget/status ${res.status}`)
      return res.json() as Promise<BudgetStatusResponse>
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  // Sidebar notification when any tenant reaches 90%
  useEffect(() => {
    if (!data?.tenants) return
    for (const row of data.tenants) {
      if (row.pct != null && row.pct >= 90 && !warnedRef.current.has(row.tenant)) {
        warnedRef.current.add(row.tenant)
        toast(
          `${row.displayName} at ${row.pct}% daily budget — requests will be blocked at 100%`,
          { type: 'warning', duration: 10_000 },
        )
      }
    }
  }, [data])

  if (isLoading) {
    return (
      <div
        className="rounded-xl border p-3 flex items-center justify-center text-xs"
        style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-muted)', minHeight: 60 }}
      >
        Loading budget…
      </div>
    )
  }

  if (isError || !data?.tenants?.length) {
    return (
      <div
        className="rounded-xl border p-3 flex items-center justify-center text-xs"
        style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-muted)', minHeight: 60 }}
      >
        Budget data unavailable
      </div>
    )
  }

  return (
    <div
      className="relative flex flex-col gap-3 overflow-hidden rounded-xl border p-3"
      style={{
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--theme-card) 96%, transparent), color-mix(in srgb, var(--theme-card) 92%, transparent))',
        borderColor: 'var(--theme-border)',
      }}
    >
      {/* Top accent bar */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
        style={{
          background:
            'linear-gradient(90deg, var(--theme-accent), color-mix(in srgb, var(--theme-accent) 40%, transparent), transparent)',
        }}
      />

      <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted)' }}>
        Daily Budget
      </div>

      {data.tenants.map((row) => (
        <TenantRow key={row.tenant} row={row} />
      ))}
    </div>
  )
}
