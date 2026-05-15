/**
 * GET /api/voice-cost
 *
 * Phase 8 — Telnyx CDR cost monitoring.
 * Queries Telnyx Detail Records API for the last 24h and current week,
 * aggregates total calls, minutes, USD cost, and per-tenant breakdown.
 *
 * Auth: Telnyx API key from TELNYX_API_KEY env (BW item 660dbfea-...).
 * Cache: 60s (Telnyx CDR has rate limits, ~10 req/min).
 * Cost-cap alert threshold: VOICE_COST_CAP_USD env, default $5.00.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'

// ── Types ─────────────────────────────────────────────────────────

export type CdrRecord = {
  call_control_id: string
  start_time: string
  end_time: string | null
  duration_secs: number
  from: string
  to: string
  direction: 'inbound' | 'outbound'
  status: string
  cost: { amount: string; currency: string } | null
}

export type TenantCost = {
  tenant: string
  did: string
  calls: number
  minutes: number
  cost_usd: number
}

export type VoiceCostSummary = {
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

// ── Constants ─────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000
let cache: { ts: number; data: VoiceCostSummary } | null = null

const TELNYX_BASE = 'https://api.telnyx.com/v2'

// ── Tenant resolver ────────────────────────────────────────────────
// Maps the destination DID to a human-readable tenant name.
// Extend this map as more DIDs are provisioned in Phase 8.
const DID_TO_TENANT: Record<string, string> = {
  // e.g. '+441234567890': 'berlai-demo'
  // populated from voice-bot provisioning
}

function resolveTenant(to: string): string {
  return DID_TO_TENANT[to] ?? to
}

// ── CDR fetcher ────────────────────────────────────────────────────

async function fetchCdrPage(
  apiKey: string,
  startIso: string,
  pageToken?: string,
): Promise<{ records: CdrRecord[]; nextPageToken?: string }> {
  const url = new URL(`${TELNYX_BASE}/detail_records`)
  url.searchParams.set('filter[record_type]', 'mdr')
  url.searchParams.set('filter[start_time][gte]', startIso)
  url.searchParams.set('page[size]', '100')
  if (pageToken) {
    url.searchParams.set('page[after]', pageToken)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  let res: Response
  try {
    res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)')
    throw new Error(`Telnyx CDR ${res.status}: ${text.slice(0, 200)}`)
  }

  const json = (await res.json()) as {
    data: CdrRecord[]
    meta?: { next_page_token?: string }
  }

  return {
    records: json.data ?? [],
    nextPageToken: json.meta?.next_page_token,
  }
}

async function fetchAllCdr(apiKey: string, startIso: string): Promise<CdrRecord[]> {
  const all: CdrRecord[] = []
  let pageToken: string | undefined

  // Guard: max 10 pages (~1000 records) to avoid runaway loops
  for (let page = 0; page < 10; page++) {
    const { records, nextPageToken } = await fetchCdrPage(apiKey, startIso, pageToken)
    all.push(...records)
    if (!nextPageToken || records.length === 0) break
    pageToken = nextPageToken
  }

  return all
}

// ── Aggregator ─────────────────────────────────────────────────────

function isoNMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

function isoNDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function recordCostUsd(rec: CdrRecord): number {
  if (!rec.cost?.amount) return 0
  const n = parseFloat(rec.cost.amount)
  return isNaN(n) ? 0 : n
}

function recordMinutes(rec: CdrRecord): number {
  return rec.duration_secs / 60
}

function isToday(rec: CdrRecord): boolean {
  const start = Date.now() - 86_400_000 // last 24h window
  return new Date(rec.start_time).getTime() >= start
}

function aggregate(records: CdrRecord[]): VoiceCostSummary['today'] {
  return {
    calls: records.length,
    minutes: records.reduce((s, r) => s + recordMinutes(r), 0),
    cost_usd: records.reduce((s, r) => s + recordCostUsd(r), 0),
  }
}

function top5ByCost(records: CdrRecord[]): VoiceCostSummary['top5_by_cost'] {
  const byDid: Record<string, { cost_usd: number; calls: number }> = {}
  for (const rec of records) {
    const did = rec.to
    if (!byDid[did]) byDid[did] = { cost_usd: 0, calls: 0 }
    byDid[did].cost_usd += recordCostUsd(rec)
    byDid[did].calls += 1
  }
  return Object.entries(byDid)
    .sort(([, a], [, b]) => b.cost_usd - a.cost_usd)
    .slice(0, 5)
    .map(([did, v]) => ({ did, ...v }))
}

function perTenant(records: CdrRecord[]): TenantCost[] {
  const byTenant: Record<string, TenantCost> = {}
  for (const rec of records) {
    const tenant = resolveTenant(rec.to)
    if (!byTenant[tenant]) {
      byTenant[tenant] = { tenant, did: rec.to, calls: 0, minutes: 0, cost_usd: 0 }
    }
    byTenant[tenant].calls += 1
    byTenant[tenant].minutes += recordMinutes(rec)
    byTenant[tenant].cost_usd += recordCostUsd(rec)
  }
  return Object.values(byTenant).sort((a, b) => b.cost_usd - a.cost_usd)
}

async function buildSummary(): Promise<VoiceCostSummary> {
  const apiKey = process.env.TELNYX_API_KEY ?? ''
  const costCapUsd = parseFloat(process.env.VOICE_COST_CAP_USD ?? '5.00')

  if (!apiKey) {
    const empty = { calls: 0, minutes: 0, cost_usd: 0 }
    return {
      fetched_at: Date.now(),
      today: empty,
      week: empty,
      top5_by_cost: [],
      per_tenant: [],
      cost_alert: false,
      cost_cap_usd: costCapUsd,
      error: 'TELNYX_API_KEY not configured',
    }
  }

  // Fetch 7-day window; filter to today in-process (avoids two round-trips)
  const weekStart = isoNDaysAgo(7)
  const weekRecords = await fetchAllCdr(apiKey, weekStart)
  const todayRecords = weekRecords.filter(isToday)

  const todaySummary = aggregate(todayRecords)
  const weekSummary = aggregate(weekRecords)

  return {
    fetched_at: Date.now(),
    today: todaySummary,
    week: weekSummary,
    top5_by_cost: top5ByCost(weekRecords),
    per_tenant: perTenant(weekRecords),
    cost_alert: todaySummary.cost_usd > costCapUsd,
    cost_cap_usd: costCapUsd,
  }
}

// ── Route ──────────────────────────────────────────────────────────

export const Route = createFileRoute('/api/voice-cost')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Serve from cache if fresh
        if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
          return Response.json(cache.data, {
            headers: { 'Cache-Control': 's-maxage=60, must-revalidate' },
          })
        }

        try {
          const data = await buildSummary()
          cache = { ts: Date.now(), data }
          return Response.json(data, {
            headers: { 'Cache-Control': 's-maxage=60, must-revalidate' },
          })
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          const empty = { calls: 0, minutes: 0, cost_usd: 0 }
          const errBody: VoiceCostSummary = {
            fetched_at: Date.now(),
            today: empty,
            week: empty,
            top5_by_cost: [],
            per_tenant: [],
            cost_alert: false,
            cost_cap_usd: parseFloat(process.env.VOICE_COST_CAP_USD ?? '5.00'),
            error: message,
          }
          return Response.json(errBody, { status: 200 }) // 200 so tile renders degraded, not broken
        }
      },
    },
  },
})
