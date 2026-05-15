/**
 * VoiceCostTile — Phase 8 Telnyx CDR cost watchdog
 *
 * Displays live voice call costs pulled from the Telnyx Detail Records API
 * via /api/voice-cost (60s server-side cache). Shows today vs week totals,
 * top-5 DIDs by spend, per-tenant breakdown, and a red-bordered COST_ALERT
 * badge if today's spend exceeds the configurable cap (default $5).
 *
 * Pattern: GlassCard shell + useQuery with refetchInterval — same as VoiceFleetTile.
 */
import { useQuery } from '@tanstack/react-query'

// ── Type mirror from API route ─────────────────────────────────────

type TenantCost = {
  tenant: string
  did: string
  calls: number
  minutes: number
  cost_usd: number
}

type VoiceCostSummary = {
  fetched_at: number
  today: {
    calls: number
    minutes: number
    cost_usd: number
  }
  week: {
    calls: number
    minutes: number
    cost_usd: number
  }
  top5_by_cost: Array<{ did: string; cost_usd: number; calls: number }>
  per_tenant: Array<TenantCost>
  cost_alert: boolean
  cost_cap_usd: number
  error?: string
}

// ── Helpers ────────────────────────────────────────────────────────

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

function fmtMin(m: number): string {
  if (m < 1) return `${Math.round(m * 60)}s`
  return `${m.toFixed(1)}min`
}

function agoStr(ms: number | null): string {
  if (ms === null) return '—'
  const diff = Date.now() - ms
  if (diff < 60_000) return '<1m ago'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

function shortenDid(did: string): string {
  // Show last 10 chars of DID for table brevity
  if (did.length <= 12) return did
  return '…' + did.slice(-10)
}

// ── Sub-components ─────────────────────────────────────────────────

function Dim({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--theme-muted)', fontSize: 10 }}>{children}</span>
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-[var(--theme-border)] last:border-0">
      <span className="text-[11px] font-medium" style={{ color: 'var(--theme-muted)', minWidth: 100 }}>
        {label}
      </span>
      <div className="flex items-center gap-2 flex-wrap justify-end text-[11px]" style={{ color: 'var(--theme-text)' }}>
        {children}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-1 mt-3 text-[9px] font-semibold uppercase tracking-[0.18em]"
      style={{ color: 'var(--theme-muted)' }}
    >
      {children}
    </div>
  )
}

function StatBlock({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-[0.12em]" style={{ color: 'var(--theme-muted)' }}>
        {label}
      </span>
      <span className="text-[15px] font-semibold tabular-nums" style={{ color: 'var(--theme-text)' }}>
        {value}
      </span>
      {sub && <Dim>{sub}</Dim>}
    </div>
  )
}

// ── Main tile ──────────────────────────────────────────────────────

