/**
 * Agent Workflow Store — per-Hermes-profile state-machine derived from span stream.
 *
 * State derivation (priority order):
 *   1. error   — any span in last 5 min with status=error
 *   2. idle    — no spans at all in last 5 min
 *   3. calling_mcp    — most recent open span is kind=mcp_call
 *   4. waiting_model  — most recent open span is kind=model_call
 *   5. delegating     — most recent open span is kind=handoff
 *   6. planning       — most recent span is root (no parentId), < 30s old
 *   7. done           — root span is older than all its descendants' last ts
 *   8. idle           — fallback
 */

import { create } from 'zustand'
import { BASE_URL } from '@/lib/gateway-api'

// ── Types ────────────────────────────────────────────────────────────────────

/** Raw span event as returned by GET /api/observe/spans */
export type AgentEvent = {
  id: string
  traceId?: string
  parentId?: string | null
  profile?: string
  source_app?: string          // Hermes uses source_app for profile name
  kind?: string                // mcp_call | model_call | handoff | root | tool | ...
  status?: string              // ok | error | pending | ...
  ts?: string | number         // ISO string or epoch ms
  startedAt?: string | number
  endedAt?: string | number | null
  label?: string
  intent?: string
  intentId?: string
  tokenBudgetUsed?: number
  costToday?: number
  source?: string              // "fixture" → show fixture badge
  [key: string]: unknown
}

export type WorkflowState =
  | 'idle'
  | 'planning'
  | 'calling_mcp'
  | 'waiting_model'
  | 'delegating'
  | 'done'
  | 'error'

export type ProfileSnapshot = {
  profile: string
  state: WorkflowState
  currentIntent: { id: string; startedAt: string; label: string } | null
  lastActions: { ts: string; label: string; kind: string; status: 'ok' | 'error' }[]
  tokenBudgetUsed?: number
  costToday?: number
}

