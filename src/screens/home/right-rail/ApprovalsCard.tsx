/**
 * ApprovalsCard — right-rail card showing items queued for Henry's approval.
 *
 * Sources (aggregated by /api/approvals/aggregate):
 *  - GitHub PRs awaiting review
 *  - relay.db pending_henry_approval rows
 *  - ~/Drafts/ email drafts
 *  - BotFather slot queue
 */

import { useQuery } from '@tanstack/react-query'

type ApprovalItem = {
  source: 'github_pr' | 'relay' | 'draft_email' | 'botfather'
  id: string
  title: string
  link: string | null
  age_s: number
}

type AggregateResponse = {
  items: ApprovalItem[]
  total: number
  error?: string
}

const SOURCE_LABEL: Record<ApprovalItem['source'], string> = {
  github_pr: 'PR',
  relay: 'Relay',
  draft_email: 'Draft',
  botfather: 'Bot',
}

function formatAge(age_s: number): string {
  if (age_s < 60) return `${age_s}s`
  if (age_s < 3600) return `${Math.floor(age_s / 60)}m`
  if (age_s < 86400) return `${Math.floor(age_s / 3600)}h`
  return `${Math.floor(age_s / 86400)}d`
}

export function ApprovalsCard() {
  const { data, isLoading, error } = useQuery<AggregateResponse>({
    queryKey: ['approvals', 'aggregate'],
    queryFn: async () => {
      const resp = await fetch('/api/approvals/aggregate')
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return resp.json()
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  })

  const items = data?.items ?? []

  return (
    <div className="home-rail-card">
      <div className="home-rail-card-header">
        <span className="home-rail-card-title">Approvals</span>
        {!isLoading && (
          <span className="home-rail-card-badge">{items.length}</span>
        )}
      </div>

      {isLoading && (
        <div className="home-rail-skeleton">
          <div className="home-rail-skeleton-row" />
          <div className="home-rail-skeleton-row" />
          <div className="home-rail-skeleton-row short" />
        </div>
      )}

      {!isLoading && error && (
        <p className="home-rail-error">Failed to load approvals</p>
      )}

      {!isLoading && !error && items.length === 0 && (
        <p className="home-rail-empty">Nothing queued</p>
      )}

      {!isLoading && !error && items.length > 0 && (
        <ul className="home-rail-list">
          {items.slice(0, 5).map((item) => (
            <li key={item.id} className="home-rail-list-item">
              <span className="home-rail-source-badge" data-source={item.source}>
                {SOURCE_LABEL[item.source]}
              </span>
              {item.link ? (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="home-rail-item-title"
                >
                  {item.title}
                </a>
              ) : (
                <span className="home-rail-item-title">{item.title}</span>
              )}
              <span className="home-rail-item-age">{formatAge(item.age_s)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
