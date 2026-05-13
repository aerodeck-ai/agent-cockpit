/**
 * MultiAccountBar — shows per-account util5h/util7d + daily $ spend.
 * Data source: GET /api/accounts/utilization
 */
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

type AccountUtilization = {
  partition: string
  label: string
  util5h: number
  util7d: number
  dailyCostUsd: number
  model?: string
}

function UtilBar({
  value,
  label,
  color,
}: {
  value: number
  label: string
  color: string
}) {
  const pct = Math.min(100, Math.max(0, Math.round(value * 100)))
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="w-8 shrink-0 text-primary-500">{label}</span>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-primary-300">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 tabular-nums text-primary-600">{pct}%</span>
    </div>
  )
}

function AccountCard({ account }: { account: AccountUtilization }) {
  const isHigh = account.util5h > 0.8
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded border px-3 py-2',
        isHigh
          ? 'border-amber-400/40 bg-amber-400/5'
          : 'border-primary-300 bg-primary-100',
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <span className="truncate text-xs font-medium text-primary-900">
          {account.label}
        </span>
        <span className="shrink-0 tabular-nums text-xs text-emerald-500">
          ${account.dailyCostUsd.toFixed(2)}/d
        </span>
      </div>
      <UtilBar
        value={account.util5h}
        label="5h"
        color={account.util5h > 0.8 ? 'bg-amber-400' : 'bg-emerald-400'}
      />
      <UtilBar value={account.util7d} label="7d" color="bg-blue-400" />
    </div>
  )
}

export function MultiAccountBar() {
  const [accounts, setAccounts] = useState<Array<AccountUtilization>>([])
  const [loading, setLoading] = useState(true)

  useEffect(function fetchAccounts() {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/accounts/utilization')
        if (!res.ok) return
        const data = (await res.json()) as {
          ok: boolean
          accounts: Array<AccountUtilization>
        }
        if (!cancelled && data.ok) setAccounts(data.accounts)
      } catch {
        // silent — non-critical
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    // Refresh every 60 s
    const timer = setInterval(() => { void load() }, 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  if (loading) {
    return (
      <div className="flex h-10 items-center border-b border-primary-300 bg-primary-100 px-4">
        <span className="text-xs text-primary-500">Loading accounts…</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 overflow-x-auto border-b border-primary-300 bg-primary-100 px-4 py-2">
      {accounts.map((account) => (
        <AccountCard key={account.partition} account={account} />
      ))}
    </div>
  )
}