type WorkflowStoreState = {
  snapshots: Record<string, ProfileSnapshot>
  ingestSpans(spans: AgentEvent[]): void
  reset(): void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeTs(ts: string | number | null | undefined): number {
  if (ts == null) return 0
  if (typeof ts === 'number') return ts
  const parsed = Date.parse(ts)
  return isNaN(parsed) ? 0 : parsed
}

function profileKey(span: AgentEvent): string {
  return (
    (span.profile as string | undefined) ??
    (span.source_app as string | undefined) ??
    'unknown'
  )
}

const FIVE_MIN_MS = 5 * 60 * 1000
const THIRTY_SEC_MS = 30 * 1000

function deriveState(spans: AgentEvent[], now: number): WorkflowState {
  const recent = spans.filter((s) => now - normalizeTs(s.ts ?? s.startedAt) < FIVE_MIN_MS)

  if (recent.length === 0) return 'idle'

  // 1. Any error span → error
  if (recent.some((s) => String(s.status ?? '').toLowerCase() === 'error')) {
    return 'error'
  }

  // Sort by ts descending; most-recent first
  const sorted = [...recent].sort(
    (a, b) =>
      normalizeTs(b.ts ?? b.startedAt) - normalizeTs(a.ts ?? a.startedAt),
  )

  const mostRecent = sorted[0]
  const kind = String(mostRecent.kind ?? '').toLowerCase()
  const isOpen = mostRecent.endedAt == null

  // 2. Open MCP call
  if (isOpen && kind === 'mcp_call') return 'calling_mcp'

  // 3. Open model call
  if (isOpen && kind === 'model_call') return 'waiting_model'

  // 4. Open handoff / delegating
  if (isOpen && kind === 'handoff') return 'delegating'

  // 5. Planning — most recent is a root span < 30s old with no children
  const mostRecentAge = now - normalizeTs(mostRecent.ts ?? mostRecent.startedAt)
  const isRoot = mostRecent.parentId == null || mostRecent.parentId === ''
  const hasChildren = recent.some((s) => s.parentId === mostRecent.id)
  if (isRoot && !hasChildren && mostRecentAge < THIRTY_SEC_MS) return 'planning'

  // 6. Done — root span older than all its descendants' latest ts
  const rootSpans = recent.filter((s) => s.parentId == null || s.parentId === '')
  if (rootSpans.length > 0) {
    const latestRoot = rootSpans.reduce((a, b) =>
      normalizeTs(a.ts ?? a.startedAt) > normalizeTs(b.ts ?? b.startedAt) ? a : b,
    )
    const rootTs = normalizeTs(latestRoot.ts ?? latestRoot.startedAt)
    const descendants = recent.filter(
      (s) => s.parentId != null && s.parentId !== '' && s.parentId === latestRoot.id,
    )
    if (descendants.length > 0) {
      const latestDescTs = Math.max(
        ...descendants.map((s) => normalizeTs(s.ts ?? s.startedAt)),
      )
      if (rootTs < latestDescTs) return 'done'
    }
  }

  return 'idle'
}

function buildSnapshot(
  profile: string,
  spans: AgentEvent[],
  now: number,
): ProfileSnapshot {
  const state = deriveState(spans, now)

  // Current intent: use intentId / intent label from most-recent span that has one
  const withIntent = spans
    .filter((s) => s.intentId ?? s.intent)
    .sort(
      (a, b) =>
        normalizeTs(b.ts ?? b.startedAt) - normalizeTs(a.ts ?? a.startedAt),
    )

  const currentIntent =
    withIntent.length > 0
      ? {
          id: String(withIntent[0].intentId ?? withIntent[0].id ?? ''),
          startedAt: new Date(
            normalizeTs(withIntent[0].ts ?? withIntent[0].startedAt),
          ).toISOString(),
          label: String(
            withIntent[0].intent ?? withIntent[0].label ?? 'intent',
          ),
        }
      : null

  // Last 5 actions
  const lastActions = [...spans]
    .sort(
      (a, b) =>
        normalizeTs(b.ts ?? b.startedAt) - normalizeTs(a.ts ?? a.startedAt),
    )
    .slice(0, 5)
    .map((s) => ({
      ts: new Date(normalizeTs(s.ts ?? s.startedAt)).toISOString(),
      label: String(s.label ?? s.kind ?? 'span'),
      kind: String(s.kind ?? 'unknown'),
      status:
        String(s.status ?? '').toLowerCase() === 'error'
          ? ('error' as const)
          : ('ok' as const),
    }))

  // Token budget + cost from most-recent span that carries them
  const withTokens = spans.find((s) => s.tokenBudgetUsed != null)
  const withCost = spans.find((s) => s.costToday != null)

  return {
    profile,
    state,
    currentIntent,
    lastActions,
    tokenBudgetUsed:
      withTokens != null ? (withTokens.tokenBudgetUsed as number) : undefined,
    costToday: withCost != null ? (withCost.costToday as number) : undefined,
  }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useAgentWorkflowStore = create<WorkflowStoreState>((set) => ({
  snapshots: {},

  ingestSpans(spans: AgentEvent[]) {
    if (!spans || spans.length === 0) return

    const now = Date.now()

    // Group spans by profile
    const byProfile: Record<string, AgentEvent[]> = {}
    for (const span of spans) {
      const key = profileKey(span)
      if (!byProfile[key]) byProfile[key] = []
      byProfile[key].push(span)
    }

    const nextSnapshots: Record<string, ProfileSnapshot> = {}
    for (const [profile, profileSpans] of Object.entries(byProfile)) {
      nextSnapshots[profile] = buildSnapshot(profile, profileSpans, now)
    }

    set({ snapshots: nextSnapshots })
  },

  reset() {
    set({ snapshots: {} })
  },
}))

// ── Re-export BASE_URL for component use ──────────────────────────────────────
export { BASE_URL }
