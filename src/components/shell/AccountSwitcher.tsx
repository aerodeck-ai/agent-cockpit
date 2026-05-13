/**
 * AccountSwitcher — TopBar dropdown showing the active OAuth account + quota.
 *
 * TopBar (desktop):
 *   [...other bits]  | Account: hb ▓▓░ 73%  ▼  | [...]
 *
 * Dropdown:
 *   ● hb    ████░░  73%        ← active, accent colour
 *   ○ hotmail ███░░  31%
 *   ○ h90-2  idle
 *   ──────────────────
 *   Refresh data
 *
 * - Henry-tenant (henry_cos): click a row → POST /active → optimistic update
 *   → SSE confirms
 * - Mally-tenant: dropdown opens, rows have no click handler; "read-only"
 *   footer shown
 *
 * Util bar colour:
 *   < 50 % → green
 *   50–80 % → amber
 *   > 80 % → red
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react'
import { cn } from '@/lib/utils'

// ── Types (mirroring server/oauth-router-client.ts) ──────────────────────────

interface OAuthAccount {
  alias: string
  util5h: number   // 0–1 fraction
  util7d: number
  daily_usd: number
  status: 'healthy' | 'idle' | 'degraded'
}

interface AccountsResponse {
  accounts: OAuthAccount[]
  mock: boolean
}

interface ActiveResponse {
  alias: string
  mock: boolean
}

// ── Util bar ─────────────────────────────────────────────────────────────────

function utilBgColour(frac: number): string {
  if (frac > 0.8) return 'bg-red-500'
  if (frac > 0.5) return 'bg-amber-400'
  return 'bg-green-500'
}

function utilTextColour(frac: number): string {
  if (frac > 0.8) return 'text-red-500'
  if (frac > 0.5) return 'text-amber-400'
  return 'text-green-500'
}

interface UtilBarProps {
  frac: number
  className?: string
}

function UtilBar({ frac, className }: UtilBarProps) {
  const pct = Math.round(frac * 100)
  return (
    <div
      className={cn('h-1.5 w-16 rounded-full bg-muted/60 overflow-hidden', className)}
      role="meter"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${pct}% utilisation`}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', utilBgColour(frac))}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// ── AccountSwitcher ───────────────────────────────────────────────────────────

export function AccountSwitcher() {
  const [open, setOpen]               = useState(false)
  const [tenant, setTenant]           = useState<'henry_cos' | 'mally' | null>(null)
  const [accounts, setAccounts]       = useState<OAuthAccount[]>([])
  const [activeAlias, setActiveAlias] = useState<string | null>(null)
  const [isMock, setIsMock]           = useState(false)
  const [switching, setSwitching]     = useState<string | null>(null)   // alias being switched to
  const [error, setError]             = useState<string | null>(null)

  const dropdownRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // ── Resolve tenant from /api/auth-check ────────────────────────────────────
  useEffect(() => {
    fetch('/api/auth-check')
      .then((r) => r.json())
      .then((data: { tenant?: string }) => {
        setTenant(data.tenant === 'mally' ? 'mally' : 'henry_cos')
      })
      .catch(() => setTenant('henry_cos'))
  }, [])

  // ── Load accounts + active ─────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [acctRes, activeRes] = await Promise.all([
        fetch('/api/oauth-router/accounts'),
        fetch('/api/oauth-router/active'),
      ])

      if (acctRes.ok) {
        const data = (await acctRes.json()) as AccountsResponse
        setAccounts(data.accounts)
        setIsMock(data.mock)
      }
      if (activeRes.ok) {
        const data = (await activeRes.json()) as ActiveResponse
        setActiveAlias(data.alias)
      }
    } catch {
      // Silent — stale data is fine until next refresh
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // ── SSE subscription ───────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource('/api/oauth-router/events')
    eventSourceRef.current = es

    es.addEventListener('account_switched', (evt) => {
      try {
        const data = JSON.parse(evt.data) as { alias: string }
        setActiveAlias(data.alias)
        setSwitching(null)
      } catch {
        // malformed event
      }
    })

    es.addEventListener('accounts_updated', () => {
      void loadData()
    })

    es.onerror = () => {
      // SSE will auto-reconnect; no user-visible error needed
    }

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [loadData])

  // ── Close on outside click ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
        setError(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // ── Switch handler (Henry-only) ────────────────────────────────────────────
  const handleSwitch = useCallback(
    async (alias: string) => {
      if (tenant !== 'henry_cos') return
      if (alias === activeAlias) {
        setOpen(false)
        return
      }

      // Optimistic update
      setError(null)
      setSwitching(alias)
      const prevAlias = activeAlias
      setActiveAlias(alias)

      try {
        const resp = await fetch('/api/oauth-router/active', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alias }),
        })

        if (!resp.ok) {
          // Rollback
          setActiveAlias(prevAlias)
          setSwitching(null)
          const msg = resp.status === 403 ? 'Not authorised to switch accounts' : 'Switch failed'
          setError(msg)
          return
        }

        // SSE will confirm; but also update immediately from response
        const data = (await resp.json()) as { alias: string }
        setActiveAlias(data.alias)
        setSwitching(null)
        setOpen(false)
      } catch {
        setActiveAlias(prevAlias)
        setSwitching(null)
        setError('Network error — try again')
      }
    },
    [tenant, activeAlias],
  )

  // ── Don't render until tenant is resolved ─────────────────────────────────
  if (!tenant) return null

  const active = accounts.find((a) => a.alias === activeAlias)
  const util5hPct = active ? Math.round(active.util5h * 100) : null

  return (
    <div ref={dropdownRef} className="relative flex items-center">
      {/* TopBar trigger button */}
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o)
          setError(null)
        }}
        className={cn(
          'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
          'bg-muted/60 hover:bg-muted text-foreground',
          open && 'bg-muted',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={isMock ? 'Account switcher (mock data — G1 not yet deployed)' : 'Switch OAuth account'}
      >
        <span className="text-muted-foreground select-none">Account:</span>
        <span className="font-medium">{activeAlias ?? '…'}</span>
        {active && active.status !== 'idle' && util5hPct !== null && (
          <UtilBar frac={active.util5h} className="w-10" />
        )}
        {active && active.status !== 'idle' && util5hPct !== null && (
          <span className={cn(
            'tabular-nums',
            utilTextColour(active.util5h),
          )}>
            {util5hPct}%
          </span>
        )}
        {active?.status === 'idle' && (
          <span className="text-muted-foreground">idle</span>
        )}
        {isMock && (
          <span className="text-[9px] text-muted-foreground/60 select-none">(mock)</span>
        )}
        <span className="text-muted-foreground select-none">▾</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className={cn(
            'absolute right-0 top-full mt-1 z-50 min-w-[200px]',
            'rounded-lg border border-border bg-popover shadow-lg',
            'py-1',
          )}
          role="listbox"
          aria-label="OAuth accounts"
        >
          {accounts.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
          )}

          {accounts.map((acct) => {
            const isActive = acct.alias === activeAlias
            const isPending = acct.alias === switching
            const pct = Math.round(acct.util5h * 100)
            const canSwitch = tenant === 'henry_cos'

            return (
              <button
                key={acct.alias}
                type="button"
                role="option"
                aria-selected={isActive}
                disabled={!canSwitch || isPending}
                onClick={() => canSwitch && void handleSwitch(acct.alias)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs',
                  'transition-colors text-left',
                  isActive
                    ? 'bg-accent/10 text-accent-foreground font-medium'
                    : 'text-foreground',
                  canSwitch && !isPending && !isActive
                    ? 'hover:bg-muted/60 cursor-pointer'
                    : 'cursor-default',
                  isPending && 'opacity-60',
                )}
              >
                {/* Active dot */}
                <span
                  className={cn(
                    'shrink-0 w-2 h-2 rounded-full',
                    isActive
                      ? 'bg-accent'
                      : 'border border-muted-foreground/40',
                  )}
                  aria-hidden
                />

                {/* Alias */}
                <span className="flex-1 truncate">{acct.alias}</span>

                {/* Util bar + pct, or idle/degraded badge */}
                {acct.status === 'idle' ? (
                  <span className="text-muted-foreground/70 shrink-0">idle</span>
                ) : acct.status === 'degraded' ? (
                  <span className="text-red-400 shrink-0">degraded</span>
                ) : (
                  <div className="flex items-center gap-1 shrink-0">
                    <UtilBar frac={acct.util5h} />
                    <span
                      className={cn(
                        'tabular-nums w-8 text-right',
                        utilTextColour(acct.util5h),
                      )}
                    >
                      {pct}%
                    </span>
                  </div>
                )}
              </button>
            )
          })}

          {/* Divider */}
          <div className="my-1 border-t border-border" />

          {/* Footer — read-only notice for Mally, refresh for Henry */}
          {tenant === 'mally' ? (
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground/70 select-none">
              Read-only — only Henry can switch accounts
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                void loadData()
                setError(null)
              }}
              className="w-full px-3 py-1.5 text-xs text-left text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              Refresh data
            </button>
          )}

          {/* Error message */}
          {error && (
            <div className="px-3 py-1 text-[11px] text-red-400 border-t border-border">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
