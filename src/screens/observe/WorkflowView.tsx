/**
 * WorkflowView — per-Hermes-profile state-machine dashboard.
 *
 * Polls GET /api/observe/spans?since=15m every 3 s.
 * Pipes results into useAgentWorkflowStore.ingestSpans().
 * Renders a responsive 3/2/1-col grid of ProfileCard tiles.
 *
 * Columns are derived entirely from data (no hardcoded profile list).
 */

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import {
  BASE_URL,
  useAgentWorkflowStore,
  type AgentEvent,
  type ProfileSnapshot,
  type WorkflowState,
} from '@/stores/agent-workflow-store'
import { useTenantRole } from '@/hooks/use-tenant-role'

// ── State badge config ────────────────────────────────────────────────────────

type BadgeConfig = {
  label: string
  dot: string   // Tailwind bg-* class for coloured dot
  ring: string  // Tailwind ring/border class for card accent
  text: string  // Tailwind text-* class
}

const STATE_CONFIG: Record<WorkflowState, BadgeConfig> = {
  idle: {
    label: 'idle',
    dot: 'bg-zinc-500',
    ring: 'border-zinc-700',
    text: 'text-zinc-400',
  },
  planning: {
    label: 'planning',
    dot: 'bg-green-400 animate-pulse',
    ring: 'border-green-600/60',
    text: 'text-green-400',
  },
  calling_mcp: {
    label: 'calling MCP',
    dot: 'bg-emerald-400 animate-pulse',
    ring: 'border-emerald-600/60',
    text: 'text-emerald-400',
  },
  waiting_model: {
    label: 'waiting model',
    dot: 'bg-sky-400 animate-pulse',
    ring: 'border-sky-600/60',
    text: 'text-sky-400',
  },
  delegating: {
    label: 'delegating',
    dot: 'bg-violet-400 animate-pulse',
    ring: 'border-violet-600/60',
    text: 'text-violet-400',
  },
  done: {
    label: 'done',
    dot: 'bg-teal-400',
    ring: 'border-teal-600/40',
    text: 'text-teal-400',
  },
  error: {
    label: 'error',
    dot: 'bg-red-500 animate-pulse',
    ring: 'border-red-600/70',
    text: 'text-red-400',
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const delta = Date.now() - Date.parse(iso)
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`
  return `${Math.round(delta / 3_600_000)}h ago`
}

function kindEmoji(kind: string): string {
  switch (kind.toLowerCase()) {
    case 'mcp_call':    return '🔧'
    case 'model_call':  return '🧠'
    case 'handoff':     return '↗'
    case 'root':        return '🌱'
    case 'tool':        return '⚙'
    default:            return '·'
  }
}

// ── ProfileCard ───────────────────────────────────────────────────────────────

function ProfileCard({ snap }: { snap: ProfileSnapshot }) {
  const cfg = STATE_CONFIG[snap.state]

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-colors',
        cfg.ring,
      )}
    >
      {/* Header: profile name + state badge */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="truncate text-sm font-semibold text-foreground">
          {snap.profile}
        </span>
        <span
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium shrink-0',
            cfg.ring,
            cfg.text,
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', cfg.dot)} />
          {cfg.label}
        </span>
      </div>

      {/* Current intent */}
      <div className="min-h-[1.25rem]">
        {snap.currentIntent ? (
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">
              {snap.currentIntent.label}
            </span>
            {' '}
            <span className="opacity-60">
              · {relativeTime(snap.currentIntent.startedAt)}
            </span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground/50 italic">
            no active intent
          </p>
        )}
      </div>

      {/* Last 5 actions mini-feed */}
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
          Last 5
        </p>
        {snap.lastActions.length === 0 ? (
          <p className="text-xs text-muted-foreground/40 italic">—</p>
        ) : (
          <ul className="space-y-0.5">
            {snap.lastActions.map((action, i) => (
              <li
                key={i}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <span className="shrink-0 text-[11px]">
                  {kindEmoji(action.kind)}
                </span>
                <span className="truncate flex-1">{action.label}</span>
                <span
                  className={cn(
                    'shrink-0 text-[10px]',
                    action.status === 'error' ? 'text-red-400' : 'text-muted-foreground/50',
                  )}
                >
                  {relativeTime(action.ts)}
                </span>
                {action.status === 'error' && (
                  <span className="shrink-0 text-[10px] text-red-400">✕</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Token budget + cost footer */}
      {(snap.tokenBudgetUsed != null || snap.costToday != null) && (
        <div className="flex items-center gap-3 border-t border-border/40 pt-2 text-[10px] text-muted-foreground/60">
          {snap.tokenBudgetUsed != null && (
            <span>
              <span className="font-medium text-muted-foreground">
                {snap.tokenBudgetUsed.toLocaleString()}
              </span>{' '}
              tok
            </span>
          )}
          {snap.costToday != null && (
            <span>
              <span className="font-medium text-muted-foreground">
                ${snap.costToday.toFixed(4)}
              </span>{' '}
              today
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tenant profile allowlists ─────────────────────────────────────────────────

/**
 * Profiles surfaced to each tenant.
 * henry_cos → everything except Mally's profiles.
 * mally     → only her profiles.
 * null/unknown → fall back to henry_cos (no disruption).
 */
const MALLY_PROFILES = new Set(['mally', 'mally-second'])

function filterProfilesByTenant(
  profiles: ProfileSnapshot[],
  tenant: string | null,
): ProfileSnapshot[] {
  if (tenant === 'mally') {
    return profiles.filter((p) => MALLY_PROFILES.has(p.profile))
  }
  // henry_cos or unknown → exclude mally profiles
  return profiles.filter((p) => !MALLY_PROFILES.has(p.profile))
}

// ── WorkflowView ──────────────────────────────────────────────────────────────

export default function WorkflowView() {
  const { snapshots, ingestSpans } = useAgentWorkflowStore()
  const { tenant, displayName, loading: tenantLoading } = useTenantRole()
  const abortRef = useRef<AbortController | null>(null)
  const isFixture = useRef(false)

  useEffect(() => {
    let active = true

    async function poll() {
      if (!active) return

      abortRef.current = new AbortController()
      try {
        const res = await fetch(`${BASE_URL}/api/observe/spans?since=15m`, {
          signal: abortRef.current.signal,
        })
        if (!res.ok) return

        const json: unknown = await res.json()
        const spans: AgentEvent[] = Array.isArray(json)
          ? json
          : Array.isArray((json as { spans?: unknown })?.spans)
            ? ((json as { spans: AgentEvent[] }).spans)
            : []

        if (spans.length > 0) {
          isFixture.current =
            typeof (spans[0] as AgentEvent).source === 'string' &&
            (spans[0] as AgentEvent).source === 'fixture'
          ingestSpans(spans)
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        // Network errors: swallow, retry on next tick
      }
    }

    // First poll immediately
    void poll()
    const id = setInterval(() => void poll(), 3000)

    return () => {
      active = false
      clearInterval(id)
      abortRef.current?.abort()
    }
  }, [ingestSpans])

  const allProfiles = Object.values(snapshots)
  const profiles = filterProfilesByTenant(allProfiles, tenantLoading ? null : tenant)

  // Sort: error first → active states → idle/done
  const statePriority: Record<WorkflowState, number> = {
    error: 0,
    calling_mcp: 1,
    waiting_model: 2,
    delegating: 3,
    planning: 4,
    done: 5,
    idle: 6,
  }
  const sorted = [...profiles].sort(
    (a, b) => statePriority[a.state] - statePriority[b.state],
  )

  const fixtureMode = isFixture.current && sorted.length > 0
  const tenantLabel = tenantLoading
    ? null
    : displayName
      ? `Showing profiles for ${displayName}`
      : 'Showing all profiles'

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Page header */}
      <div className="mb-5 flex items-center gap-3">
        <h2 className="text-base font-semibold">Workflow</h2>
        <span className="text-xs text-muted-foreground">
          Per-profile state machine · polling every 3 s
        </span>
        {tenantLabel && (
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
            {tenantLabel}
          </span>
        )}
        {fixtureMode && (
          <span className="rounded-full border border-amber-500/50 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-400">
            FIXTURE DATA
          </span>
        )}
      </div>

      {/* Empty state */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
          <span className="text-4xl">🤖</span>
          <p className="text-sm font-semibold">No agent activity yet.</p>
          <p className="text-xs opacity-60">
            Waiting for Hermes spans…
          </p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((snap) => (
            <ProfileCard key={snap.profile} snap={snap} />
          ))}
        </div>
      )}
    </div>
  )
}
