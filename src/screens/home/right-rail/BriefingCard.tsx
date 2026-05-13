/**
 * BriefingCard — bespoke morning brief aggregator.
 *
 * Shows counts of:
 *  - Overnight hermes_findings
 *  - Approvals queued
 *  - Recent YT curated items
 *
 * Sources: /api/flow/events (existing) + /api/approvals/aggregate (new).
 */

import { useQuery } from '@tanstack/react-query'

type FindingsResponse = {
  events: Array<{ ts: string }>
  count: number
}

type ApprovalsResponse = {
  items: unknown[]
  total: number
}

function countOvernight(events: Array<{ ts: string }>): number {
  const cutoff = Date.now() - 8 * 60 * 60 * 1000 // last 8h = "overnight"
  return events.filter((e) => new Date(e.ts).getTime() > cutoff).length
}

export function BriefingCard() {
  const { data: findingsData, isLoading: loadingFindings } =
    useQuery<FindingsResponse>({
      queryKey: ['flow', 'events', 'briefing'],
      queryFn: async () => {
        const resp = await fetch('/api/flow/events?hours=8&limit=200')
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        return resp.json()
      },
      refetchInterval: 5 * 60_000,
      staleTime: 4 * 60_000,
    })

  const { data: approvalsData, isLoading: loadingApprovals } =
    useQuery<ApprovalsResponse>({
      queryKey: ['approvals', 'aggregate'],
      // Shared with ApprovalsCard — TanStack Query deduplicates the fetch
      queryFn: async () => {
        const resp = await fetch('/api/approvals/aggregate')
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        return resp.json()
      },
      refetchInterval: 30_000,
      staleTime: 25_000,
    })

  const isLoading = loadingFindings || loadingApprovals

  const overnightCount = findingsData
    ? countOvernight(findingsData.events)
    : null
  const approvalsCount = approvalsData?.total ?? null

  const summaryParts: string[] = []
  if (overnightCount !== null) {
    summaryParts.push(`${overnightCount} finding${overnightCount !== 1 ? 's' : ''} overnight`)
  }
  if (approvalsCount !== null && approvalsCount > 0) {
    summaryParts.push(`${approvalsCount} approval${approvalsCount !== 1 ? 's' : ''} queued`)
  }
  const summary = summaryParts.length > 0 ? summaryParts.join(' · ') : 'All clear'

  return (
    <div className="home-rail-card briefing-card">
      <div className="home-rail-card-header">
        <span className="home-rail-card-title">Daily briefing</span>
      </div>

      {isLoading && (
        <div className="home-rail-skeleton">
          <div className="home-rail-skeleton-row" />
          <div className="home-rail-skeleton-row short" />
        </div>
      )}

      {!isLoading && (
        <>
          <div className="briefing-metrics">
            <div className="briefing-metric">
              <span className="briefing-metric-value">
                {overnightCount ?? '—'}
              </span>
              <span className="briefing-metric-label">findings overnight</span>
            </div>
            <div className="briefing-metric">
              <span className="briefing-metric-value">
                {approvalsCount ?? '—'}
              </span>
              <span className="briefing-metric-label">approvals queued</span>
            </div>
          </div>
          <p className="briefing-summary">{summary}</p>
        </>
      )}
    </div>
  )
}