export function VoiceCostTile() {
  const query = useQuery<VoiceCostSummary>({
    queryKey: ['voice-cost'],
    queryFn: async () => {
      const res = await fetch('/api/voice-cost')
      if (!res.ok) throw new Error(`voice-cost ${res.status}`)
      return (await res.json()) as VoiceCostSummary
    },
    staleTime: 55_000,
    refetchInterval: 60_000,
  })

  const d = query.data ?? null
  const isLoading = query.isLoading
  const isError = query.isError
  const alert = d?.cost_alert ?? false

  return (
    <div
      className="relative flex flex-col overflow-hidden rounded-xl border transition-colors"
      style={{
        background: 'var(--theme-card)',
        borderColor: alert ? 'rgba(239,68,68,0.6)' : 'var(--theme-border)',
        boxShadow: alert ? '0 0 0 1px rgba(239,68,68,0.25)' : undefined,
      }}
    >
      {/* Accent bar — amber for cost monitoring */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
        style={{
          background: alert
            ? 'linear-gradient(90deg, #ef4444, #ef444450, transparent)'
            : 'linear-gradient(90deg, #f59e0b, #f59e0b50, transparent)',
        }}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.15em]" style={{ color: 'var(--theme-muted)' }}>
          Voice Cost
        </h3>
        <div className="flex items-center gap-2">
          {alert && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]"
              style={{
                background: 'rgba(239,68,68,0.12)',
                color: 'var(--theme-danger, #ef4444)',
                border: '1px solid rgba(239,68,68,0.28)',
              }}
            >
              ⚠️ COST_ALERT
            </span>
          )}
          {isLoading && (
            <span className="text-[9px] uppercase tracking-[0.12em]" style={{ color: 'var(--theme-muted)' }}>
              loading…
            </span>
          )}
          {isError && (
            <span className="text-[9px] uppercase tracking-[0.12em]" style={{ color: 'var(--theme-danger, #ef4444)' }}>
              probe failed
            </span>
          )}
          {d && (
            <span className="text-[9px] tabular-nums" style={{ color: 'var(--theme-muted)' }}>
              {agoStr(d.fetched_at)}
            </span>
          )}
          <span className="text-[10px]">💰</span>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 pb-4 pt-2">

        {/* API key missing / error warning */}
        {d?.error && (
          <div
            className="mb-2 rounded-lg px-3 py-2 text-[10px]"
            style={{
              background: 'rgba(239,68,68,0.08)',
              color: 'var(--theme-danger, #ef4444)',
              border: '1px solid rgba(239,68,68,0.2)',
            }}
          >
            {d.error}
          </div>
        )}

        {/* ── Today / Week hero stats ── */}
        <SectionLabel>Spend</SectionLabel>
        <div className="grid grid-cols-2 gap-3 pt-1 pb-2">
          <StatBlock
            label="Today"
            value={d ? fmtUsd(d.today.cost_usd) : '—'}
            sub={d ? `${d.today.calls} calls · ${fmtMin(d.today.minutes)}` : undefined}
          />
          <StatBlock
            label="This week"
            value={d ? fmtUsd(d.week.cost_usd) : '—'}
            sub={d ? `${d.week.calls} calls · ${fmtMin(d.week.minutes)}` : undefined}
          />
        </div>

        {d && (
          <div className="mb-1">
            <Dim>Cap: {fmtUsd(d.cost_cap_usd)}/day · set VOICE_COST_CAP_USD to change</Dim>
          </div>
        )}

        {/* ── Top 5 DIDs ── */}
        {d && d.top5_by_cost.length > 0 && (
          <>
            <SectionLabel>Top DIDs (7d)</SectionLabel>
            {d.top5_by_cost.map((entry) => (
              <Row key={entry.did} label={shortenDid(entry.did)}>
                <span className="font-semibold tabular-nums" style={{ color: 'var(--theme-text)' }}>
                  {fmtUsd(entry.cost_usd)}
                </span>
                <Dim>{entry.calls} call{entry.calls !== 1 ? 's' : ''}</Dim>
              </Row>
            ))}
          </>
        )}

        {/* ── Per-tenant breakdown ── */}
        {d && d.per_tenant.length > 0 && (
          <>
            <SectionLabel>Per tenant (7d)</SectionLabel>
            {d.per_tenant.map((t) => (
              <Row key={t.tenant} label={t.tenant === t.did ? shortenDid(t.did) : t.tenant}>
                <span className="font-semibold tabular-nums" style={{ color: 'var(--theme-text)' }}>
                  {fmtUsd(t.cost_usd)}
                </span>
                <Dim>{t.calls} call{t.calls !== 1 ? 's' : ''} · {fmtMin(t.minutes)}</Dim>
              </Row>
            ))}
          </>
        )}

        {/* Empty state */}
        {d && !d.error && d.week.calls === 0 && (
          <div className="py-3 text-center">
            <Dim>No calls in the last 7 days</Dim>
          </div>
        )}
      </div>
    </div>
  )
}
