/**
 * LeftNav — Cockpit D3 navigation strip (200px wide, D3 re-layout).
 *
 * Layout:
 *   🏠 Home          → /
 *   🔨 Build         → /build
 *   📊 Observe       → /observe
 *   🏢 Office        → /office
 *   📚 Knowledge     → /knowledge
 *   ─────────────────
 *   📋 Approvals      1 ●   (popover on click)
 *   🎯 Milestones     —
 *   📅 Today's mtgs   —
 *   📰 Briefing     136
 *   ─────────────────
 *   ⚙  Settings     → opens <SettingsFlyout />
 *
 * Counter shows integer count or em-dash (—) when source unavailable.
 * Popover shows detail lines from the former right-rail cards.
 * Error state is quiet: em-dash in the row, warning icon inside the popover.
 *
 * TODO(v2): add a user-controlled toggle to collapse back to 56px icon-only mode.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Home01Icon,
  Rocket01Icon,
  Activity01Icon,
  Building01Icon,
  BrainIcon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import {
  SettingsFlyout,
  SettingsTrigger,
  useSettingsFlyout,
} from '@/components/shell/SettingsFlyout'
import { SessionPill } from '@/components/shell/SessionPill'

// ── Nav entry definitions ──────────────────────────────────────────────────

type NavEntry = {
  to: string
  icon: unknown
  label: string
  matchPrefix?: string
}

const NAV_ENTRIES: Array<NavEntry> = [
  { to: '/', icon: Home01Icon, label: 'Home', matchPrefix: undefined },
  { to: '/build', icon: Rocket01Icon, label: 'Build', matchPrefix: '/build' },
  { to: '/observe', icon: Activity01Icon, label: 'Observe', matchPrefix: '/observe' },
  { to: '/office', icon: Building01Icon, label: 'Office', matchPrefix: '/office' },
  { to: '/knowledge', icon: BrainIcon, label: 'Knowledge', matchPrefix: '/knowledge' },
]

function isEntryActive(entry: NavEntry, pathname: string): boolean {
  if (entry.matchPrefix) {
    return pathname === entry.matchPrefix || pathname.startsWith(entry.matchPrefix + '/')
  }
  return pathname === entry.to
}

// ── Data types shared across counter rows ──────────────────────────────────

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

type Meeting = {
  id: string | number
  title: string
  start_time?: string | null
  end_time?: string | null
}

type MeetingsResponse = {
  meetings?: Meeting[]
  data?: Meeting[]
}

type FindingsResponse = {
  events: Array<{ ts: string }>
  count: number
}

// ── Helpers ────────────────────────────────────────────────────────────────

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

function formatTime(t: string): string {
  try {
    return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return t
  }
}

function formatDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })
  } catch {
    return d
  }
}

function detectTenant(): string {
  if (typeof window === 'undefined') return 'henry_cos'
  try {
    return localStorage.getItem('cockpit-tenant') ?? 'henry_cos'
  } catch {
    return 'henry_cos'
  }
}

function tenantToOwner(tenant: string): string {
  if (tenant === 'mally') return 'Mally'
  return 'Henry'
}

function countOvernight(events: Array<{ ts: string }>): number {
  const cutoff = Date.now() - 8 * 60 * 60 * 1000
  return events.filter((e) => new Date(e.ts).getTime() > cutoff).length
}

// ── Popover primitive ──────────────────────────────────────────────────────

function Popover({
  anchor,
  onClose,
  children,
}: {
  anchor: HTMLElement | null
  onClose: () => void
  children: React.ReactNode
}) {
  const popoverRef = useRef<HTMLDivElement | null>(null)

  // Position relative to the anchor row
  const [style, setStyle] = useState<React.CSSProperties>({})
  useEffect(() => {
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    setStyle({
      position: 'fixed',
      top: rect.top,
      left: rect.right + 8,
      zIndex: 200,
      minWidth: 260,
      maxWidth: 340,
    })
  }, [anchor])

  // Close on outside click or Escape
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        (!anchor || !anchor.contains(e.target as Node))
      ) {
        onClose()
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [anchor, onClose])

  return (
    <div
      ref={popoverRef}
      className="leftnav-popover"
      style={style}
      role="dialog"
      aria-modal="false"
    >
      {children}
    </div>
  )
}

// ── Counter row component ──────────────────────────────────────────────────

type CounterRowProps = {
  emoji: string
  label: string
  count: number | null   // null = loading, number = count (0 = none, —)
  hasError?: boolean
  hasDot?: boolean        // red attention dot
  onClick: (anchor: HTMLElement) => void
}

function CounterRow({ emoji, label, count, hasError, hasDot, onClick }: CounterRowProps) {
  const rowRef = useRef<HTMLButtonElement | null>(null)
  const displayCount = count === null ? null : count === 0 ? '—' : String(count)
  const showDash = hasError || count === 0

  return (
    <button
      ref={rowRef}
      className="leftnav-counter-row atc-interactive"
      onClick={() => {
        if (rowRef.current) onClick(rowRef.current)
      }}
      type="button"
      aria-label={`${label}: ${showDash ? 'unavailable' : (displayCount ?? 'loading')}`}
    >
      <span className="leftnav-counter-emoji" aria-hidden="true">{emoji}</span>
      <span className="leftnav-counter-label">{label}</span>
      <span className="leftnav-counter-value">
        {count === null ? (
          <span className="leftnav-counter-loading" />
        ) : hasError ? (
          <span className="leftnav-counter-dash">—</span>
        ) : count === 0 ? (
          <span className="leftnav-counter-dash">—</span>
        ) : (
          <>
            <span>{count}</span>
            {hasDot && <span className="leftnav-counter-dot" aria-label="needs attention" />}
          </>
        )}
      </span>
    </button>
  )
}

// ── Approvals counter + popover ────────────────────────────────────────────

function ApprovalsCounterRow({ onOpen }: { onOpen: (el: HTMLElement, content: React.ReactNode) => void }) {
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
  const count = isLoading ? null : error ? 0 : items.length

  const popoverContent = (
    <div>
      <div className="leftnav-popover-title">Approvals</div>
      {error ? (
        <p className="leftnav-popover-error">⚠ Failed to load approvals. Will auto-retry.</p>
      ) : items.length === 0 ? (
        <p className="leftnav-popover-empty">Nothing queued</p>
      ) : (
        <ul className="leftnav-popover-list">
          {items.slice(0, 5).map((item) => (
            <li key={item.id} className="leftnav-popover-item">
              <span className="leftnav-popover-badge" data-source={item.source}>
                {SOURCE_LABEL[item.source]}
              </span>
              {item.link ? (
                <a href={item.link} target="_blank" rel="noopener noreferrer" className="leftnav-popover-item-title">
                  {item.title}
                </a>
              ) : (
                <span className="leftnav-popover-item-title">{item.title}</span>
              )}
              <span className="leftnav-popover-item-meta">{formatAge(item.age_s)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <CounterRow
      emoji="📋"
      label="Approvals"
      count={isLoading ? null : error ? 0 : items.length}
      hasError={Boolean(error)}
      hasDot={typeof count === 'number' && count > 0}
      onClick={(el) => onOpen(el, popoverContent)}
    />
  )
}

// ── Milestones counter + popover ───────────────────────────────────────────

function MilestonesCounterRow({ onOpen }: { onOpen: (el: HTMLElement, content: React.ReactNode) => void }) {
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
    .filter((m) => !m.owner || m.owner === 'Both' || m.owner.toLowerCase() === ownerLabel.toLowerCase())
    .filter((m) => m.target_date)
    .sort((a, b) => new Date(a.target_date!).getTime() - new Date(b.target_date!).getTime())
    .slice(0, 5)

  const count = isLoading ? null : error ? 0 : filtered.length

  const popoverContent = (
    <div>
      <div className="leftnav-popover-title">Milestones</div>
      {error ? (
        <p className="leftnav-popover-error">⚠ vectos unreachable. Will auto-retry.</p>
      ) : filtered.length === 0 ? (
        <p className="leftnav-popover-empty">No upcoming milestones</p>
      ) : (
        <ul className="leftnav-popover-list">
          {filtered.map((m) => (
            <li key={m.id} className="leftnav-popover-item">
              <span className="leftnav-popover-item-title">{m.title}</span>
              {m.target_date && (
                <span className="leftnav-popover-item-meta">{formatDate(m.target_date)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <CounterRow
      emoji="🎯"
      label="Milestones"
      count={count}
      hasError={Boolean(error)}
      onClick={(el) => onOpen(el, popoverContent)}
    />
  )
}

// ── Meetings counter + popover ─────────────────────────────────────────────

function MeetingsCounterRow({ onOpen }: { onOpen: (el: HTMLElement, content: React.ReactNode) => void }) {
  const { data, isLoading, error } = useQuery<MeetingsResponse>({
    queryKey: ['vectos', 'meetings-today'],
    queryFn: async () => {
      // Use server-side proxy to bypass CF Access CORS restriction
      const resp = await fetch('/api/meetings')
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const body = await resp.json() as { meetings?: Meeting[]; data?: Meeting[]; source?: string }
      // proxy returns source:"vectos_404" when the upstream endpoint is not yet implemented
      if (body.source === 'vectos_404') return { meetings: [] }
      return body
    },
    refetchInterval: 10 * 60_000,
    staleTime: 9 * 60_000,
    retry: 1,
  })

  const meetings: Meeting[] = data?.meetings ?? data?.data ?? []
  const count = isLoading ? null : error ? 0 : meetings.length

  const popoverContent = (
    <div>
      <div className="leftnav-popover-title">Today's meetings</div>
      {error ? (
        <p className="leftnav-popover-error">⚠ vectos unreachable. Will auto-retry.</p>
      ) : meetings.length === 0 ? (
        <p className="leftnav-popover-empty">No meetings today</p>
      ) : (
        <ul className="leftnav-popover-list">
          {meetings.map((m) => (
            <li key={m.id} className="leftnav-popover-item">
              {m.start_time && (
                <span className="leftnav-popover-item-meta">{formatTime(m.start_time)}</span>
              )}
              <span className="leftnav-popover-item-title">{m.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <CounterRow
      emoji="📅"
      label="Today's mtgs"
      count={count}
      hasError={Boolean(error)}
      onClick={(el) => onOpen(el, popoverContent)}
    />
  )
}

// ── Briefing counter + popover ─────────────────────────────────────────────

function BriefingCounterRow({ onOpen }: { onOpen: (el: HTMLElement, content: React.ReactNode) => void }) {
  const { data: findingsData, isLoading: loadingFindings } = useQuery<FindingsResponse>({
    queryKey: ['flow', 'events', 'briefing'],
    queryFn: async () => {
      const resp = await fetch('/api/flow/events?hours=8&limit=200')
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return resp.json()
    },
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
  })

  const { data: approvalsData, isLoading: loadingApprovals } = useQuery<AggregateResponse>({
    queryKey: ['approvals', 'aggregate'],
    // Shared with ApprovalsCounterRow — TanStack Query deduplicates the fetch
    queryFn: async () => {
      const resp = await fetch('/api/approvals/aggregate')
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return resp.json()
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  })

  const isLoading = loadingFindings || loadingApprovals
  const overnightCount = findingsData ? countOvernight(findingsData.events) : null
  const approvalsCount = approvalsData?.total ?? null
  const briefingTotal = overnightCount !== null ? overnightCount : null
  const count = isLoading ? null : briefingTotal

  const summaryParts: string[] = []
  if (overnightCount !== null) summaryParts.push(`${overnightCount} finding${overnightCount !== 1 ? 's' : ''} overnight`)
  if (approvalsCount !== null && approvalsCount > 0) summaryParts.push(`${approvalsCount} approval${approvalsCount !== 1 ? 's' : ''} queued`)
  const summary = summaryParts.length > 0 ? summaryParts.join(' · ') : 'All clear'

  const popoverContent = (
    <div>
      <div className="leftnav-popover-title">Daily briefing</div>
      <div className="leftnav-popover-metrics">
        <div className="leftnav-popover-metric">
          <span className="leftnav-popover-metric-value">{overnightCount ?? '—'}</span>
          <span className="leftnav-popover-metric-label">findings overnight</span>
        </div>
        <div className="leftnav-popover-metric">
          <span className="leftnav-popover-metric-value">{approvalsCount ?? '—'}</span>
          <span className="leftnav-popover-metric-label">approvals queued</span>
        </div>
      </div>
      <p className="leftnav-popover-summary">{summary}</p>
    </div>
  )

  return (
    <CounterRow
      emoji="📰"
      label="Briefing"
      count={count}
      onClick={(el) => onOpen(el, popoverContent)}
    />
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function NavLink({ entry, active }: { entry: NavEntry; active: boolean }) {
  return (
    <Link
      to={entry.to as any}
      aria-label={entry.label}
      className={cn(
        'leftnav-link atc-interactive',
        active ? 'leftnav-link-active' : 'leftnav-link-idle',
      )}
    >
      {active && (
        <span className="leftnav-active-bar" aria-hidden="true" />
      )}
      <HugeiconsIcon
        icon={entry.icon as any}
        size={18}
        strokeWidth={1.5}
        className={cn(
          'shrink-0 transition-colors',
          active
            ? 'text-accent-500'
            : 'text-primary-400 dark:text-neutral-500 group-hover:text-primary-700 dark:group-hover:text-neutral-200',
        )}
      />
      <span className="leftnav-link-label">{entry.label}</span>
    </Link>
  )
}

// ── Main export ────────────────────────────────────────────────────────────

export function LeftNav() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const { open, openFlyout, closeFlyout } = useSettingsFlyout()

  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null)
  const [popoverContent, setPopoverContent] = useState<React.ReactNode>(null)

  const handleOpen = useCallback((el: HTMLElement, content: React.ReactNode) => {
    // Toggle: clicking same row closes it
    setPopoverAnchor((prev) => (prev === el ? null : el))
    setPopoverContent(content)
  }, [])

  const handleClose = useCallback(() => {
    setPopoverAnchor(null)
    setPopoverContent(null)
  }, [])

  return (
    <>
      <nav
        aria-label="Cockpit navigation"
        className="leftnav leftnav-slim"
      >
        {/* Logo */}
        <div className="leftnav-logo">
          <img src="/claude-avatar.webp" alt="Hermes" className="size-7 rounded-lg opacity-80" />
          <span className="leftnav-wordmark">Hermes</span>
        </div>

        {/* 5 route links */}
        <div className="leftnav-routes">
          {NAV_ENTRIES.map((entry) => (
            <NavLink key={entry.to} entry={entry} active={isEntryActive(entry, pathname)} />
          ))}
        </div>

        {/* Divider */}
        <div className="leftnav-divider" aria-hidden="true" />

        {/* 4 counter rows */}
        <div className="leftnav-counters">
          <ApprovalsCounterRow onOpen={handleOpen} />
          <MilestonesCounterRow onOpen={handleOpen} />
          <MeetingsCounterRow onOpen={handleOpen} />
          <BriefingCounterRow onOpen={handleOpen} />
        </div>

        {/* Session pill */}
        <SessionPill />

        {/* Divider */}
        <div className="leftnav-divider" aria-hidden="true" />

        {/* Settings trigger */}
        <div className="leftnav-settings">
          <SettingsTrigger
            onClick={openFlyout}
            className="w-full flex-col gap-1 py-2 text-[10px] font-medium rounded-lg"
          />
        </div>
      </nav>

      {/* Popover — rendered outside nav */}
      {popoverAnchor && popoverContent && (
        <Popover anchor={popoverAnchor} onClose={handleClose}>
          {popoverContent}
        </Popover>
      )}

      {/* Settings flyout */}
      <SettingsFlyout open={open} onClose={closeFlyout} />
    </>
  )
}
