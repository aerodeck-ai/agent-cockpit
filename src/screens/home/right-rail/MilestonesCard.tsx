/**
 * MilestonesCard — right-rail card showing next 5 milestones from vectos.
 *
 * Fetches https://vectos.berl.ai/api/milestones
 * Filters by owner === tenant || owner === 'Both'
 * Shows next 5 by target date.
 *
 * CF Access cookie forwards automatically (same domain group).
 */

import { useQuery } from '@tanstack/react-query'

type Milestone = {
  id: string | number
  title: string
  target_date?: string | null
  status?: string | null
  owner?: string | null
}

type MilestonesResponse = {
  milestones?: Milestone[]
  data?: Milestone[]
}

/** Map tenant identifier to vectos owner label */
function tenantToOwner(tenant: string): string {
  if (tenant === 'mally') return 'Mally'
  return 'Henry'
}

const STATUS_ICON: Record<string, string> = {
  green: '🟢',
  on_track: '🟢',
  at_risk: '🟡',
  yellow: '🟡',
  blocked: '🔴',
  red: '🔴',
  planned: '🔵',
  blue: '🔵',
}

function statusIcon(status?: string | null): string {
  if (!status) return '🔵'
  return STATUS_ICON[status.toLowerCase()] ?? '🔵'
}

function formatDate(d: string): string {
  try {
    const dt = new Date(d)
    return dt.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })
  } catch {
    return d
  }
}

/** Detect tenant from the page — reads localStorage key written by PR #18 auth layer */
function detectTenant(): string {
  if (typeof window === 'undefined') return 'henry_cos'
  try {
    return localStorage.getItem('cockpit-tenant') ?? 'henry_cos'
  } catch {
    return 'henry_cos'
  }
}

export function MilestonesCard() {
  const tenant = detectTenant()
  const ownerLabel = tenantToOwner(tenant)

  const { data, isLoading, error } = useQuery<MilestonesResponse>({
    queryKey: ['vectos', 'milestones', tenant],
    queryFn: async () => {
      // Use server-side proxy to bypass CF Access CORS restriction
      const resp = await fetch('/api/milestones')
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return resp.json()
    },
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
    retry: 2,
  })

  const allMilestones: Milestone[] = data?.milestones ?? data?.data ?? []
  const filtered = allMilestones
    .filter(
      (m) =>
        !m.owner ||
        m.owner === 'Both' ||
        m.owner.toLowerCase() === ownerLabel.toLowerCase(),
    )
    .filter((m) => m.target_date) // only show dated ones
    .sort((a, b) => {
      const da = new Date(a.target_date!).getTime()
      const db = new Date(b.target_date!).getTime()
      return da - db
    })
    .slice(0, 5)

  return (
    <div className="home-rail-card">
      <div className="home-rail-card-header">
        <span className="home-rail-card-title">Milestones</span>
        <span className="home-rail-card-badge">{filtered.length}</span>
      </div>

      {isLoading && (
        <div className="home-rail-skeleton">
          <div className="home-rail-skeleton-row" />
          <div className="home-rail-skeleton-row" />
          <div className="home-rail-skeleton-row short" />
        </div>
      )}

      {!isLoading && error && (
        <p className="home-rail-error">
          vectos unreachable
          {error instanceof Error ? ` — ${error.message}` : ''}
        </p>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <p className="home-rail-empty">No upcoming milestones</p>
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <ul className="home-rail-list">
          {filtered.map((m) => (
            <li key={m.id} className="home-rail-list-item">
              <span className="home-rail-icon">{statusIcon(m.status)}</span>
              <span className="home-rail-item-title milestone-title">{m.title}</span>
              {m.target_date && (
                <span className="home-rail-item-age">{formatDate(m.target_date)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
